/**
 * Move data for the 2.5D fighter.
 *
 * Player moves are fixed: jab, cross, low_kick, roundhouse, uppercut.
 * Gemma (NPC) counter moves extend those with parry, backstep, clinch, throw.
 *
 * Timing is expressed in seconds.
 *   - startup:  vulnerable wind-up before the hit can connect
 *   - active:    window during which the attack can hit
 *   - recovery:  vulnerable follow-through after active frames end
 *   - cancelWindow: latest point in the move (0..1) where it may be cancelled
 *                   into another action for combos
 *   - hitReaction: preferred reaction id on the defender when this move connects
 *   - knockback: horizontal displacement applied to a defender on hit
 *   - attackerPushback: small displacement applied to the attacker on hit
 *   - hitstop: freeze-frame duration when the move lands
 *   - blockedHitstop: freeze-frame duration when the move is blocked
 *   - shake: screen shake intensity on hit
 *   - blockedShake: screen shake on block
 *   - anticipationWeight: how strong the wind-up is (0..1)
 *   - tags: optional metadata flags (heavy, low, grapple, evasive, etc.)
 */

export const PLAYER_MOVES = Object.freeze([
  'jab',
  'cross',
  'low_kick',
  'roundhouse',
  'uppercut',
]);

export const GEMMA_MOVES = Object.freeze([
  'jab',
  'cross',
  'low_kick',
  'roundhouse',
  'uppercut',
  'parry',
  'backstep',
  'clinch',
  'throw',
]);

export const HEAVY_MOVES = Object.freeze(new Set(['roundhouse', 'uppercut']));
export const LIGHT_MOVES = Object.freeze(new Set(['jab', 'cross', 'low_kick']));
export const GRAPPLE_MOVES = Object.freeze(new Set(['clinch', 'throw']));
export const DEFENSIVE_MOVES = Object.freeze(new Set(['parry', 'backstep']));

export const MOVE_DATA = Object.freeze({
  // ----- Player / shared attacks -----
  jab: {
    damage: 6,
    staminaCost: 8,
    range: 3.4,
    startup: 0.09,
    active: 0.06,
    recovery: 0.25,
    cancelWindow: 0.35,
    hitReaction: 'flinch',
    knockback: 0.20,
    attackerPushback: 0.02,
    hitstop: 0.03,
    blockedHitstop: 0.025,
    shake: 0.18,
    blockedShake: 0.06,
    anticipationWeight: 0.15,
    tags: ['punch', 'fast'],
  },

  cross: {
    damage: 10,
    staminaCost: 12,
    range: 4.0,
    startup: 0.12,
    active: 0.08,
    recovery: 0.30,
    cancelWindow: 0.32,
    hitReaction: 'stumble',
    knockback: 0.45,
    attackerPushback: 0.05,
    hitstop: 0.045,
    blockedHitstop: 0.03,
    shake: 0.26,
    blockedShake: 0.10,
    anticipationWeight: 0.30,
    tags: ['punch'],
  },

  low_kick: {
    damage: 8,
    staminaCost: 10,
    range: 3.7,
    startup: 0.14,
    active: 0.10,
    recovery: 0.28,
    cancelWindow: 0.30,
    hitReaction: 'flinch',
    knockback: 0.30,
    attackerPushback: 0.04,
    hitstop: 0.04,
    blockedHitstop: 0.028,
    shake: 0.22,
    blockedShake: 0.08,
    anticipationWeight: 0.30,
    tags: ['kick', 'low'],
  },

  roundhouse: {
    damage: 14,
    staminaCost: 22,
    range: 4.4,
    startup: 0.24,
    active: 0.12,
    recovery: 0.44,
    cancelWindow: 0.22,
    hitReaction: 'knockdown',
    knockback: 1.10,
    attackerPushback: 0.12,
    hitstop: 0.09,
    blockedHitstop: 0.05,
    shake: 0.42,
    blockedShake: 0.18,
    anticipationWeight: 0.55,
    tags: ['kick', 'heavy'],
  },

  uppercut: {
    damage: 16,
    staminaCost: 24,
    range: 3.5,
    startup: 0.20,
    active: 0.10,
    recovery: 0.50,
    cancelWindow: 0.18,
    hitReaction: 'knockdown',
    knockback: 0.85,
    attackerPushback: 0.10,
    hitstop: 0.08,
    blockedHitstop: 0.045,
    shake: 0.40,
    blockedShake: 0.16,
    anticipationWeight: 0.45,
    tags: ['punch', 'heavy'],
  },

  // ----- Gemma-only counters / tools -----
  parry: {
    damage: 0,
    staminaCost: 10,
    range: 0,
    startup: 0.05,
    active: 0.30,
    recovery: 0.25,
    cancelWindow: 0.0,
    hitReaction: 'none',
    knockback: 0,
    attackerPushback: 0,
    hitstop: 0,
    blockedHitstop: 0.06,
    shake: 0,
    blockedShake: 0.14,
    anticipationWeight: 0.10,
    tags: ['defensive', 'counter'],
  },

  backstep: {
    damage: 0,
    staminaCost: 16,
    range: 0,
    startup: 0.0,
    active: 0.28,
    recovery: 0.20,
    cancelWindow: 0.0,
    hitReaction: 'none',
    knockback: 0,
    attackerPushback: 0,
    hitstop: 0,
    blockedHitstop: 0,
    shake: 0,
    blockedShake: 0,
    anticipationWeight: 0.0,
    tags: ['defensive', 'evasive', 'iFrames'],
  },

  clinch: {
    damage: 5,
    staminaCost: 18,
    range: 2.0,
    startup: 0.10,
    active: 0.16,
    recovery: 0.24,
    cancelWindow: 0.0,
    hitReaction: 'clinched',
    knockback: 0,
    attackerPushback: 0,
    hitstop: 0.05,
    blockedHitstop: 0.03,
    shake: 0.18,
    blockedShake: 0.10,
    anticipationWeight: 0.20,
    tags: ['grapple', 'clinch'],
  },

  throw: {
    damage: 18,
    staminaCost: 26,
    range: 2.2,
    startup: 0.12,
    active: 0.16,
    recovery: 0.22,
    cancelWindow: 0.0,
    hitReaction: 'fall',
    knockback: 1.40,
    attackerPushback: 0.05,
    hitstop: 0.12,
    blockedHitstop: 0.04,
    shake: 0.55,
    blockedShake: 0.12,
    anticipationWeight: 0.30,
    tags: ['grapple', 'heavy'],
  },
});

export function getMoveDuration(move) {
  const m = MOVE_DATA[move];
  if (!m) return 0.5;
  return m.startup + m.active + m.recovery;
}

export function isPlayerMove(move) {
  return PLAYER_MOVES.includes(move);
}

export function isGemmaMove(move) {
  return GEMMA_MOVES.includes(move);
}

export function isHeavyMove(move) {
  return HEAVY_MOVES.has(move);
}

export function describeMove(move) {
  const m = MOVE_DATA[move];
  if (!m) return 'unknown';
  if (m.tags.includes('defensive')) return m.tags.includes('evasive') ? 'evade' : 'counter';
  if (m.tags.includes('grapple')) return 'grapple';
  if (m.tags.includes('heavy')) return 'heavy';
  return 'light';
}
