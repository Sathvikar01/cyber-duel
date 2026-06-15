import {
  MOVE_DATA,
  GRAPPLE_MOVES,
  DEFENSIVE_MOVES,
  isHeavyMove,
} from './moveData.js';
import { getStaminaCost } from './stamina.js';

export const COMBAT_CONFIG = Object.freeze({
  /** Maximum number of hits in a combo before scaling bottoms out. */
  maxComboScaleHits: 6,
  /** Minimum multiplier applied by combo scaling. */
  minComboScale: 0.35,
  /** Counter-hit damage multiplier. */
  counterHitMultiplier: 1.35,
  /** Chip damage taken on a blocked attack as a fraction of raw damage. */
  blockChipFraction: 0.08,
  /** Block stamina cost as a fraction of the attack's stamina cost. */
  blockStaminaFraction: 0.35,
  /** Stamina damage inflicted on block as a fraction of raw damage. */
  blockStaminaDamageFraction: 0.25,
  /** Successful parry rewards stamina to the defender. */
  parryStaminaReward: 12,
  /** Damage multiplier for attacks that land during a grapple. */
  grappledDamageMultiplier: 1.15,
});

/**
 * Possible reaction ids returned by pickReaction.
 */
export const REACTIONS = Object.freeze({
  NONE: 'none',
  FLINCH: 'flinch',
  STUMBLE: 'stumble',
  KNOCKDOWN: 'knockdown',
  FALL: 'fall',
  CLINCHED: 'clinched',
});

/**
 * Clamp a numeric value.
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Compute combo scaling for repeated hits.
 *
 * @param {number} hitCount number of hits already in the combo (0 = first hit)
 * @returns {number} multiplier in [minComboScale, 1.0]
 */
export function getComboScale(hitCount) {
  const n = Math.max(0, hitCount);
  if (n === 0) return 1.0;
  const decay = 1 - n / COMBAT_CONFIG.maxComboScaleHits;
  return clamp(decay, COMBAT_CONFIG.minComboScale, 1.0);
}

/**
 * Determine whether a defender is currently in startup/recovery and therefore
 * vulnerable to a counter-hit.
 *
 * @param {object} defender
 * @param {string} defenderMove
 * @returns {boolean}
 */
export function isCounterHitVulnerable(defender, defenderMove) {
  if (!defender || !defender.isAttacking) return false;
  const data = MOVE_DATA[defenderMove];
  if (!data) return false;
  const progress = defender.animProgress || 0;
  const total = data.startup + data.active + data.recovery;
  if (total <= 0) return false;
  const t = progress * total;
  // Vulnerable during startup and late recovery.
  return t < data.startup || t > data.startup + data.active + data.recovery * 0.4;
}

/**
 * Pick a reaction id for a hit based on move, raw damage, and remaining HP.
 *
 * @param {string} move
 * @param {number} damage raw (unscaled) damage
 * @param {number} hpLeft defender HP after damage would be applied
 * @returns {string} reaction id
 */
export function pickReaction(move, damage, hpLeft) {
  const data = MOVE_DATA[move];
  if (!data) return REACTIONS.FLINCH;

  if (data.hitReaction) {
    if (data.hitReaction === REACTIONS.CLINCHED) return REACTIONS.CLINCHED;
    if (data.hitReaction === REACTIONS.NONE) return REACTIONS.NONE;
  }

  // Heavy hits or killing blows cause bigger reactions.
  if (hpLeft <= 0) return REACTIONS.FALL;
  if (isHeavyMove(move) && damage >= 12) return REACTIONS.KNOCKDOWN;
  if (damage >= 10) return REACTIONS.STUMBLE;
  return REACTIONS.FLINCH;
}

/**
 * Core attack resolution.
 *
 * Returns a result object describing what happened. Does NOT mutate inputs.
 *
 * @param {object} attack  { move, position, isAttacking, animProgress }
 * @param {object} defender { position, isBlocking, isAttacking, anim, animProgress, hp, stamina }
 * @param {number} distance current distance between fighters
 * @param {number} dt       timestep in seconds
 * @param {object} [ctx]    optional context { comboCount, defenderIsGrappled }
 * @returns {object} resolution result
 */
