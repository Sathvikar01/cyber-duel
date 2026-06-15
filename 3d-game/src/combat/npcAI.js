import {
  MOVE_DATA,
  isGemmaMove,
  getMoveDuration,
} from './moveData.js';
import { canUseMove } from './stamina.js';
import {
  AI_ARCHETYPES,
  resolveArchetype,
  getArchetypeForCharacter,
  getDifficultyProfile,
} from './aiArchetypes.js';
import { evaluateDefense } from './aiDefense.js';
import {
  chooseAttack,
  planCombo,
  shouldFeint,
  generateMockCounter,
} from './aiOffense.js';
import {
  getRangeState,
  getMovementIntent,
  cornerEscapeVector,
  velocityForIntent,
} from './aiMovement.js';

/**
 * NPC orchestrator.
 *
 * The orchestrator threads the archetype, defense, offense and movement
 * helpers together. It receives a read-only snapshot of the world and returns
 * the next action/state patch for Game.jsx to apply on the next frame.
 *
 * Public API kept stable for Game.jsx:
 *   - decideNPCAction(input, cfg)
 *   - resetAI()
 *   - NPC_STATES
 *   - clampNPCPosition(pos, cfg)
 *   - getDifficultyProfile(archetype, round)
 */

export const NPC_STATES = Object.freeze({
  IDLE: 'idle',
  APPROACH: 'approach',
  RETREAT: 'retreat',
  ATTACKING: 'attacking',
  BLOCKING: 'block',
  PARRYING: 'parry',
  BACKSTEPPING: 'backstep',
  CLINCHING: 'clinch',
  THROWING: 'throw',
  RECOVER: 'recover',
  CORNERED: 'cornered',
  FEINTING: 'feinting',
  WAITING: 'waiting',
});

const DEFAULT_AI_CONFIG = Object.freeze({
  arenaHalfWidth: 15,
  arenaHalfDepth: 10,
  clinchRange: 2.4,
  closeRange: 4.0,
  kickRange: 4.6,
  tooCloseRange: 2.0,
  cornerThreshold: 3.5,
  baseDecisionCooldown: 0.85,
  blockDuration: 0.55,
  parryDuration: 0.32,
  backstepDuration: 0.28,
  backstepDistance: 2.2,
  approachSpeedFactor: 0.72,
  retreatSpeedFactor: 0.65,
  staleWindowSize: 4,
  parryCooldownAfterUse: 0.65,
  grappleCooldownAfterUse: 1.20,
  feintCooldown: 1.4,
});

const STALE_PENALTY = 0.32;

function dist2D(a, b) {
  const dx = (a[0] || 0) - (b[0] || 0);
  const dz = (a[2] || 0) - (b[2] || 0);
  return Math.sqrt(dx * dx + dz * dz);
}

function recordMove(history, move, windowSize = DEFAULT_AI_CONFIG.staleWindowSize) {
  if (!Array.isArray(history)) return [move];
  history.push(move);
  while (history.length > windowSize) history.shift();
  return history;
}

function getStalePenalty(history, move) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const recent = history.slice(-DEFAULT_AI_CONFIG.staleWindowSize);
  const repeats = recent.filter((m) => m === move).length;
  return Math.min(0.85, repeats * STALE_PENALTY);
}

function isCommitted(npc) {
  if (!npc) return false;
  if (npc.isAttacking) return true;
  return [
    NPC_STATES.PARRYING,
    NPC_STATES.BACKSTEPPING,
    NPC_STATES.CLINCHING,
    NPC_STATES.THROWING,
  ].includes(npc.state);
}

function decayMemory(memory, dt) {
  const next = {
    history: Array.isArray(memory.history) ? memory.history.slice() : [],
    cooldown: Math.max(0, (memory.cooldown || 0) - dt),
    reactionTimer: Math.max(0, (memory.reactionTimer || 0) - dt),
    parryCooldown: Math.max(0, (memory.parryCooldown || 0) - dt),
    grappleCooldown: Math.max(0, (memory.grappleCooldown || 0) - dt),
    feintCooldown: Math.max(0, (memory.feintCooldown || 0) - dt),
    consecutiveBlocks: memory.consecutiveBlocks || 0,
    prevPlayerAttacking: Boolean(memory.prevPlayerAttacking),
    comboPlan: Array.isArray(memory.comboPlan) ? memory.comboPlan.slice() : [],
    lastChosen: memory.lastChosen || null,
  };
  return next;
}

