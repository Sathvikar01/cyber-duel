/**
 * Selectable fighter configurations for the 2.5D silhouette brawler.
 *
 * Each config drives both silhouette proportions in SilhouetteFighter.jsx and
 * can be consumed by UI screens (character select, HUD, etc.).
 */

export const FIGHTERS = {
  ronin: {
    id: 'ronin',
    name: 'Ronin',
    style: 'balanced',
    difficulty: 'normal',
    stats: { speed: 3, power: 3, range: 3 },
    accentColor: '#00d4ff',
    bodyColor: '#07070a',
    description:
      'A disciplined wanderer with no master, equally comfortable striking from any distance.',
    // Silhouette proportions
    torsoScale: 1.0,
    headScale: 1.0,
    limbScale: 1.0,
    handScale: 1.0,
    bodyScale: 1.0,
    stanceOffset: 1.0,
    stance: 'balanced',
    // Procedural body physics: weight > 1 lerps slower (more deliberate),
    // weight < 1 lerps faster (more agile, snappier).
    physics: { weight: 1.0 },
  },

  brute: {
    id: 'brute',
    name: 'Brute',
    style: 'heavy',
    difficulty: 'easy',
    stats: { speed: 1, power: 5, range: 2 },
    accentColor: '#ff7b00',
    bodyColor: '#08070a',
    description:
      'A hulking mountain of muscle whose haymakers end fights in a single clean blow.',
    torsoScale: 1.25,
    headScale: 0.9,
    limbScale: 1.1,
    handScale: 1.2,
    bodyScale: 1.1,
    stanceOffset: 0.92,
    stance: 'hunched',
    physics: { weight: 1.4 },
  },

  monk: {
    id: 'monk',
    name: 'Monk',
    style: 'fast',
    difficulty: 'hard',
    stats: { speed: 5, power: 2, range: 3 },
    accentColor: '#f9d76c',
    bodyColor: '#08070a',
    description:
      'A lightning-fast ascetic who turns every block into a blur of counter-strikes.',
    torsoScale: 0.85,
    headScale: 0.95,
    limbScale: 1.15,
    handScale: 0.9,
    bodyScale: 0.95,
    stanceOffset: 1.05,
    stance: 'low',
    physics: { weight: 0.8 },
  },

  assassin: {
    id: 'assassin',
    name: 'Assassin',
    style: 'agile',
    difficulty: 'expert',
    stats: { speed: 4, power: 2, range: 4 },
    accentColor: '#9d4edd',
    bodyColor: '#08070a',
    description:
      'A shadow with knives for feet, darting in and out before opponents can react.',
    torsoScale: 0.8,
    headScale: 0.9,
    limbScale: 1.05,
    handScale: 0.85,
    bodyScale: 1.0,
    stanceOffset: 1.0,
    stance: 'sideways',
    physics: { weight: 0.7 },
  },
};

/** Convenience array for character-select screens. */
export const FIGHTER_LIST = Object.values(FIGHTERS);
