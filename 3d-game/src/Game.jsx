import {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useMemo,
  useCallback,
} from 'react';
import { useFrame } from '@react-three/fiber';
import { AdaptiveDpr, ContactShadows } from '@react-three/drei';

import { MOVE_DATA, getMoveDuration } from './combat/moveData.js';
import {
  regenStamina,
  canUseMove,
  spendStamina,
  STAMINA_CONFIG,
} from './combat/stamina.js';
import {
  resolveAttack,
  resolveClinch,
  resolveThrow,
  getReactionDuration,
  REACTIONS,
} from './combat/combatResolver.js';
import {
  decideNPCAction,
} from './combat/npcAI.js';
import { buildPredictPayload } from './onlineRl.js';
import {
  clampNPCPosition,
  resetAI,
  NPC_STATES,
  getArchetypeForCharacter,
  generateMockCounter,
} from './combat/npcAI.js';
import {
  createInputState,
  updateInputState,
  getMovementVector,
  getAttackInput,
  blockEnded,
  backstepStarted,
  pauseStarted,
  shouldPreventDefault,
} from './combat/inputMap.js';

import GLBFighter from './fighters/GLBFighter.jsx';
import FightCamera from './camera/FightCamera.jsx';
import ArenaPostFx from './arenas/components/ArenaPostFx.jsx';

import { useVfx } from './vfx/vfxContext.js';
import ParticleSystem from './vfx/ParticleSystem.jsx';
import ShockwaveRenderer from './vfx/Shockwave.jsx';
import SplatterRenderer from './vfx/Splatter.jsx';
import ImpactLights from './vfx/ImpactLights.jsx';

const ARENA_HALF_WIDTH = 15;
const ARENA_HALF_DEPTH = 10;
const MOVE_SPEED = 3.8;
const DODGE_SPEED = 9;
const MAX_HP = 100;
const ROUND_OVER_DELAY = 1.8;
const COMBO_RESET_TIME = 1.2;

const CRIT_STAMINA_REWARD = 4;
const BACKSTEP_IFRAME_DURATION = 0.05;
const BACKSTEP_ACTIVE_DURATION = 0.18;
const BACKSTEP_RECOVERY_DURATION = 0.12;
const BACKSTEP_TOTAL = BACKSTEP_IFRAME_DURATION + BACKSTEP_ACTIVE_DURATION + BACKSTEP_RECOVERY_DURATION;
const EDGE_SLOW_DISTANCE = 2.0;
const EDGE_SLOW_FACTOR = 0.7;
const BACKWARD_MOVE_PENALTY = 0.7;
const MOVEMENT_ACCEL = 14.0;


function clampArena(pos) {
  return [
    Math.max(-ARENA_HALF_WIDTH, Math.min(ARENA_HALF_WIDTH, pos[0] || 0)),
    pos[1] || 0,
    Math.max(-ARENA_HALF_DEPTH, Math.min(ARENA_HALF_DEPTH, pos[2] || 0)),
  ];
}