function buildMovementPatch(intent, dx, dz, dist, archetype, npc, cfg) {
  switch (intent) {
    case 'approach':
      return {
        state: NPC_STATES.APPROACH,
        anim: 'walk',
        velocity: velocityForIntent('approach', dx, dz, dist, archetype, cfg),
      };
    case 'retreat':
      return {
        state: NPC_STATES.RETREAT,
        anim: 'walk',
        velocity: velocityForIntent('retreat', dx, dz, dist, archetype, cfg),
      };
    case 'circle':
      return {
        state: NPC_STATES.APPROACH,
        anim: 'walk',
        velocity: velocityForIntent('circle', dx, dz, dist, archetype, cfg),
      };
    case 'microMove':
      return {
        state: NPC_STATES.IDLE,
        anim: 'idle',
        velocity: velocityForIntent('microMove', dx, dz, dist, archetype, cfg),
      };
    case 'escapeCorner':
      return {
        state: NPC_STATES.CORNERED,
        anim: 'walk',
        velocity: cornerEscapeVector(
          npc.position,
          [npc.position[0] + dx, 0, (npc.position[2] || 0) + dz],
          cfg
        ),
      };
    case 'hold':
    default:
      return { state: NPC_STATES.IDLE, anim: 'idle', velocity: [0, 0, 0] };
  }
}

/**
 * Resolve the archetype for this input call.
 *
 * Accepts either an archetype object on the input, or a character id on
 * `input.npcCharacterId` / `input.game.npcCharacterId`. Falls back to balanced.
 */
function resolveInputArchetype(input) {
  if (input?.archetype) return resolveArchetype(input.archetype);
  const charId = input?.npcCharacterId || input?.game?.npcCharacterId;
  if (charId) return getArchetypeForCharacter(charId);
  return AI_ARCHETYPES.balanced;
}

/**
 * Pick an attack from the queued combo plan if one is still legal.
 */
function consumeComboPlan(memory, npcStamina) {
  while (memory.comboPlan.length > 0) {
    const next = memory.comboPlan.shift();
    if (canUseMove(next, npcStamina) && getStalePenalty(memory.history, next) < 0.6) {
      return next;
    }
  }
  return null;
}

/**
 * Main NPC decision helper.
 *
 * @param {object} input
 * @param {object} input.game   { round, ... }
 * @param {object} input.player { position[], facing, anim, animProgress, isAttacking, hp, stamina }
 * @param {object} input.npc    { position[], facing, anim, animProgress, isAttacking, hp, stamina, state, stateTimer }
 * @param {string|null} [input.pendingGemmaMove]
 * @param {object} [input.archetype] resolved archetype or archetype id
 * @param {string} [input.npcCharacterId]
 * @param {string[]} [input.playerHistory] last few player moves (most recent last)
 * @param {object} input.ai     internal AI memory
 * @param {number} input.dt
 * @param {object} [cfg]
 * @returns {object} next action/state patch for the NPC
 */
