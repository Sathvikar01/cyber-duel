/**
 * NPC archetype definitions and difficulty curves.
 *
 * Archetypes shape how the orchestrator (npcAI.js) weighs defense, offense
 * and movement. They're intentionally light-weight: a bag of 0..1 affinities
 * that downstream modules multiply into their scoring.
 *
 * `getDifficultyProfile(archetype, round)` produces the per-round coefficients
 * the orchestrator actually consumes. Round 1 is intentionally readable: the
 * NPC reacts in ~0.20s with modest parry and a decent block. Round 5 is a
 * sharper read of the player with much faster reactions and rare blocking.
 */

/**
 * Archetype keys.
 *
 * - balanced : The Ronin. Sensible defaults across the board.
 * - heavy    : The Pit Champion. Slow but devastating; loves big hits.
 * - fast     : Pure rushdown striker.
 * - agile    : The Velvet Assassin. Evade-and-counter specialist.
 * - grappler : The Iron Monk. Closes distance for clinches and throws.
 */
export const AI_ARCHETYPES = Object.freeze({
  balanced: Object.freeze({
    id: 'balanced',
    rangePreference: 'mid',
    aggression: 0.60,
    patience: 0.55,
    parryAffinity: 0.55,
    evadeAffinity: 0.45,
    blockAffinity: 0.55,
    grappleAffinity: 0.30,
    feintAffinity: 0.30,
    comboAffinity: 0.50,
    reactionDelayBase: 0.18,
    riskTolerance: 0.50,
    movementStyle: 'circling',
    signatureMoves: ['cross', 'low_kick', 'roundhouse'],
  }),

  heavy: Object.freeze({
    id: 'heavy',
    rangePreference: 'mid',
    aggression: 0.80,
    patience: 0.35,
    parryAffinity: 0.30,
    evadeAffinity: 0.20,
    blockAffinity: 0.75,
    grappleAffinity: 0.45,
    feintAffinity: 0.20,
    comboAffinity: 0.35,
    reactionDelayBase: 0.24,
    riskTolerance: 0.70,
    movementStyle: 'direct',
    signatureMoves: ['uppercut', 'roundhouse', 'cross'],
  }),

  fast: Object.freeze({
    id: 'fast',
    rangePreference: 'close',
    aggression: 0.85,
    patience: 0.30,
    parryAffinity: 0.45,
    evadeAffinity: 0.55,
    blockAffinity: 0.30,
    grappleAffinity: 0.20,
    feintAffinity: 0.50,
    comboAffinity: 0.70,
    reactionDelayBase: 0.14,
    riskTolerance: 0.60,
    movementStyle: 'jittery',
    signatureMoves: ['jab', 'cross', 'low_kick'],
  }),

  agile: Object.freeze({
    id: 'agile',
    rangePreference: 'mid',
    aggression: 0.65,
    patience: 0.60,
    parryAffinity: 0.50,
    evadeAffinity: 0.85,
    blockAffinity: 0.25,
    grappleAffinity: 0.15,
    feintAffinity: 0.55,
    comboAffinity: 0.65,
    reactionDelayBase: 0.12,
    riskTolerance: 0.55,
    movementStyle: 'circling',
    signatureMoves: ['jab', 'low_kick', 'cross'],
  }),

  grappler: Object.freeze({
    id: 'grappler',
    rangePreference: 'close',
    aggression: 0.70,
    patience: 0.50,
    parryAffinity: 0.40,
    evadeAffinity: 0.30,
    blockAffinity: 0.70,
    grappleAffinity: 0.90,
    feintAffinity: 0.25,
    comboAffinity: 0.55,
    reactionDelayBase: 0.20,
    riskTolerance: 0.65,
    movementStyle: 'direct',
    signatureMoves: ['clinch', 'throw', 'uppercut'],
  }),
});

