import { MOVE_DATA, isHeavyMove, getMoveDuration } from './moveData.js';
import { canUseMove } from './stamina.js';

/**
 * Situation-aware defensive evaluator for the NPC.
 *
 * Given a snapshot of the player's incoming attack, returns either a chosen
 * defensive move (`parry`, `backstep`, `block`, optional `throw` interrupt)
 * or `null` if the player isn't actually threatening. When no option scores
 * above the difficulty-aware threshold the function returns `{ move: 'none' }`,
 * letting the orchestrator know the NPC is going to eat the hit and instead
 * focus on movement or counter-offense.
 *
 * The function is pure: it does not touch state. The orchestrator owns the
 * cooldowns and reaction timers.
 */

function getAttackProgress(player, playerMove) {
  const data = MOVE_DATA[playerMove];
  if (!data) return null;
  const total = getMoveDuration(playerMove);
  const localTime = (player.animProgress || 0) * total;
  return {
    data,
    total,
    localTime,
    inStartup: localTime < data.startup,
    inEarlyActive:
      localTime >= data.startup && localTime < data.startup + data.active * 0.5,
    inActive:
      localTime >= data.startup && localTime <= data.startup + data.active,
    inLateActive:
      localTime >= data.startup + data.active * 0.5 &&
      localTime <= data.startup + data.active,
  };
}

function scoreParry(progress, dist, archetype, difficulty, npcStamina) {
  if (!canUseMove('parry', npcStamina)) return 0;
  const { data, inStartup, inEarlyActive } = progress;
  if (!inStartup && !inEarlyActive) return 0;
  const tags = data.tags || [];
  // Parries don't catch lows or grapples cleanly.
  if (tags.includes('low') || tags.includes('grapple')) return 0;
  if (dist > data.range * 1.3 + 0.4) return 0;

  const telegraph = data.anticipationWeight || 0;
  let score = 0.25 + telegraph * 1.4;
  score *= 0.4 + archetype.parryAffinity * 1.1;
  score *= 0.5 + difficulty.parryChance * 1.6;
  if (isHeavyMove(progress.move)) score += 0.15;
  return Math.max(0, score);
}

function scoreBackstep(progress, dist, archetype, difficulty, npcStamina, underPressure) {
  if (!canUseMove('backstep', npcStamina)) return 0;
  const { data, inStartup, inEarlyActive, inLateActive } = progress;
  if (!inStartup && !inEarlyActive && !inLateActive) return 0;
  if (dist > data.range * 1.2) return 0;

  const heavy = isHeavyMove(progress.move);
  const telegraph = data.anticipationWeight || 0;
  let score = 0.30 + telegraph * 0.6;
  score *= 0.4 + archetype.evadeAffinity * 1.2;
  score *= 0.5 + difficulty.evadeChance * 1.5;
  if (heavy) score += 0.20;
  if (underPressure) score += 0.10;
  // Cornered NPC can't backstep effectively; the orchestrator dampens this
  // further by deciding when to even ask.
  return Math.max(0, score);
}

function scoreBlock(progress, archetype, difficulty, consecutiveBlocks) {
  const { data } = progress;
  const tags = data.tags || [];
  let score = 0.35 + 0.10;
  score *= 0.5 + archetype.blockAffinity * 1.1;
  score *= 0.4 + difficulty.blockChance * 1.4;
  if (tags.includes('low')) score *= 1.15;
  if (isHeavyMove(progress.move) && (data.anticipationWeight || 0) > 0.40) {
    // Heavy, telegraphed attacks should be parried or sidestepped instead.
    score *= 0.55;
  }
  // Block staleness: punish repeat blocking so the AI can't turtle forever.
  if (consecutiveBlocks > 0) score *= Math.max(0.25, 1 - consecutiveBlocks * 0.30);
  return Math.max(0, score);
}

function scoreThrowInterrupt(progress, dist, archetype, difficulty, npcStamina, grappleCooldown) {
  if (grappleCooldown > 0) return 0;
  if (!canUseMove('throw', npcStamina)) return 0;
  if (dist > 2.3) return 0;
  const { inStartup, inEarlyActive } = progress;
  if (!inStartup && !inEarlyActive) return 0;
  if (!isHeavyMove(progress.move)) return 0;

  let score = 0.40;
  score *= 0.3 + archetype.grappleAffinity * 1.5;
  score *= 0.5 + difficulty.grappleChance * 1.2;
  score *= 0.7 + archetype.riskTolerance * 0.6;
  return Math.max(0, score);
}

/**
 * Evaluate the best defensive response to an incoming player attack.
 *
 * @param {object} player snapshot { anim, animProgress, isAttacking, ... }
 * @param {string} playerMove the attack id (jab, cross, low_kick, ...)
 * @param {number} dist current distance between fighters
 * @param {number} npcStamina
 * @param {object} archetype resolved archetype object
 * @param {object} difficulty difficulty profile
 * @param {object} [memory] AI memory snapshot { consecutiveBlocks, parryCooldown, grappleCooldown }
 * @returns {{ move: 'parry'|'backstep'|'block'|'throw'|'none', delay: number, score?: number } | null}
 */
export function evaluateDefense(
  player,
  playerMove,
  dist,
  npcStamina,
  archetype,
  difficulty,
  memory = {}
) {
  if (!player || !player.isAttacking) return null;
  const progress = getAttackProgress(player, playerMove);
  if (!progress) return null;
  progress.move = playerMove;

  const consecutiveBlocks = memory.consecutiveBlocks || 0;
  const parryCooldown = memory.parryCooldown || 0;
  const grappleCooldown = memory.grappleCooldown || 0;
  const underPressure = consecutiveBlocks >= 1;

  let parryS = scoreParry(progress, dist, archetype, difficulty, npcStamina);
  if (parryCooldown > 0) parryS *= 0.2;

  const backstepS = scoreBackstep(progress, dist, archetype, difficulty, npcStamina, underPressure);
  const blockS = scoreBlock(progress, archetype, difficulty, consecutiveBlocks);
  const throwS = scoreThrowInterrupt(progress, dist, archetype, difficulty, npcStamina, grappleCooldown);

  const options = [
    { move: 'parry', score: parryS, delay: difficulty.reactionTime * 0.6 },
    { move: 'backstep', score: backstepS, delay: difficulty.reactionTime * 0.55 },
    { move: 'block', score: blockS, delay: difficulty.reactionTime * 0.80 },
    { move: 'throw', score: throwS, delay: difficulty.reactionTime * 0.45 },
  ];
  options.sort((a, b) => b.score - a.score);

  const top = options[0];
  const threshold = 0.35 + (1 - (difficulty.accuracy || 0.65)) * 0.30;
  if (!top || top.score < threshold) {
    return { move: 'none', delay: difficulty.reactionTime, score: top ? top.score : 0 };
  }

  return { move: top.move, delay: top.delay, score: top.score };
}