export function resolveAttack(attack, defender, distance, dt, ctx = {}) {
  const data = MOVE_DATA[attack.move];
  if (!data) {
    return { hit: false, reason: 'unknown_move' };
  }

  // ---- Range check (edge-to-edge) ------------------------------------
  // The hit only lands when the attacker is at the move's intended combat
  // distance. Too close (point-blank -- the weapon hasn't reached the
  // target yet) and too far (out of reach) both miss. Each move declares
  // its own [minRange, maxRange] band; "optimalRange" is the sweet spot
  // that lands at full damage.
  const minRange = data.minRange != null ? data.minRange : data.range * 0.3;
  const maxRange = data.maxRange != null ? data.maxRange : data.range;
  if (distance < minRange || distance > maxRange) {
    return { hit: false, reason: 'out_of_range' };
  }

  // ---- Facing check --------------------------------------------------
  // The attacker must be oriented toward the defender. Without this the
  // defender can be hit from behind (e.g. a knockback-flip mid-punch),
  // which looks and feels wrong. We compare the sign of the attacker's
  // facing to the sign of (defender - attacker) on the X axis. If they
  // disagree the hit cleanly misses.
  if (attack.position && defender.position && attack.facing != null) {
    const dx = defender.position[0] - attack.position[0];
    if (dx !== 0) {
      const correctSide = Math.sign(dx) === Math.sign(attack.facing);
      if (!correctSide) {
        return { hit: false, reason: 'wrong_facing' };
      }
    }
  }

  // ---- Damage falloff at the edges of the range band -----------------
  // Optimal hits deal 100%. Hits outside optimalRange +/- 0.4 deal 80%.
  // Pure reach (distance >= optimal + 0.4) also takes 80% so the move
  // remains useful at the edge of its band.
  let rangeScale = 1.0;
  if (data.optimalRange != null) {
    const off = Math.abs(distance - data.optimalRange);
    if (off > 0.4) {
      rangeScale = 0.8;
    }
  }

  // Strict active frame check. The hit only lands during the exact
  // active window of the move. No tolerance, no fudging.
  const total = data.startup + data.active + data.recovery;
  const localTime = (attack.animProgress || 0) * total;
  const inActiveFrames =
    localTime >= data.startup && localTime <= data.startup + data.active;
  if (!inActiveFrames) {
    return { hit: false, reason: 'not_active' };
  }

  // Defensive overrides.
  if (defender.isBlocking) {
    return resolveBlock(attack, defender);
  }

  if (defender.anim === 'parry') {
    return resolveParry(attack, defender);
  }

  if (defender.anim === 'backstep') {
    return { hit: false, reason: 'evaded' };
  }

  // Compute damage.
  let damage = data.damage * rangeScale;

  // Counter-hit bonus.
  const counterHit = isCounterHitVulnerable(defender, defender.anim);
  if (counterHit) damage *= COMBAT_CONFIG.counterHitMultiplier;

  // Combo scaling.
  const comboCount = ctx.comboCount || 0;
  damage *= getComboScale(comboCount);

  // Grappled state vulnerability.
  if (ctx.defenderIsGrappled) damage *= COMBAT_CONFIG.grappledDamageMultiplier;

  damage = Math.round(damage);

  const hpLeft = Math.max(0, (defender.hp || 0) - damage);
  const reaction = pickReaction(attack.move, damage, hpLeft);

  return {
    hit: true,
    damage,
    hpLeft,
    reaction,
    knockback: data.knockback,
    counterHit,
    rangeScale,
    reason: 'hit',
  };
}

/**
 * Resolve an attack against a blocking defender.
 *
 * @param {object} attack
 * @param {object} defender
 * @returns {object}
 */
export function resolveBlock(attack, defender) {
  const data = MOVE_DATA[attack.move];
  if (!data) return { hit: false, reason: 'unknown_move' };

  const rawDamage = data.damage;
  const chip = Math.max(1, Math.floor(rawDamage * COMBAT_CONFIG.blockChipFraction));
  const staminaCost = Math.floor(getStaminaCost(attack.move) * COMBAT_CONFIG.blockStaminaFraction);
  const staminaDamage = Math.floor(rawDamage * COMBAT_CONFIG.blockStaminaDamageFraction);

  const hpLeft = Math.max(0, (defender.hp || 0) - chip);
  const staminaLeft = Math.max(0, (defender.stamina || 0) - staminaCost - staminaDamage);

  return {
    hit: false,
    blocked: true,
    chip,
    staminaCost,
    staminaDamage,
    hpLeft,
    staminaLeft,
    reaction: REACTIONS.NONE,
    knockback: data.knockback * 0.25,
    reason: 'blocked',
  };
}

/**
 * Resolve an attack against a defender in parry state.
 *
 * A parry must be within active frames to succeed and grants a stamina reward
 * plus a brief counter-hit opportunity.
 *
 * @param {object} attack
 * @param {object} defender
 * @returns {object}
 */
export function resolveParry(attack, defender) {
  const pData = MOVE_DATA.parry;
  const total = pData.startup + pData.active + pData.recovery;
  const localTime = (defender.animProgress || 0) * total;
  const inParryWindow = localTime >= pData.startup && localTime <= pData.startup + pData.active;

  if (!inParryWindow) {
    // Late/early parry becomes a normal hit. Pass a distance that is
    // inside the move's range band so the new edge-to-edge range
    // check doesn't false-reject the fallthrough hit.
    const fallthroughDistance = data && data.optimalRange ? data.optimalRange : 2.0;
    return resolveAttack(attack, { ...defender, anim: 'idle', isBlocking: false }, fallthroughDistance, 0);
  }

  return {
    hit: false,
    parried: true,
    staminaReward: COMBAT_CONFIG.parryStaminaReward,
    reaction: REACTIONS.NONE,
    counterWindow: pData.active * 0.8,
    reason: 'parried',
  };
}

