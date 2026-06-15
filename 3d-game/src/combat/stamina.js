import { MOVE_DATA } from './moveData.js';

export const STAMINA_CONFIG = Object.freeze({
  maxStamina: 100,
  /** Stamina regenerated per second while idle/walking. */
  baseRegenRate: 18,
  /** Regen multiplier while blocking (still regen, but slower). */
  blockRegenMultiplier: 0.35,
  /** Regen multiplier while attacking or in hitstun. */
  actionRegenMultiplier: 0.0,
  /** Small extra cost paid when starting a move while already low on stamina. */
  fatigueThreshold: 20,
  fatigueExtraCost: 3,
  /** Moves cost this much more when the fighter is in a clinched/grappled state. */
  grappledCostPenalty: 5,
});

/**
 * Get the stamina cost for a move, optionally accounting for stateful penalties.
 *
 * @param {string} move
 * @param {object} [ctx] optional context { isGrappled, isFatigued }
 * @returns {number}
 */
export function getStaminaCost(move, ctx = {}) {
  const data = MOVE_DATA[move];
  if (!data) return 0;

  let cost = data.staminaCost;

  if (ctx.isFatigued && cost > 0) {
    cost += STAMINA_CONFIG.fatigueExtraCost;
  }
  if (ctx.isGrappled && cost > 0) {
    cost += STAMINA_CONFIG.grappledCostPenalty;
  }

  return Math.max(0, cost);
}

/**
 * Regenerate stamina over a timestep.
 *
 * @param {number} current current stamina (0..100)
 * @param {number} dt seconds elapsed
 * @param {object} state contextual state { isBlocking, isAttacking, isHit, isGrappled }
 * @returns {number} new stamina value clamped to [0, maxStamina]
 */
export function regenStamina(current, dt, state = {}) {
  const { isBlocking, isAttacking, isHit, isGrappled } = state;

  let rate = STAMINA_CONFIG.baseRegenRate;

  if (isAttacking || isHit || isGrappled) {
    rate *= STAMINA_CONFIG.actionRegenMultiplier;
  } else if (isBlocking) {
    rate *= STAMINA_CONFIG.blockRegenMultiplier;
  }

  const next = current + rate * dt;
  return clampStamina(next);
}

/**
 * Check whether a fighter can afford a move.
 *
 * @param {string} move
 * @param {number} stamina current stamina
 * @param {object} [ctx]
 * @returns {boolean}
 */
export function canUseMove(move, stamina, ctx = {}) {
  return stamina >= getStaminaCost(move, ctx);
}

/**
 * Clamp a stamina value into the valid range.
 */
export function clampStamina(value) {
  return Math.max(0, Math.min(STAMINA_CONFIG.maxStamina, value));
}

/**
 * Deduct stamina for a move, returning the clamped remainder.
 */
export function spendStamina(current, move, ctx = {}) {
  const cost = getStaminaCost(move, ctx);
  return clampStamina(current - cost);
}

/**
 * True when stamina is below the fatigue threshold.
 */
export function isFatigued(stamina) {
  return stamina < STAMINA_CONFIG.fatigueThreshold;
}
