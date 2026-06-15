/**
 * NPC movement / spacing helpers.
 *
 * These are tiny pure functions so the orchestrator can compose them. The
 * orchestrator owns velocity application and clamping.
 */

const DEFAULT_TOO_CLOSE = 2.0;
const DEFAULT_CLOSE = 3.4;
const DEFAULT_IDEAL = 4.4;
const DEFAULT_FAR = 6.0;

function rangeBoundaries(archetype) {
  const pref = archetype?.rangePreference || 'mid';
  if (pref === 'close') {
    return {
      tooCloseRange: 1.6,
      closeRange: 2.9,
      idealRange: 3.6,
      farRange: 5.4,
    };
  }
  if (pref === 'far') {
    return {
      tooCloseRange: 2.4,
      closeRange: 3.8,
      idealRange: 4.8,
      farRange: 6.2,
    };
  }
  return {
    tooCloseRange: DEFAULT_TOO_CLOSE,
    closeRange: DEFAULT_CLOSE,
    idealRange: DEFAULT_IDEAL,
    farRange: DEFAULT_FAR,
  };
}

/**
 * Classify a distance into one of four range buckets.
 *
 * @param {number} dist
 * @param {object} archetype resolved archetype
 * @returns {{ tooClose: boolean, close: boolean, ideal: boolean, far: boolean, distance: number, boundaries: object }}
 */
export function getRangeState(dist, archetype) {
  const bounds = rangeBoundaries(archetype);
  const tooClose = dist < bounds.tooCloseRange;
  const close = !tooClose && dist < bounds.closeRange;
  const ideal = !tooClose && !close && dist < bounds.farRange;
  const far = dist >= bounds.farRange;
  return { tooClose, close, ideal, far, distance: dist, boundaries: bounds };
}

/**
 * Decide what the NPC should be trying to do with its feet right now.
 *
 * Returns one of: 'hold', 'microMove', 'circle', 'retreat', 'approach',
 * 'escapeCorner'.
 *
 * @param {object} archetype
 * @param {object} range result from getRangeState
 * @param {boolean} cornered
 * @param {boolean} playerAttacking
 * @returns {string}
 */
export function getMovementIntent(archetype, range, cornered, playerAttacking) {
  const style = archetype?.movementStyle || 'direct';

  if (cornered) return 'escapeCorner';

  if (playerAttacking) {
    if (range.tooClose) return 'retreat';
    if (range.close && (archetype?.evadeAffinity || 0) > 0.5) return 'retreat';
    return 'hold';
  }

  if (range.far) return 'approach';
  if (range.tooClose) {
    if (style === 'circling') return 'circle';
    if ((archetype?.grappleAffinity || 0) > 0.6) return 'hold';
    return 'retreat';
  }
  if (range.ideal) {
    if (style === 'jittery') return 'microMove';
    if (style === 'circling') return 'circle';
    return 'hold';
  }
  // close band
  if (style === 'jittery') return 'microMove';
  return 'hold';
}

/**
 * Compute an escape velocity for a cornered NPC, biased toward arena centre.
 *
 * If the player is between us and the centre, we add a small Z component so
 * the NPC slips around them instead of running straight into the attack.
 *
 * @param {number[]} npcPos [x, y, z]
 * @param {number[]} playerPos
 * @param {object} cfg { arenaHalfWidth, cornerThreshold }
 * @returns {number[]} velocity in world units/sec ([x, 0, z])
 */
export function cornerEscapeVector(npcPos, playerPos, cfg = {}) {
  const halfW = cfg.arenaHalfWidth ?? 15;
  const cornerThreshold = cfg.cornerThreshold ?? 3.5;
  const npcX = npcPos?.[0] || 0;
  const playerX = playerPos?.[0] || 0;
  const sideToCenter = npcX === 0 ? 1 : -Math.sign(npcX);

  const playerBlocksPath = sideToCenter > 0 ? playerX > npcX : playerX < npcX;
  const distFromEdge = halfW - Math.abs(npcX);
  const urgency = Math.min(1.6, 1.0 + Math.max(0, cornerThreshold - distFromEdge) * 0.35);

  let zComp = 0;
  if (playerBlocksPath) {
    // Pick a side to slip around the player; deterministic across frames
    // would jitter, so tie the slip direction to which Z side we're on.
    const npcZ = npcPos?.[2] || 0;
    zComp = (npcZ >= 0 ? 1 : -1) * 0.5;
  }

  return [sideToCenter * urgency, 0, zComp];
}

/**
 * Convert a movement intent into a velocity vector (in MOVE_SPEED units).
 *
 * The orchestrator multiplies by `MOVE_SPEED * dt` when applying.
 *
 * @param {string} intent
 * @param {number} dx player_x - npc_x
 * @param {number} dz player_z - npc_z
 * @param {number} dist
 * @param {object} archetype
 * @param {object} cfg
 * @returns {number[]} [vx, 0, vz]
 */
export function velocityForIntent(intent, dx, dz, dist, archetype, cfg = {}) {
  const approach = cfg.approachSpeedFactor ?? 0.72;
  const retreat = cfg.retreatSpeedFactor ?? 0.65;
  const safeDist = dist > 0.001 ? dist : 0.001;
  const ux = dx / safeDist;
  const uz = dz / safeDist;

  switch (intent) {
    case 'approach': {
      const speed = approach * (0.85 + (archetype?.aggression || 0.5) * 0.4);
      return [ux * speed, 0, uz * speed];
    }
    case 'retreat': {
      const speed = retreat * (0.85 + (archetype?.evadeAffinity || 0.4) * 0.35);
      return [-ux * speed, 0, -uz * speed];
    }
    case 'circle': {
      const dir = (archetype?.id?.charCodeAt(0) || 0) % 2 === 0 ? 1 : -1;
      const speed = retreat * 0.65;
      // Perpendicular vector (rotate 90deg in xz plane)
      return [-uz * speed * dir, 0, ux * speed * dir];
    }
    case 'microMove': {
      const speed = retreat * 0.3;
      const t = (Date.now() % 800) / 800;
      const oscillate = Math.sin(t * Math.PI * 2);
      return [-ux * speed * oscillate, 0, -uz * speed * oscillate];
    }
    case 'hold':
    default:
      return [0, 0, 0];
  }
}