export function decideNPCAction(input, cfg = DEFAULT_AI_CONFIG) {
  const config = { ...DEFAULT_AI_CONFIG, ...cfg };
  const { game, player, npc, pendingGemmaMove, dt } = input;

  const archetype = resolveInputArchetype(input);
  const difficulty = getDifficultyProfile(archetype, game?.round || 1);
  const playerHistory = Array.isArray(input.playerHistory) ? input.playerHistory : [];

  const dist = dist2D(player.position, npc.position);
  const dx = (player.position[0] || 0) - (npc.position[0] || 0);
  const dz = (player.position[2] || 0) - (npc.position[2] || 0);
  const facing = dx > 0 ? 1 : -1;

  const memory = decayMemory(input.ai || {}, dt);

  // ---- Reaction timer book-keeping ----
  const playerAttackingNow = Boolean(player && player.isAttacking);
  const playerStartedAttack = playerAttackingNow && !memory.prevPlayerAttacking;
  if (playerStartedAttack) {
    // Pattern-aware reaction: if the player has repeated this move recently,
    // the NPC has learned it and shaves a chunk off its reaction window.
    const recent = playerHistory.slice(-4);
    const sameAsLast = recent.filter((m) => m === player.anim).length;
    const learningBonus = Math.min(0.6, Math.max(0, sameAsLast - 1) * 0.2);
    const adjustedReaction = (difficulty.reactionTime || 0.2) * (1 - learningBonus);
    memory.reactionTimer = Math.max(0, adjustedReaction - dt * 0.5);
  }
  if (!playerAttackingNow) memory.consecutiveBlocks = 0;
  memory.prevPlayerAttacking = playerAttackingNow;

  // ---- If already committed to an action, keep executing it. ----
  if (isCommitted(npc)) {
    return {
      state: npc.state,
      anim: npc.anim,
      move: npc.anim,
      facing,
      ai: memory,
    };
  }

  // ---- Defensive reactions (only after reaction delay elapses) ----
  if (playerAttackingNow && memory.cooldown <= 0 && memory.reactionTimer <= 0) {
    const defense = evaluateDefense(
      player,
      player.anim,
      dist,
      npc.stamina,
      archetype,
      difficulty,
      memory
    );

    if (defense && defense.move && defense.move !== 'none') {
      // Apply post-decision cooldown.
      memory.cooldown = config.baseDecisionCooldown;

      if (defense.move === 'parry') {
        memory.parryCooldown = config.parryCooldownAfterUse;
        memory.consecutiveBlocks = 0;
        recordMove(memory.history, 'parry');
        return {
          state: NPC_STATES.PARRYING,
          anim: 'parry',
          move: 'parry',
          facing,
          duration: config.parryDuration,
          ai: memory,
        };
      }

      if (defense.move === 'backstep') {
        memory.consecutiveBlocks = 0;
        recordMove(memory.history, 'backstep');
        return {
          state: NPC_STATES.BACKSTEPPING,
          anim: 'backstep',
          move: 'backstep',
          facing,
          duration: config.backstepDuration,
          velocity: [
            -Math.sign(dx || 1) * config.backstepDistance / config.backstepDuration,
            0,
            -dz * 0.3,
          ],
          ai: memory,
        };
      }

      if (defense.move === 'throw') {
        memory.grappleCooldown = config.grappleCooldownAfterUse;
        memory.consecutiveBlocks = 0;
        recordMove(memory.history, 'throw');
        return {
          state: NPC_STATES.THROWING,
          anim: 'throw',
          move: 'throw',
          facing,
          ai: memory,
        };
      }

      // Block - count toward consecutive blocks.
      memory.consecutiveBlocks += 1;
      return {
        state: NPC_STATES.BLOCKING,
        anim: 'block',
        move: null,
        facing,
        duration: config.blockDuration,
        ai: memory,
      };
    }
  }

  // Still waiting for the reaction window? Hold/face the player.
  if (playerAttackingNow && memory.reactionTimer > 0) {
    return {
      state: NPC_STATES.WAITING,
      anim: npc.anim === 'walk' ? 'walk' : 'idle',
      move: null,
      facing,
      velocity: [0, 0, 0],
      ai: memory,
    };
  }

  // ---- Offensive decision when no immediate threat. ----
  if (memory.cooldown <= 0) {
    // Drain pending combo first.
    const queued = consumeComboPlan(memory, npc.stamina);
    if (queued) {
      memory.cooldown = config.baseDecisionCooldown * 0.55; // combos chain faster
      memory.lastChosen = queued;
      recordMove(memory.history, queued);
      return {
        state: NPC_STATES.ATTACKING,
        anim: queued,
        move: queued,
        facing,
        ai: memory,
      };
    }

    // Grapple opportunity when up close.
    if (
      dist <= config.clinchRange &&
      memory.grappleCooldown <= 0 &&
      Math.random() < difficulty.grappleChance
    ) {
      const useThrow = canUseMove('throw', npc.stamina) && Math.random() < 0.45;
      const useClinch = canUseMove('clinch', npc.stamina);
      const choice = useThrow ? 'throw' : (useClinch ? 'clinch' : null);
      if (choice) {
        memory.cooldown = config.baseDecisionCooldown;
        memory.grappleCooldown = config.grappleCooldownAfterUse;
        memory.lastChosen = choice;
        recordMove(memory.history, choice);
        return {
          state: choice === 'throw' ? NPC_STATES.THROWING : NPC_STATES.CLINCHING,
          anim: choice,
          move: choice,
          facing,
          ai: memory,
        };
      }
    }

    // Feint baiting.
    if (
      memory.feintCooldown <= 0 &&
      shouldFeint(archetype, player, dist) &&
      Math.random() < difficulty.feintChance + 0.1
    ) {
      memory.feintCooldown = config.feintCooldown;
      memory.cooldown = config.baseDecisionCooldown * 0.6;
      return {
        state: NPC_STATES.FEINTING,
        anim: 'idle',
        move: null,
        facing,
        velocity: [Math.sign(dx || 1) * 0.4, 0, 0],
        ai: memory,
      };
    }

    // Accept pending Gemma counter move if it's legal and not too stale.
    let chosen = null;
    if (
      pendingGemmaMove &&
      isGemmaMove(pendingGemmaMove) &&
      canUseMove(pendingGemmaMove, npc.stamina)
    ) {
      const stale = getStalePenalty(memory.history, pendingGemmaMove);
      if (stale < 0.55 && Math.random() < difficulty.counterChance) {
        chosen = pendingGemmaMove;
      }
    }

    // Range-based fallback.
    if (!chosen) {
      chosen = chooseAttack(dist, npc.stamina, difficulty, archetype, memory.history, config);
    }

    if (chosen) {
      memory.cooldown = config.baseDecisionCooldown;
      memory.lastChosen = chosen;
      recordMove(memory.history, chosen);

      // Plan a combo so the NPC chains follow-ups on subsequent decisions.
      if (Math.random() < difficulty.comboChance) {
        memory.comboPlan = planCombo(chosen, archetype, npc.stamina, {
          aggression: difficulty.aggression,
        });
      }

      const isGrapple = chosen === 'clinch' || chosen === 'throw';
      if (isGrapple) memory.grappleCooldown = config.grappleCooldownAfterUse;

      let state = NPC_STATES.ATTACKING;
      if (chosen === 'clinch') state = NPC_STATES.CLINCHING;
      else if (chosen === 'throw') state = NPC_STATES.THROWING;

      return {
        state,
        anim: chosen,
        move: chosen,
        facing,
        ai: memory,
      };
    }
  }

  // ---- Movement / spacing fallback. ----
  const range = getRangeState(dist, archetype);
  const nearLeft = (npc.position[0] || 0) <= -config.arenaHalfWidth + config.cornerThreshold;
  const nearRight = (npc.position[0] || 0) >= config.arenaHalfWidth - config.cornerThreshold;
  const cornered = nearLeft || nearRight;

  const intent = getMovementIntent(archetype, range, cornered, playerAttackingNow);
  const patch = buildMovementPatch(intent, dx, dz, dist, archetype, npc, config);

  return {
    state: patch.state,
    anim: patch.anim,
    move: null,
    facing,
    velocity: patch.velocity,
    ai: memory,
  };
}