function dist(a, b) {
  const dx = (a[0] || 0) - (b[0] || 0);
  const dz = (a[2] || 0) - (b[2] || 0);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Edge-to-edge distance between two fighters. Each fighter has a body
 * radius (the half-width of their silhouette / GLB mesh); the gap
 * between them is the center-to-center distance minus both radii.
 *
 * Used for all hit/resolution checks. Stops hits from landing when the
 * two bodies are visually touching.
 *
 * Body radius default is 0.55 to match the GLB character half-widths:
 *   - Xbot chest ~ 0.45 m wide (half = 0.225 m, but arms add ~0.15 m
 *     of reach at the shoulder) -> effective body half-width ~0.5 m.
 *   - RobotExpressive torso ~ 0.6 m wide -> half ~0.3 m, plus arms.
 * Bumping the default to 0.55 ensures the edge-to-edge gap is at
 * least 1.1 m for two fighters just touching center-to-center, which
 * keeps them well outside the jab's 1.6 m minRange.
 */
const DEFAULT_BODY_RADIUS = 0.55;
function edgeDist(a, b, aRadius, bRadius) {
  const center = dist(a, b);
  const ar = aRadius != null ? aRadius : DEFAULT_BODY_RADIUS;
  const br = bRadius != null ? bRadius : DEFAULT_BODY_RADIUS;
  return Math.max(0, center - ar - br);
}

function createFighterState(config, isPlayer, startX) {
  return {
    position: [startX, 0, 0],
    facing: isPlayer ? 1 : -1,
    anim: 'idle',
    animProgress: 0,
    isAttacking: false,
    attackStartX: null,
    isBlocking: false,
    isHit: false,
    isPlayer,
    hp: MAX_HP,
    stamina: STAMINA_CONFIG.maxStamina,
    stateTimer: 0,
    hitstun: 0,
    hitstunDuration: 0,
    comboCount: 0,
    comboTimer: 0,
    hitConnected: false,
    velX: 0,
    velZ: 0,
    attackerPushbackTilt: 0,
    knockbackTilt: 0,
    config,
  };
}

function createGameState() {
  return {
    round: 1,
    playerScore: 0,
    npcScore: 0,
    time: 0,
    roundOver: false,
    gameOver: false,
    winner: null,
    roundOverTimer: 0,
    screenShake: 0,
    freezeFrames: 0,
    matchWinner: null,
    camRoll: 0,
    camZoomPulse: 0,
  };
}

function Game(
  {
    arena,
    playerCharacter,
    npcCharacter,
    onGameOver,
    onRoundEnd,
    onPause,
    paused = false,
    modelReadyRef = null,
  },
  ref
) {
  const playerRef = useRef(createFighterState(playerCharacter, true, -5));
  const npcRef = useRef(createFighterState(npcCharacter, false, 5));
  const gameRef = useRef(createGameState());
  const inputRef = useRef(createInputState());
  const prevInputRef = useRef(createInputState());
  const aiMemoryRef = useRef(resetAI());
  const pendingGemmaMoveRef = useRef(null);
  const requestInFlightRef = useRef(false);
  const playerMoveHistoryRef = useRef([]);
  const gamePhaseRef = useRef('intro'); // intro -> fighting -> roundOver -> gameOver
  const introTimerRef = useRef(1.2);
  const impactLightsRef = useRef(null);

  const npcArchetype = useMemo(
    () => getArchetypeForCharacter(npcCharacter?.id),
    [npcCharacter]
  );

  const { spawnImpact, spawnShockwave, spawnSplatter, spawnFootstep } = useVfx();

  // Footstep / landing dust callbacks. SilhouetteFighter detects the timing
  // events (foot down, backstep recovery entry) and we route them to VFX.
  const onFootstep = useCallback(
    (worldPos, opts) => {
      if (spawnFootstep) spawnFootstep(worldPos);
      const t = opts && opts.type;
      if (t === 'slide' || t === 'landing' || t === 'walk') {
        window.dispatchEvent(
          new CustomEvent('game-vfx', {
            detail: { type: t, position: worldPos },
          })
        );
      }
    },
    [spawnFootstep]
  );
  const onBackstepLanding = useCallback(
    (worldPos) => {
      if (spawnFootstep) spawnFootstep(worldPos);
      window.dispatchEvent(
        new CustomEvent('game-vfx', {
          detail: { type: 'landing', position: worldPos },
        })
      );
    },
    [spawnFootstep]
  );

  const ArenaComponent = useMemo(() => (arena ? arena.component : null), [arena]);

  useImperativeHandle(ref, () => ({
    playerRef,
    npcRef,
    gameRef,
  }));

  // Listen for Gradio / mock AI counter-move suggestions.
  useEffect(() => {
    const onAI = (e) => {
      const move = e.detail?.counterMove || e.detail?.move;
      if (move) pendingGemmaMoveRef.current = move;
    };
    window.addEventListener('ai-response', onAI);
    return () => window.removeEventListener('ai-response', onAI);
  }, []);

  // Keyboard input.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (shouldPreventDefault(e.key)) e.preventDefault();
      updateInputState(inputRef.current, e.key, true);
    };
    const onKeyUp = (e) => {
      updateInputState(inputRef.current, e.key, false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  function requestNPCCounterMove() {
    if (requestInFlightRef.current) return;

    const history = playerMoveHistoryRef.current;
    const lastFive = history.slice(-5);
    if (lastFive.length === 0) lastFive.push(playerRef.current.anim);
    const sequence = lastFive.join(',');
    const playerPrevMove = history.length > 1
      ? history[history.length - 1]
      : '';

    const modelReady = modelReadyRef?.current === true;
    const canCallModel = modelReady && typeof window.sendAIRequest === 'function';

    if (!canCallModel) {
      // Client-side fallback: tiny scripted policy.
      const p = playerRef.current;
      const n = npcRef.current;
      const distance = edgeDist(p.position, n.position);
      const move = generateMockCounter(
        {
          anim: p.anim,
          animProgress: p.animProgress,
          isAttacking: p.isAttacking,
        },
        distance,
        n.stamina,
        npcArchetype,
        history
      );
      if (move) pendingGemmaMoveRef.current = move;
      return;
    }

    requestInFlightRef.current = true;
    const p = playerRef.current;
    const n = npcRef.current;
    const distance = edgeDist(p.position, n.position);
    const payload = buildPredictPayload({
      sequence,
      playerCharacterId: playerCharacter?.id,
      npcCharacterId: npcCharacter?.id,
      round: gameRef.current.round,
      distance,
      playerPrevMove,
      playerStamina: p.stamina,
      npcStamina: n.stamina,
    });
    window
      .sendAIRequest(payload)
      .finally(() => {
        requestInFlightRef.current = false;
      });
  }

  function setAnim(fighter, anim) {
    fighter.anim = anim;
    fighter.animProgress = 0;
    fighter.hitConnected = false;
  }

  function startPlayerAttack(move) {
    const p = playerRef.current;
    if (p.hitstun > 0 || p.isAttacking || p.hp <= 0) return;
    const ctx = {
      isGrappled: p.anim === 'clinched',
      isFatigued: p.stamina < 20,
    };
    if (!canUseMove(move, p.stamina, ctx)) return;
    p.stamina = spendStamina(p.stamina, move, ctx);
    p.isAttacking = true;
    p.isBlocking = false;
    // Snapshot the X position at attack start. The attacker is locked
    // to this X for the entire startup + active window so a held
    // forward input can't lunge the punch into range -- the hit has
    // to land from where the button was actually pressed.
    p.attackStartX = p.position[0];
    p.velX = 0;
    setAnim(p, move);

    // Track the player's recent moves for the AI counter model.
    const history = playerMoveHistoryRef.current;
    history.push(move);
    while (history.length > 8) history.shift();

    // Ask Gemma (or the client fallback) for a counter suggestion.
    if (Math.random() < 0.70) requestNPCCounterMove();
  }

  function startNPCAttack(move) {
    const n = npcRef.current;
    if (n.hitstun > 0 || n.isAttacking || n.hp <= 0) return;
    const ctx = {
      isGrappled: n.anim === 'clinched',
      isFatigued: n.stamina < 20,
    };
    if (!canUseMove(move, n.stamina, ctx)) return;
    n.stamina = spendStamina(n.stamina, move, ctx);
    n.isAttacking = true;
    n.isBlocking = false;
    // Same lock as the player: freeze the X at attack start so the
    // AI's own approach velocity can't drag the NPC into range.
    n.attackStartX = n.position[0];
    n.velX = 0;
    setAnim(n, move);
  }

  function applyHitResult(result, attacker, defender, isPlayerAttacker) {
    // Backstep i-frames: the first 0.05s of a backstep is fully invulnerable.
    if (defender.anim === 'backstep' && (defender.stateTimer || 0) > BACKSTEP_TOTAL - BACKSTEP_IFRAME_DURATION) {
      return;
    }
    if (result.hit) {
      defender.hp = result.hpLeft;
      defender.isHit = true;
      setTimeout(() => {
        defender.isHit = false;
      }, 80);

      const reaction = result.reaction;
      const moveData = MOVE_DATA[attacker.anim];
      const heavy = Boolean(moveData?.tags?.includes('heavy'));
      const isCrit =
        result.counterHit ||
        reaction === REACTIONS.KNOCKDOWN ||
        reaction === REACTIONS.FALL;
      const duration = getReactionDuration(reaction, heavy);
      defender.hitstun = Math.max(defender.hitstun, duration);
      defender.hitstunDuration = Math.max(defender.hitstunDuration || 0, defender.hitstun);
      setAnim(defender, reaction === REACTIONS.FALL ? 'fall' : reaction);

      // Knockback (with corner crush).
      const kbDir = defender.position[0] > attacker.position[0] ? 1 : -1;
      let kbApplied = result.knockback;
      if (kbApplied) {
        const nearLeft = defender.position[0] <= -ARENA_HALF_WIDTH + 1.5;
        const nearRight = defender.position[0] >= ARENA_HALF_WIDTH - 1.5;
        const nearWall = nearLeft || nearRight;
        if (nearWall) {
          kbApplied *= 0.5;
        }
        defender.position[0] += kbDir * kbApplied;
        if (nearWall) {
          // extra shake + hitstop to sell the corner crush
          gameRef.current.screenShake = Math.max(gameRef.current.screenShake, 0.15);
          gameRef.current.freezeFrames = Math.max(gameRef.current.freezeFrames, 0.03);
        }
      }

      // Attacker pushback.
      if (moveData?.attackerPushback) {
        attacker.position[0] -= kbDir * moveData.attackerPushback;
      }

      // Procedural torso tilts: sell the weight transfer of a landed blow.
      // Attacker tilts forward (follow-through); defender tilts back (impact).
      const tiltMag = isCrit ? 0.32 : heavy ? 0.26 : 0.2;
      attacker.attackerPushbackTilt = Math.max(attacker.attackerPushbackTilt || 0, tiltMag);
      defender.knockbackTilt = Math.max(defender.knockbackTilt || 0, tiltMag + 0.05);

      // Combo tracking.
      attacker.comboCount += 1;
      attacker.comboTimer = COMBO_RESET_TIME;

      // Visuals.
      const hitPos = [
        (attacker.position[0] + defender.position[0]) / 2,
        1.2,
        (attacker.position[2] + defender.position[2]) / 2,
      ];

      // Small stamina back to the attacker on a critical hit, rewarding a committed heavy.
      if (isCrit) {
        attacker.stamina = Math.min(
          STAMINA_CONFIG.maxStamina,
          attacker.stamina + CRIT_STAMINA_REWARD
        );
      }

      const impactCount = isCrit ? 34 : heavy ? 22 : 14;
      spawnImpact(hitPos, { count: impactCount, isCrit, isPlayer: isPlayerAttacker, move: attacker.anim });
      spawnSplatter(hitPos, { isCrit, isPlayer: isPlayerAttacker, move: attacker.anim });
      if (impactLightsRef.current) {
        impactLightsRef.current.spawn(
          hitPos,
          attacker.config?.accentColor || '#ff3344'
        );
      }
      if (isCrit || heavy) {
        spawnShockwave(hitPos, {
          isPlayer: isPlayerAttacker,
          maxRadius: isCrit ? 3.8 : 2.4,
        });
      }
      // Per-move shake and hitstop, read from MOVE_DATA for the current move.
      const baseShake = moveData?.shake ?? (isCrit ? 0.45 : 0.22);
      const baseHitstop = moveData?.hitstop ?? (isCrit ? 0.08 : 0.04);
      const reactionBonus =
        reaction === REACTIONS.KNOCKDOWN || reaction === REACTIONS.FALL ? 0.04 : 0;
      const critBonus = isCrit ? 0.03 : 0;
      gameRef.current.screenShake = Math.max(gameRef.current.screenShake, baseShake);
      gameRef.current.freezeFrames = Math.max(
        gameRef.current.freezeFrames,
        baseHitstop + reactionBonus + critBonus
      );

      // Camera recoil (opposite the hit direction).
      if (!gameRef.current.camRecoil) {
        gameRef.current.camRecoil = { x: 0, y: 0, intensity: 0 };
      }
      gameRef.current.camRecoil.x = -kbDir * (isCrit ? 0.30 : 0.18) * (1 + (heavy ? 0.4 : 0));
      gameRef.current.camRecoil.y = (isCrit || heavy) ? 0.10 : 0.05;
      gameRef.current.camRecoil.intensity = 1.0;

      // Cinematic roll on heavy hits: knockdowns, roundhouses, uppercuts, throws.
      const isHeavyHit =
        reaction === REACTIONS.KNOCKDOWN ||
        reaction === REACTIONS.FALL ||
        attacker.anim === 'roundhouse' ||
        attacker.anim === 'uppercut' ||
        attacker.anim === 'throw';
      if (isHeavyHit) {
        const rollMag = (isCrit || heavy) ? 0.08 : 0.05;
        gameRef.current.camRoll = -kbDir * rollMag;
      }

      // Cinematic zoom punch on crits.
      if (isCrit) {
        gameRef.current.camZoomPulse = 0.08;
      }

      // Primary hit event for the HUD / VFX agents.
      window.dispatchEvent(
        new CustomEvent('game-vfx', {
          detail: {
            type: 'hit',
            color: isCrit ? '#ffd700' : isPlayerAttacker ? '#2ec4b6' : '#e71d36',
            crit: isCrit,
            heavy,
            position: hitPos,
            groundSplatter: heavy,
          },
        })
      );
      // Dedicated crit screen flash.
      if (isCrit) {
        window.dispatchEvent(
          new CustomEvent('game-vfx', {
            detail: {
              type: 'screenFlash',
              color: '#ffd700',
              crit: true,
              heavy,
            },
          })
        );
      }
      // Big impact marker for the camera / AuraRenderer on knockdowns / falls / throws.
      if (
        reaction === REACTIONS.KNOCKDOWN ||
        reaction === REACTIONS.FALL ||
        attacker.anim === 'throw'
      ) {
        window.dispatchEvent(
          new CustomEvent('game-vfx', {
            detail: {
              type: 'heavyImpact',
              position: hitPos,
              color: isCrit ? '#ffd700' : '#ff3344',
              crit: isCrit,
              heavy,
            },
          })
        );
      }
    } else if (result.blocked) {
      defender.hp = result.hpLeft;
      defender.stamina = result.staminaLeft;
      const moveData = MOVE_DATA[attacker.anim];
      const blockedShake = moveData?.blockedShake ?? 0.10;
      gameRef.current.screenShake = Math.max(gameRef.current.screenShake, blockedShake);
      gameRef.current.freezeFrames = Math.max(
        gameRef.current.freezeFrames,
        moveData?.blockedHitstop ?? 0.03
      );
      const blockPos = [
        (attacker.position[0] + defender.position[0]) / 2,
        1.1,
        (attacker.position[2] + defender.position[2]) / 2,
      ];
      spawnImpact(blockPos, {
        count: 10,
        isPlayer: isPlayerAttacker,
        move: attacker.anim,
        isBlock: true,
      });
      if (result.knockback) {
        const kbDir = defender.position[0] > attacker.position[0] ? 1 : -1;
        defender.position[0] += kbDir * result.knockback;
        if (moveData?.attackerPushback) {
          attacker.position[0] -= kbDir * moveData.attackerPushback * 0.4;
        }
      }
      window.dispatchEvent(
        new CustomEvent('game-vfx', {
          detail: {
            type: 'blocked',
            color: isPlayerAttacker ? '#2ec4b6' : '#e71d36',
            crit: false,
            heavy: false,
            position: blockPos,
          },
        })
      );
    } else if (result.parried) {
      defender.stamina = Math.min(
        STAMINA_CONFIG.maxStamina,
        defender.stamina + result.staminaReward
      );
      gameRef.current.screenShake = Math.max(gameRef.current.screenShake, 0.18);
      spawnShockwave(defender.position, { isPlayer: !isPlayerAttacker, maxRadius: 2.2 });
      window.dispatchEvent(
        new CustomEvent('game-vfx', {
          detail: {
            type: 'parried',
            color: isPlayerAttacker ? '#e71d36' : '#2ec4b6',
            crit: false,
            heavy: false,
            position: defender.position,
          },
        })
      );
    }
  }

  function resolveAttackerHit(attacker, defender, isPlayerAttacker) {
    const data = MOVE_DATA[attacker.anim];
    if (!data || attacker.hitConnected) return;
    const duration = getMoveDuration(attacker.anim);
    const localTime = attacker.animProgress * duration;
    const inActive = localTime >= data.startup && localTime <= data.startup + data.active;
    if (!inActive) return;

    const distance = edgeDist(attacker.position, defender.position);
    const ctx = { comboCount: attacker.comboCount, defenderIsGrappled: defender.anim === 'clinched' };

    if (attacker.anim === 'clinch') {
      const result = resolveClinch(attacker, defender, distance);
      if (result.success) {
        attacker.hitConnected = true;
        applyHitResult(result, attacker, defender, isPlayerAttacker);
      }
      return;
    }

    if (attacker.anim === 'throw') {
      const result = resolveThrow(attacker, defender, distance);
      if (result.success) {
        attacker.hitConnected = true;
        applyHitResult(result, attacker, defender, isPlayerAttacker);
      }
      return;
    }

    const result = resolveAttack(
      {
        move: attacker.anim,
        animProgress: attacker.animProgress,
        position: attacker.position,
        facing: attacker.facing,
        isAttacking: attacker.isAttacking,
      },
      defender,
      distance,
      0,
      ctx
    );
    if (result.hit || result.blocked || result.parried) {
      attacker.hitConnected = true;
      applyHitResult(result, attacker, defender, isPlayerAttacker);
    } else if (result.reason && import.meta.env.DEV) {
      // Dev-only: surface why a hit missed so the realism changes are
      // visible in the browser console. Production builds drop this
      // branch entirely (import.meta.env.DEV is false).
      console.debug(
        `[combat] ${attacker.anim} missed: ${result.reason} (dist=${distance.toFixed(2)})`
      );
    }
  }

  function updateAnimation(fighter, dt) {
    if (fighter.hitstun > 0) {
      // Map animProgress 0..1 cleanly across the hitstun window so reactions
      // (flinch 0.30s, fall 1.6s, etc.) play through in full.
      const dur = fighter.hitstunDuration || 0.30;
      fighter.animProgress = dur > 0
        ? Math.max(0, Math.min(1, 1 - (fighter.hitstun / dur)))
        : 0;

      // The landing-dust on knockdown / fall crossings is emitted by
      // SilhouetteFighter via the onFootstep callback.

      fighter.hitstun -= dt;
      if (fighter.hitstun <= 0) {
        fighter.hitstun = 0;
        fighter.isAttacking = false;
        fighter.isBlocking = false;
        setAnim(fighter, 'idle');
      }
      return;
    }

    // Hold block pose while the fighter is still blocking.
    if (fighter.anim === 'block' && fighter.isBlocking) {
      fighter.animProgress = 0;
      return;
    }

    const duration = getMoveDuration(fighter.anim);
    if (duration > 0) {
      fighter.animProgress += dt / duration;
    }

    if (fighter.animProgress >= 1) {
      // The walk animation is a continuous cycle: when the progress
      // reaches 1 we wrap back to 0 and keep playing. Every other
      // anim (attacks, reactions) plays once and transitions to idle.
      if (fighter.anim === 'walk') {
        fighter.animProgress = fighter.animProgress % 1;
      } else {
        fighter.animProgress = 0;
        fighter.isAttacking = false;
        fighter.isBlocking = false;
        fighter.anim = 'idle';
        fighter.hitConnected = false;
      }
    }
  }

  function resetRound(winner) {
    const g = gameRef.current;
    if (winner === 'player') g.playerScore += 1;
    else if (winner === 'npc') g.npcScore += 1;

    if (g.playerScore >= 2 || g.npcScore >= 2) {
      g.gameOver = true;
      g.matchWinner = g.playerScore >= 2 ? 'player' : 'npc';
      if (onGameOver) onGameOver(g.matchWinner);
      return;
    }

    g.round += 1;
    g.roundOver = false;
    g.roundOverTimer = 0;
    g.winner = null;
    g.time = 0;
    gamePhaseRef.current = 'intro';
    introTimerRef.current = 1.2;

    playerRef.current = createFighterState(playerCharacter, true, -5);
    npcRef.current = createFighterState(npcCharacter, false, 5);
    aiMemoryRef.current = resetAI();
    playerMoveHistoryRef.current = [];
    pendingGemmaMoveRef.current = null;

    if (onRoundEnd) onRoundEnd(g);
  }

  function checkRoundOver() {
    const g = gameRef.current;
    if (g.roundOver) {
      g.roundOverTimer += 0.016;
      if (g.roundOverTimer >= ROUND_OVER_DELAY) {
        resetRound(g.winner);
      }
      return;
    }

    if (playerRef.current.hp <= 0 && !g.roundOver) {
      g.roundOver = true;
      g.winner = 'npc';
      setAnim(playerRef.current, 'fall');
      playerRef.current.hitstun = 1.5;
      playerRef.current.hitstunDuration = 1.5;
    } else if (npcRef.current.hp <= 0 && !g.roundOver) {
      g.roundOver = true;
      g.winner = 'player';
      setAnim(npcRef.current, 'fall');
      npcRef.current.hitstun = 1.5;
      npcRef.current.hitstunDuration = 1.5;
    }
  }

  useFrame((state, delta) => {
    if (paused || gameRef.current.gameOver) return;

    const rawDt = Math.min(delta, 0.05);
    if (gameRef.current.freezeFrames > 0) {
      gameRef.current.freezeFrames -= rawDt;
      return;
    }
    const dt = rawDt;

    // Intro freeze for cinematic round start.
    if (gamePhaseRef.current === 'intro') {
      introTimerRef.current -= dt;
      if (introTimerRef.current <= 0) gamePhaseRef.current = 'fighting';
      return;
    }

    const p = playerRef.current;
    const n = npcRef.current;
    const g = gameRef.current;
    g.time += dt;

    // ----- Player input -----
    const prev = { ...prevInputRef.current };
    Object.assign(prevInputRef.current, { ...inputRef.current });
    const input = inputRef.current;

    if (pauseStarted(input, prev)) {
      if (onPause) onPause();
      return;
    }

    const attack = getAttackInput(input, prev);
    if (attack && !p.isAttacking && p.hitstun <= 0 && p.hp > 0) {
      startPlayerAttack(attack);
    }

    // Blocking.
    if (p.hitstun <= 0 && p.hp > 0 && !p.isAttacking) {
      if (input.block) {
        p.isBlocking = true;
        p.anim = 'block';
        p.animProgress = 0;
      } else if (p.isBlocking && blockEnded(input, prev)) {
        p.isBlocking = false;
        setAnim(p, 'idle');
      }
    }

    // Backstep / dodge.
    if (backstepStarted(input, prev) && !p.isAttacking && p.hitstun <= 0 && p.hp > 0) {
      const ctx = { isGrappled: n.anim === 'clinch', isFatigued: p.stamina < 20 };
      if (canUseMove('backstep', p.stamina, ctx)) {
        p.stamina = spendStamina(p.stamina, 'backstep', ctx);
        setAnim(p, 'backstep');
        p.stateTimer = BACKSTEP_TOTAL;
        p.velX = 0;
        p.velZ = 0;
        p.isAttacking = false;
      }
    }

    // Movement (velocity-based).
    if (p.hitstun <= 0 && p.hp > 0 && !p.isAttacking && !p.isBlocking) {
      const move = getMovementVector(input);
      const hasMove = move.x !== 0 || move.z !== 0;
      let targetVx = 0;
      let targetVz = 0;
      if (hasMove) {
        // Backward detection: moving away from the opponent the fighter faces.
        const isBackward =
          (move.x > 0 && p.facing < 0) || (move.x < 0 && p.facing > 0);
        let backMul = isBackward ? BACKWARD_MOVE_PENALTY : 1.0;
        // Edge penalty: when within EDGE_SLOW_DISTANCE of an arena wall, the
        // fighter can't retreat any further at full speed (corner pressure).
        const distToEdge = ARENA_HALF_WIDTH - Math.abs(p.position[0]);
        if (distToEdge < EDGE_SLOW_DISTANCE && isBackward) {
          backMul *= EDGE_SLOW_FACTOR;
        }
        targetVx = move.x * MOVE_SPEED * backMul;
        targetVz = move.z * MOVE_SPEED;
      }
      // Velocity-based acceleration model: vel approaches target exponentially.
      p.velX += (targetVx - p.velX) * MOVEMENT_ACCEL * dt;
      p.velZ += (targetVz - p.velZ) * MOVEMENT_ACCEL * dt;
      p.position[0] += p.velX * dt;
      p.position[2] += p.velZ * dt;

      // Attack lock: while the fighter is in startup + active of an
      // attack, their X position is frozen to attackStartX (snapshotted
      // in startPlayerAttack). This stops a held forward key from
      // lunging the punch into range so it lands "at touching distance"
      // visually. The lock is released during recovery so the fighter
      // can re-position for the next move.
      if (p.isAttacking && p.attackStartX != null) {
        const data = MOVE_DATA[p.anim];
        if (data) {
          const total = data.startup + data.active + data.recovery;
          const t = (p.animProgress || 0) * total;
          if (t <= data.startup + data.active) {
            p.position[0] = p.attackStartX;
            p.velX = 0;
          } else {
            p.attackStartX = null;
          }
        }
      }

      if (hasMove) {
        if (p.anim !== 'backstep') p.anim = 'walk';
        if (Math.abs(move.x) > 0.01) p.facing = move.x > 0 ? 1 : -1;
      } else if (p.anim === 'walk' && Math.abs(p.velX) < 0.1 && Math.abs(p.velZ) < 0.1) {
        p.anim = 'idle';
        p.animProgress = 0;
      }
    } else {
      // Decay velocity when the fighter can't actively move (hitstun, attack,
      // block, etc.) so the model settles.
      p.velX += (0 - p.velX) * MOVEMENT_ACCEL * dt;
      p.velZ += (0 - p.velZ) * MOVEMENT_ACCEL * dt;
    }

    // Backstep phase model: i-frames (no movement) -> active (dodging) -> recovery.
    // The slide dust is emitted by SilhouetteFighter via the onFootstep callback.
    if (p.anim === 'backstep' && p.stateTimer > 0) {
      p.stateTimer -= dt;
      const elapsed = BACKSTEP_TOTAL - p.stateTimer;
      if (
        elapsed >= BACKSTEP_IFRAME_DURATION &&
        elapsed < BACKSTEP_IFRAME_DURATION + BACKSTEP_ACTIVE_DURATION
      ) {
        p.position[0] += -p.facing * DODGE_SPEED * dt;
      }
      if (p.stateTimer <= 0) {
        setAnim(p, 'idle');
      }
    }

    // ----- Stamina regen -----
    p.stamina = regenStamina(p.stamina, dt, {
      isBlocking: p.isBlocking,
      isAttacking: p.isAttacking,
      isHit: p.isHit,
      isGrappled: p.anim === 'clinched',
    });
    n.stamina = regenStamina(n.stamina, dt, {
      isBlocking: n.isBlocking,
      isAttacking: n.isAttacking,
      isHit: n.isHit,
      isGrappled: n.anim === 'clinched',
    });

    // ----- NPC AI -----
    if (n.hp > 0 && n.hitstun <= 0) {
      const decision = decideNPCAction(
        {
          game: g,
          archetype: npcArchetype,
          npcCharacterId: npcCharacter?.id,
          playerHistory: playerMoveHistoryRef.current.slice(-5),
          player: {
            position: p.position,
            facing: p.facing,
            anim: p.anim,
            animProgress: p.animProgress,
            isAttacking: p.isAttacking,
            hp: p.hp,
            stamina: p.stamina,
          },
          npc: {
            position: n.position,
            facing: n.facing,
            anim: n.anim,
            animProgress: n.animProgress,
            isAttacking: n.isAttacking,
            hp: n.hp,
            stamina: n.stamina,
            state: n.state,
            stateTimer: n.stateTimer,
          },
          pendingGemmaMove: pendingGemmaMoveRef.current,
          ai: aiMemoryRef.current,
          dt,
        },
        {
          arenaHalfWidth: ARENA_HALF_WIDTH,
          arenaHalfDepth: ARENA_HALF_DEPTH,
        }
      );

      // Update AI memory.
      aiMemoryRef.current = decision.ai || aiMemoryRef.current;
      pendingGemmaMoveRef.current = null;

      // Apply decision.
      n.facing = decision.facing ?? n.facing;
      n.state = decision.state || n.state;

      if (decision.move && decision.state === NPC_STATES.ATTACKING) {
        if (!n.isAttacking) startNPCAttack(decision.move);
      } else if (decision.move === 'parry') {
        if (!n.isAttacking && n.anim !== 'parry') {
          n.stamina = spendStamina(n.stamina, 'parry');
          setAnim(n, 'parry');
          n.stateTimer = decision.duration || 0.32;
        }
      } else if (decision.move === 'backstep') {
        if (n.anim !== 'backstep') {
          n.stamina = spendStamina(n.stamina, 'backstep');
          setAnim(n, 'backstep');
          n.stateTimer = decision.duration || BACKSTEP_TOTAL;
        }
      } else if (decision.move === 'clinch') {
        if (!n.isAttacking) startNPCAttack('clinch');
      } else if (decision.move === 'throw') {
        if (!n.isAttacking) startNPCAttack('throw');
      } else if (decision.state === NPC_STATES.BLOCKING) {
        n.isBlocking = true;
        n.anim = 'block';
        n.animProgress = 0;
        n.stateTimer = decision.duration || 0.55;
      } else if (decision.velocity) {
        n.velX = decision.velocity[0] * MOVE_SPEED;
        n.velZ = decision.velocity[2] * MOVE_SPEED;
        n.position[0] += n.velX * dt;
        n.position[2] += n.velZ * dt;
        if (decision.anim) n.anim = decision.anim;
      } else {
        // Decay NPC velocity when the AI isn't actively moving, so the
        // procedural lean in SilhouetteFighter settles to neutral.
        n.velX += (0 - n.velX) * MOVEMENT_ACCEL * dt;
        n.velZ += (0 - n.velZ) * MOVEMENT_ACCEL * dt;
      }

      // Attack lock (NPC): same as the player -- the X is frozen at
      // attackStartX during startup + active. Without this, the AI's
      // own approach velocity could drag the NPC's punch into range
      // and make every attack land.
      if (n.isAttacking && n.attackStartX != null) {
        const data = MOVE_DATA[n.anim];
        if (data) {
          const total = data.startup + data.active + data.recovery;
          const t = (n.animProgress || 0) * total;
          if (t <= data.startup + data.active) {
            n.position[0] = n.attackStartX;
            n.velX = 0;
          } else {
            n.attackStartX = null;
          }
        }
      }
    }

    // NPC state timers (block / parry / backstep timeout).
    if (n.stateTimer > 0) {
      n.stateTimer -= dt;
      if (n.stateTimer <= 0) {
        n.isBlocking = false;
        setAnim(n, 'idle');
      }
    }

    // NPC backstep velocity (phase model: i-frames -> active -> recovery).
    // The slide dust is emitted by SilhouetteFighter via the onFootstep callback.
    if (n.anim === 'backstep' && n.stateTimer > 0) {
      const elapsed = BACKSTEP_TOTAL - n.stateTimer;
      if (
        elapsed >= BACKSTEP_IFRAME_DURATION &&
        elapsed < BACKSTEP_IFRAME_DURATION + BACKSTEP_ACTIVE_DURATION
      ) {
        n.position[0] += -n.facing * DODGE_SPEED * dt;
      }
    }

    // Clamp positions.
    p.position = clampArena(p.position);
    n.position = clampNPCPosition(n.position, {
      arenaHalfWidth: ARENA_HALF_WIDTH,
      arenaHalfDepth: ARENA_HALF_DEPTH,
    });

    // Ensure fighters face each other.
    if (p.hp > 0) p.facing = p.position[0] < n.position[0] ? 1 : -1;
    if (n.hp > 0) n.facing = n.position[0] < p.position[0] ? 1 : -1;

    // ----- Resolve hits -----
    if (!g.roundOver) {
      if (p.isAttacking) resolveAttackerHit(p, n, true);
      if (n.isAttacking) resolveAttackerHit(n, p, false);
    }

    // ----- Update animations -----
    updateAnimation(p, dt);
    updateAnimation(n, dt);

    // ----- Combo decay -----
    if (p.comboTimer > 0) {
      p.comboTimer -= dt;
      if (p.comboTimer <= 0) p.comboCount = 0;
    }
    if (n.comboTimer > 0) {
      n.comboTimer -= dt;
      if (n.comboTimer <= 0) n.comboCount = 0;
    }

    // ----- Round / game over -----
    checkRoundOver();
  });

  return (
    <>
      <AdaptiveDpr pixelated />
      <color attach="background" args={[arena?.fog?.color || '#05040a']} />
      {arena?.fog && (
        <fog attach="fog" args={[arena.fog.color, arena.fog.near, arena.fog.far]} />
      )}
      <FightCamera playerRef={playerRef} npcRef={npcRef} gameRef={gameRef} />

      {ArenaComponent && <ArenaComponent arena={arena} />}

      <GLBFighter
        stateRef={playerRef}
        character={playerCharacter}
        isPlayer
        onFootstep={onFootstep}
        onBackstepLanding={onBackstepLanding}
      />
      <GLBFighter
        stateRef={npcRef}
        character={npcCharacter}
        isPlayer={false}
        onFootstep={onFootstep}
        onBackstepLanding={onBackstepLanding}
      />

      <ParticleSystem />
      <ShockwaveRenderer />
      <SplatterRenderer />
      <ImpactLights ref={impactLightsRef} />

      <ArenaPostFx postFx={arena?.postFx} gameRef={gameRef} />
    </>
  );
}

export default forwardRef(Game);