/**
 * Resolve a clinch attempt.
 *
 * @param {object} attacker
 * @param {object} defender
 * @param {number} [distance]
 * @returns {object}
 */
export function resolveClinch(attacker, defender, distance) {
  const data = MOVE_DATA.clinch;
  const dist = distance != null ? distance : 0;

  // Edge-to-edge range band (uses new minRange/maxRange if defined,
  // falls back to legacy single range field).
  const minRange = data.minRange != null ? data.minRange : 0;
  const maxRange = data.maxRange != null ? data.maxRange : data.range;
  if (dist < minRange || dist > maxRange) {
    return { success: false, reason: 'out_of_range' };
  }

  // Facing check: must reach forward to clinch.
  if (attacker && defender && attacker.position && defender.position && attacker.facing != null) {
    const dx = defender.position[0] - attacker.position[0];
    if (dx !== 0) {
      const correctSide = Math.sign(dx) === Math.sign(attacker.facing);
      if (!correctSide) {
        return { success: false, reason: 'wrong_facing' };
      }
    }
  }

  // Cannot clinch a defender who is already clinched or throwing.
  if (GRAPPLE_MOVES.has(defender.anim)) {
    return { success: false, reason: 'defender_occupied' };
  }

  // Backstep / parry can deny a clinch.
  if (DEFENSIVE_MOVES.has(defender.anim)) {
    return { success: false, reason: 'defended' };
  }

  const damage = data.damage;
  const hpLeft = Math.max(0, (defender.hp || 0) - damage);

  return {
    success: true,
    damage,
    hpLeft,
    reaction: REACTIONS.CLINCHED,
    grappled: true,
    duration: 1.2,
    reason: 'clinched',
  };
}

/**
 * Resolve a throw attempt.
 *
 * @param {object} attacker
 * @param {object} defender
 * @param {number} [distance]
 * @returns {object}
 */
export function resolveThrow(attacker, defender, distance) {
  const data = MOVE_DATA.throw;
  const dist = distance != null ? distance : 0;

  const minRange = data.minRange != null ? data.minRange : 0;
  const maxRange = data.maxRange != null ? data.maxRange : data.range;
  if (dist < minRange || dist > maxRange) {
    return { success: false, reason: 'out_of_range' };
  }

  // Facing check: must reach forward to throw.
  if (attacker && defender && attacker.position && defender.position && attacker.facing != null) {
    const dx = defender.position[0] - attacker.position[0];
    if (dx !== 0) {
      const correctSide = Math.sign(dx) === Math.sign(attacker.facing);
      if (!correctSide) {
        return { success: false, reason: 'wrong_facing' };
      }
    }
  }

  if (defender.anim === 'backstep') {
    return { success: false, reason: 'evaded' };
  }

  let damage = data.damage;
  // Throw does extra damage if the defender is already clinched.
  if (defender.anim === 'clinch') damage *= COMBAT_CONFIG.grappledDamageMultiplier;
  damage = Math.round(damage);

  const hpLeft = Math.max(0, (defender.hp || 0) - damage);

  return {
    success: true,
    damage,
    hpLeft,
    reaction: REACTIONS.FALL,
    knockback: data.knockback,
    grappled: false, // throw ends the grapple
    duration: 1.4,
    reason: 'thrown',
  };
}

/**
 * Convenience: resolve any Gemma move against the player.
 *
 * @param {string} move
 * @param {object} attacker Gemma state
 * @param {object} defender player state
 * @param {number} distance
 * @param {number} dt
 * @returns {object}
 */
export function resolveGemmaMove(move, attacker, defender, distance, dt) {
  if (move === 'parry') {
    return { hit: false, reason: 'parry_stance' };
  }
  if (move === 'backstep') {
    return { hit: false, reason: 'evasive_stance' };
  }
  if (move === 'clinch') {
    return resolveClinch(attacker, defender, distance);
  }
  if (move === 'throw') {
    return resolveThrow(attacker, defender, distance);
  }
  return resolveAttack(attacker, defender, distance, dt);
}

/**
 * Compute the total duration of a hitstun/reaction in seconds.
 *
 * @param {string} reaction
 * @param {boolean} heavy
 * @returns {number}
 */
export function getReactionDuration(reaction, heavy = false) {
  switch (reaction) {
    case REACTIONS.FLINCH:
      return 0.30;
    case REACTIONS.STUMBLE:
      return 0.55;
    case REACTIONS.KNOCKDOWN:
      return heavy ? 1.20 : 0.80;
    case REACTIONS.FALL:
      return 1.60;
    case REACTIONS.CLINCHED:
      return 1.40;
    default:
      return 0;
  }
}