/**
 * Clamp an NPC position inside the arena.
 *
 * @param {number[]} pos
 * @param {object} [cfg]
 * @returns {number[]}
 */
export function clampNPCPosition(pos, cfg = DEFAULT_AI_CONFIG) {
  const halfW = cfg.arenaHalfWidth ?? DEFAULT_AI_CONFIG.arenaHalfWidth;
  const halfD = cfg.arenaHalfDepth ?? DEFAULT_AI_CONFIG.arenaHalfDepth;
  return [
    Math.max(-halfW, Math.min(halfW, pos[0] || 0)),
    pos[1] || 0,
    Math.max(-halfD, Math.min(halfD, pos[2] || 0)),
  ];
}

/**
 * Reset the AI memory for a new round / new fight.
 */
export function resetAI() {
  return {
    history: [],
    cooldown: 0,
    reactionTimer: 0,
    parryCooldown: 0,
    grappleCooldown: 0,
    feintCooldown: 0,
    consecutiveBlocks: 0,
    prevPlayerAttacking: false,
    comboPlan: [],
    lastChosen: null,
  };
}

/**
 * Re-export the archetype-aware difficulty helper so callers that only depend
 * on npcAI keep working.
 */
export { getDifficultyProfile };

/**
 * Convenience re-exports for callers that want to look up archetypes via
 * npcAI without importing the archetype module directly.
 */
export { getArchetypeForCharacter, generateMockCounter };

/**
 * Helpers retained for backwards compatibility / tests.
 */
export function recordMoveHistory(history, move, windowSize) {
  return recordMove(history, move, windowSize);
}

export function getMoveStalePenalty(history, move) {
  return getStalePenalty(history, move);
}

/**
 * Helper preserved from the legacy implementation: returns true if the player
 * is currently in attack startup/early active and is therefore interruptible.
 */
export function canInterrupt(player, playerMove) {
  if (!player || !player.isAttacking) return false;
  const data = MOVE_DATA[playerMove];
  if (!data) return false;
  const total = getMoveDuration(playerMove);
  if (total <= 0) return false;
  return (player.animProgress || 0) < (data.startup + data.active * 0.5) / total;
}