const CHARACTER_TO_ARCHETYPE = Object.freeze({
  ronin: 'balanced',
  monk: 'grappler',
  assassin: 'agile',
  champion: 'heavy',
});

/**
 * Resolve a character id to its archetype object.
 *
 * Unknown ids fall back to the balanced archetype so the orchestrator can
 * always rely on a valid object.
 *
 * @param {string} characterId
 * @returns {object} archetype
 */
export function getArchetypeForCharacter(characterId) {
  const key = CHARACTER_TO_ARCHETYPE[characterId] || 'balanced';
  return AI_ARCHETYPES[key] || AI_ARCHETYPES.balanced;
}

/**
 * Coerce a string id or archetype object into a concrete archetype object.
 *
 * @param {string|object|null|undefined} archetype
 * @returns {object}
 */
export function resolveArchetype(archetype) {
  if (archetype && typeof archetype === 'object' && archetype.id) return archetype;
  if (typeof archetype === 'string' && AI_ARCHETYPES[archetype]) return AI_ARCHETYPES[archetype];
  return AI_ARCHETYPES.balanced;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Build the per-round difficulty profile for an archetype.
 *
 * Round 1 baseline (balanced):
 *   reaction ~ 0.20s, parry 0.20, block 0.30
 *
 * Round 5 baseline (balanced):
 *   reaction ~ 0.08s, parry 0.55, block 0.10
 *
 * Archetype affinities scale each axis: a grappler blocks more, an agile
 * archetype evades more, etc.
 *
 * @param {string|object} archetype
 * @param {number} [round]
 * @returns {object} difficulty coefficients used by the orchestrator
 */
export function getDifficultyProfile(archetype, round = 1) {
  const arche = resolveArchetype(archetype);
  const r = Math.max(1, Math.min(8, Math.round(round) || 1));
  const t = Math.min(1, (r - 1) / 4);

  const baseReaction = lerp(0.20, 0.08, t);
  const baseParry = lerp(0.20, 0.55, t);
  const baseBlock = lerp(0.30, 0.10, t);
  const baseEvade = lerp(0.18, 0.50, t);
  const baseAggression = lerp(0.55, 0.85, t);
  const baseAccuracy = lerp(0.62, 0.92, t);
  const baseGrapple = lerp(0.10, 0.40, t);
  const baseFeint = lerp(0.05, 0.30, t);
  const baseCounter = lerp(0.30, 0.70, t);
  const baseCombo = lerp(0.20, 0.65, t);

  const reactionTime = clamp(
    baseReaction + (arche.reactionDelayBase - 0.18),
    0.05,
    0.40
  );
  const parryChance = clamp(baseParry * (0.5 + arche.parryAffinity), 0.05, 0.78);
  const blockChance = clamp(baseBlock * (0.5 + arche.blockAffinity), 0.05, 0.60);
  const evadeChance = clamp(baseEvade * (0.5 + arche.evadeAffinity), 0.05, 0.75);
  const aggression = clamp(baseAggression * (0.7 + arche.aggression * 0.5), 0.30, 0.98);
  const grappleChance = clamp(baseGrapple * (0.4 + arche.grappleAffinity * 1.5), 0.02, 0.65);
  const feintChance = clamp(baseFeint * (0.5 + arche.feintAffinity * 1.5), 0.0, 0.55);
  const counterChance = clamp(baseCounter * (0.6 + arche.aggression * 0.8), 0.20, 0.90);
  const comboChance = clamp(baseCombo * (0.5 + arche.comboAffinity), 0.10, 0.85);
  const accuracy = clamp(baseAccuracy, 0.50, 0.96);

  return {
    aggression,
    reactionTime,
    parryChance,
    counterChance,
    blockChance,
    evadeChance,
    grappleChance,
    feintChance,
    comboChance,
    accuracy,
    patience: arche.patience,
    riskTolerance: arche.riskTolerance,
    archetype: arche,
    round: r,
  };
}
