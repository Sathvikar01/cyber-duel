import { idlePose, clamp01 } from './poseMath.js';

/**
 * Phase-based animation clips.
 *
 * Each clip is an array of phases with:
 *   start, end   - normalized progress window [0, 1]
 *   pose         - pose delta applied on top of idle
 *   rootOffset   - optional [x, y, z] root translation in meters
 *   ease         - easing function name
 */

const EASES = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  strike: (t) => (t < 0.4 ? Math.sin((t / 0.4) * (Math.PI / 2)) : 1 - (t - 0.4) / 0.6 * 0.25),
  recovery: (t) => 1 - Math.pow(t, 1.5),
  hold: () => 1,
};

const ID = idlePose(0);

function delta(pose) {
  const out = {};
  for (const key of Object.keys(ID)) {
    if (pose[key] !== undefined) {
      out[key] = Array.isArray(ID[key])
        ? [pose[key][0] - ID[key][0], pose[key][1] - ID[key][1], pose[key][2] - ID[key][2]]
        : pose[key] - ID[key];
    } else {
      out[key] = Array.isArray(ID[key]) ? [...ID[key]] : ID[key];
    }
  }
  return out;
}

function ph(start, end, pose, opts = {}) {
  return {
    start,
    end,
    pose: delta(pose),
    rootOffset: opts.rootOffset || [0, 0, 0],
    ease: opts.ease || 'linear',
  };
}

function d(arr) {
  return arr;
}

export const CLIPS = {
  idle: [
    ph(0, 1, {
      hipY: 1.0, torso: d([0, 0, 0]), head: d([0, 0, 0]),
      armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]),
      armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]),
      legL: d([-0.15, 0, 0.08]), calfL: d([0.15, 0, 0]),
      legR: d([0.15, 0, -0.08]), calfR: d([0.1, 0, 0]),
    }),
  ],

  walk: [
    ph(0, 1, {
      hipY: 1.04, torso: d([0, 0, 0.04]), head: d([0, 0, 0]),
      armL: d([0.2, 0, 0.4]), foreL: d([-1.2, 0, 0]),
      armR: d([0.8, 0, -0.4]), foreR: d([-1.2, 0, 0]),
      legL: d([-0.65, 0, 0.08]), calfL: d([0.65, 0, 0]),
      legR: d([0.65, 0, -0.08]), calfR: d([0, 0, 0]),
    }),
  ],

  jab: [
    ph(0, 0.15, { hipY: 1.0, torso: d([0, -0.1, 0]), armL: d([0.6, 0, 0.45]), foreL: d([-1.3, 0, 0]) }, { ease: 'inQuad' }),
    ph(0.15, 0.35, { hipY: 1.0, torso: d([0, -0.35, 0]), armL: d([-1.5, 0, 0.05]), foreL: d([-0.1, 0, 0]), legL: d([-0.3, 0, 0.08]) }, { rootOffset: [0.1, 0, 0], ease: 'strike' }),
    ph(0.35, 0.55, { hipY: 1.0, torso: d([0, -0.35, 0]), armL: d([-1.5, 0, 0.05]), foreL: d([-0.1, 0, 0]), legL: d([-0.3, 0, 0.08]) }, { rootOffset: [0.1, 0, 0], ease: 'hold' }),
    ph(0.55, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), legL: d([-0.15, 0, 0.08]) }, { ease: 'recovery' }),
  ],

  cross: [
    ph(0, 0.15, { hipY: 1.0, torso: d([0, -0.2, 0.02]), armR: d([0.6, 0, -0.45]), foreR: d([-1.3, 0, 0]) }, { ease: 'inQuad' }),
    ph(0.15, 0.35, { hipY: 1.0, torso: d([0, -0.9, 0.1]), armR: d([-1.6, 0, -0.05]), foreR: d([-0.1, 0, 0]), legR: d([0.25, 0, -0.08]) }, { rootOffset: [0.15, 0, 0], ease: 'strike' }),
    ph(0.35, 0.55, { hipY: 1.0, torso: d([0, -0.9, 0.1]), armR: d([-1.6, 0, -0.05]), foreR: d([-0.1, 0, 0]), legR: d([0.25, 0, -0.08]) }, { rootOffset: [0.15, 0, 0], ease: 'hold' }),
    ph(0.55, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]), legR: d([0.15, 0, -0.08]) }, { ease: 'recovery' }),
  ],

  low_kick: [
    ph(0, 0.2, { hipY: 0.95, torso: d([-0.05, -0.1, 0]), legR: d([0.15, 0, -0.08]), calfR: d([0.1, 0, 0]) }, { ease: 'inQuad' }),
    ph(0.2, 0.45, { hipY: 0.98, torso: d([-0.25, -0.2, 0]), legR: d([-1.4, 0, 0.4]), calfR: d([0.3, 0, 0]) }, { rootOffset: [0.15, 0, 0], ease: 'strike' }),
    ph(0.45, 0.65, { hipY: 0.98, torso: d([-0.25, -0.2, 0]), legR: d([-1.4, 0, 0.4]), calfR: d([0.3, 0, 0]) }, { rootOffset: [0.15, 0, 0], ease: 'hold' }),
    ph(0.65, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), legR: d([0.15, 0, -0.08]), calfR: d([0.1, 0, 0]) }, { ease: 'recovery' }),
  ],

  roundhouse: [
    ph(0, 0.2, { hipY: 1.05, torso: d([0, -0.2, 0]), legL: d([-0.5, 0, 0.3]), calfL: d([0.4, 0, 0]), armL: d([0.7, 0, 0.6]), armR: d([0.7, 0, -0.6]) }, { ease: 'inCubic' }),
    ph(0.2, 0.45, { hipY: 1.25, torso: d([-0.3, -1.8, 0]), legL: d([-1.4, -0.6, -1.2]), calfL: d([0, 0, 0]), armL: d([0.8, 0, 0.8]), armR: d([0.8, 0, -0.8]) }, { rootOffset: [0.05, 0, 0], ease: 'strike' }),
    ph(0.45, 0.7, { hipY: 1.25, torso: d([-0.3, -1.8, 0]), legL: d([-1.4, -0.6, -1.2]), calfL: d([0, 0, 0]), armL: d([0.8, 0, 0.8]), armR: d([0.8, 0, -0.8]) }, { rootOffset: [0.05, 0, 0], ease: 'hold' }),
    ph(0.7, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), legL: d([-0.15, 0, 0.08]), calfL: d([0.15, 0, 0]), armL: d([0.5, 0, 0.4]), armR: d([0.5, 0, -0.4]) }, { ease: 'recovery' }),
  ],

  uppercut: [
    ph(0, 0.2, { hipY: 0.95, torso: d([-0.05, 0, 0]), armR: d([0.8, 0, -0.4]), foreR: d([-1.4, 0, 0]), legL: d([-0.25, 0, 0.08]), calfL: d([0.25, 0, 0]) }, { ease: 'inQuad' }),
    ph(0.2, 0.45, { hipY: 1.35, torso: d([-0.25, 0, 0]), armR: d([-2.6, 0, 0]), foreR: d([-0.6, 0, 0]), legL: d([-0.5, 0, 0.08]), calfL: d([0.5, 0, 0]), legR: d([-0.4, 0, -0.08]), calfR: d([0.4, 0, 0]) }, { rootOffset: [0.1, 0, 0], ease: 'strike' }),
    ph(0.45, 0.7, { hipY: 1.35, torso: d([-0.25, 0, 0]), armR: d([-2.6, 0, 0]), foreR: d([-0.6, 0, 0]), legL: d([-0.5, 0, 0.08]), calfL: d([0.5, 0, 0]), legR: d([-0.4, 0, -0.08]), calfR: d([0.4, 0, 0]) }, { rootOffset: [0.1, 0, 0], ease: 'hold' }),
    ph(0.7, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]), legL: d([-0.15, 0, 0.08]), calfL: d([0.15, 0, 0]), legR: d([0.15, 0, -0.08]), calfR: d([0.1, 0, 0]) }, { ease: 'recovery' }),
  ],

  block: [
    ph(0, 0.2, { hipY: 0.95, torso: d([0.05, 0, 0]) }, { ease: 'inQuad' }),
    ph(0.2, 0.8, { hipY: 0.95, torso: d([0.1, 0, 0]), armL: d([-0.3, 0, 0.8]), foreL: d([-1.8, 0, 0]), armR: d([-0.3, 0, -0.8]), foreR: d([-1.8, 0, 0]) }, { ease: 'outQuad' }),
    ph(0.8, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]) }, { ease: 'recovery' }),
  ],

  parry: [
    ph(0, 0.15, { hipY: 0.95, torso: d([0.05, 0.2, 0]), armL: d([-0.5, 0, 0.9]), foreL: d([-1.9, 0, 0]), armR: d([-0.5, 0, -0.9]), foreR: d([-1.9, 0, 0]) }, { rootOffset: [-0.1, 0, 0], ease: 'inCubic' }),
    ph(0.15, 0.35, { hipY: 0.95, torso: d([0.05, -0.3, 0]), armL: d([-0.2, 0, 0.7]), foreL: d([-1.6, 0, 0]), armR: d([-0.2, 0, -0.7]), foreR: d([-1.6, 0, 0]) }, { rootOffset: [0.05, 0, 0], ease: 'strike' }),
    ph(0.35, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]) }, { ease: 'recovery' }),
  ],

  backstep: [
    ph(0, 0.3, { hipY: 0.95, torso: d([0.05, 0, 0]), armL: d([0.7, 0, 0.5]), foreL: d([-1.2, 0, 0]), armR: d([0.7, 0, -0.5]), foreR: d([-1.2, 0, 0]), legL: d([-0.35, 0, 0.08]), legR: d([0.35, 0, -0.08]) }, { rootOffset: [-0.25, 0, 0], ease: 'outQuad' }),
    ph(0.3, 0.7, { hipY: 0.95, torso: d([0.05, 0, 0]), armL: d([0.7, 0, 0.5]), foreL: d([-1.2, 0, 0]), armR: d([0.7, 0, -0.5]), foreR: d([-1.2, 0, 0]), legL: d([-0.35, 0, 0.08]), legR: d([0.35, 0, -0.08]) }, { rootOffset: [-0.45, 0, 0], ease: 'linear' }),
    ph(0.7, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]), legL: d([-0.15, 0, 0.08]), legR: d([0.15, 0, -0.08]) }, { rootOffset: [-0.1, 0, 0], ease: 'recovery' }),
  ],

  clinch: [
    ph(0, 0.3, { hipY: 1.0, torso: d([0.05, 0.2, 0]), armL: d([0.3, 0, 0.6]), foreL: d([-1.0, 0, 0]), armR: d([0.3, 0, -0.6]), foreR: d([-1.0, 0, 0]) }, { rootOffset: [0.1, 0, 0], ease: 'inOutQuad' }),
    ph(0.3, 0.7, { hipY: 0.95, torso: d([0.1, 0.3, 0]), armL: d([-0.2, 0, 0.7]), foreL: d([-0.8, 0, 0]), armR: d([-0.2, 0, -0.7]), foreR: d([-0.8, 0, 0]) }, { rootOffset: [0.25, 0, 0], ease: 'hold' }),
    ph(0.7, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]) }, { ease: 'recovery' }),
  ],

  throw: [
    ph(0, 0.25, { hipY: 1.0, torso: d([0, -0.2, 0]), armL: d([0.6, 0, 0.5]), foreL: d([-1.1, 0, 0]), armR: d([0.6, 0, -0.5]), foreR: d([-1.1, 0, 0]) }, { rootOffset: [0.1, 0, 0], ease: 'inQuad' }),
    ph(0.25, 0.5, { hipY: 1.1, torso: d([0, -0.6, 0]), armL: d([-0.8, 0, 0.6]), foreL: d([-0.4, 0, 0]), armR: d([-0.8, 0, -0.6]), foreR: d([-0.4, 0, 0]) }, { rootOffset: [0.35, 0, 0], ease: 'strike' }),
    ph(0.5, 0.75, { hipY: 1.1, torso: d([0, -0.6, 0]), armL: d([-0.8, 0, 0.6]), foreL: d([-0.4, 0, 0]), armR: d([-0.8, 0, -0.6]), foreR: d([-0.4, 0, 0]) }, { rootOffset: [0.35, 0, 0], ease: 'hold' }),
    ph(0.75, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]) }, { ease: 'recovery' }),
  ],

  thrown: [
    ph(0, 0.3, { hipY: 1.0, torso: d([0.2, 0.2, 0.1]), armL: d([0.8, 0, 0.7]), foreL: d([-0.5, 0, 0]), armR: d([0.8, 0, -0.7]), foreR: d([-0.5, 0, 0]) }, { rootOffset: [-0.1, 0, 0], ease: 'outQuad' }),
    ph(0.3, 0.8, { hipY: 0.35, torso: d([-0.3, 0.4, -0.2]), head: d([0.4, 0, 0.2]), armL: d([1.0, 0, 0.8]), foreL: d([-0.2, 0, 0]), armR: d([1.0, 0, -0.8]), foreR: d([-0.2, 0, 0]), legL: d([-0.6, 0, 0.08]), calfL: d([0.6, 0, 0]), legR: d([0.6, 0, -0.08]), calfR: d([0.6, 0, 0]) }, { rootOffset: [-0.6, 0, 0], ease: 'outCubic' }),
    ph(0.8, 1.0, { hipY: 0.35, torso: d([-0.3, 0.4, -0.2]), head: d([0.4, 0, 0.2]), armL: d([1.0, 0, 0.8]), foreL: d([-0.2, 0, 0]), armR: d([1.0, 0, -0.8]), foreR: d([-0.2, 0, 0]), legL: d([-0.6, 0, 0.08]), calfL: d([0.6, 0, 0]), legR: d([0.6, 0, -0.08]), calfR: d([0.6, 0, 0]) }, { rootOffset: [-0.6, 0, 0], ease: 'hold' }),
  ],

  flinch: [
    ph(0, 0.15, { hipY: 0.95, torso: d([0.15, 0, -0.05]), head: d([0.2, 0, 0.1]), armL: d([0.7, 0, 0.6]), foreL: d([-0.6, 0, 0]), armR: d([0.7, 0, -0.6]), foreR: d([-0.6, 0, 0]) }, { rootOffset: [-0.05, 0, 0], ease: 'strike' }),
    ph(0.15, 0.5, { hipY: 0.95, torso: d([0.3, 0, -0.15]), head: d([0.4, 0, 0.2]), armL: d([0.8, 0, 0.7]), foreL: d([-0.5, 0, 0]), armR: d([0.8, 0, -0.7]), foreR: d([-0.5, 0, 0]) }, { rootOffset: [-0.1, 0, 0], ease: 'hold' }),
    ph(0.5, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), head: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]) }, { ease: 'recovery' }),
  ],

  stumble: [
    ph(0, 0.25, { hipY: 0.9, torso: d([0.2, 0.2, -0.15]), head: d([0.3, 0, 0.2]), armL: d([0.9, 0, 0.7]), foreL: d([-0.4, 0, 0]), armR: d([0.9, 0, -0.7]), foreR: d([-0.4, 0, 0]), legL: d([-0.35, 0, 0.08]), legR: d([0.35, 0, -0.08]) }, { rootOffset: [-0.25, 0, 0], ease: 'outQuad' }),
    ph(0.25, 0.7, { hipY: 0.85, torso: d([0.25, 0.4, -0.2]), head: d([0.4, 0, 0.25]), armL: d([1.0, 0, 0.8]), foreL: d([-0.2, 0, 0]), armR: d([1.0, 0, -0.8]), foreR: d([-0.2, 0, 0]), legL: d([-0.5, 0, 0.08]), calfL: d([0.3, 0, 0]), legR: d([0.5, 0, -0.08]), calfR: d([0.3, 0, 0]) }, { rootOffset: [-0.45, 0, 0], ease: 'hold' }),
    ph(0.7, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), head: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]), legL: d([-0.15, 0, 0.08]), calfL: d([0.15, 0, 0]), legR: d([0.15, 0, -0.08]), calfR: d([0.1, 0, 0]) }, { rootOffset: [-0.05, 0, 0], ease: 'recovery' }),
  ],

  knockdown: [
    ph(0, 0.25, { hipY: 0.9, torso: d([0.2, 0.3, -0.2]), head: d([0.4, 0, 0.2]), armL: d([1.0, 0, 0.8]), foreL: d([-0.3, 0, 0]), armR: d([1.0, 0, -0.8]), foreR: d([-0.3, 0, 0]) }, { rootOffset: [-0.2, 0, 0], ease: 'outQuad' }),
    ph(0.25, 0.6, { hipY: 0.25, torso: d([-0.4, 0.5, -0.3]), head: d([0.5, 0, 0.3]), armL: d([1.2, 0, 0.9]), foreL: d([0, 0, 0]), armR: d([1.2, 0, -0.9]), foreR: d([0, 0, 0]), legL: d([-0.7, 0, 0.08]), calfL: d([0.7, 0, 0]), legR: d([0.7, 0, -0.08]), calfR: d([0.7, 0, 0]) }, { rootOffset: [-0.7, 0, 0], ease: 'outCubic' }),
    ph(0.6, 1.0, { hipY: 0.2, torso: d([-0.4, 0.5, -0.3]), head: d([0.5, 0, 0.3]), armL: d([1.2, 0, 0.9]), foreL: d([0, 0, 0]), armR: d([1.2, 0, -0.9]), foreR: d([0, 0, 0]), legL: d([-0.7, 0, 0.08]), calfL: d([0.7, 0, 0]), legR: d([0.7, 0, -0.08]), calfR: d([0.7, 0, 0]) }, { rootOffset: [-0.7, 0, 0], ease: 'hold' }),
  ],

  getup: [
    ph(0, 0.3, { hipY: 0.25, torso: d([-0.4, 0.5, -0.3]), head: d([0.5, 0, 0.3]), armL: d([1.2, 0, 0.9]), foreL: d([0, 0, 0]), armR: d([1.2, 0, -0.9]), foreR: d([0, 0, 0]), legL: d([-0.7, 0, 0.08]), calfL: d([0.7, 0, 0]), legR: d([0.7, 0, -0.08]), calfR: d([0.7, 0, 0]) }, { rootOffset: [-0.7, 0, 0], ease: 'linear' }),
    ph(0.3, 0.6, { hipY: 0.7, torso: d([-0.2, 0.2, -0.1]), head: d([0.2, 0, 0.1]), armL: d([0.9, 0, 0.6]), foreL: d([-0.5, 0, 0]), armR: d([0.9, 0, -0.6]), foreR: d([-0.5, 0, 0]), legL: d([-0.5, 0, 0.08]), calfL: d([0.5, 0, 0]), legR: d([0.5, 0, -0.08]), calfR: d([0.5, 0, 0]) }, { rootOffset: [-0.3, 0, 0], ease: 'inOutCubic' }),
    ph(0.6, 1.0, { hipY: 1.0, torso: d([0, 0, 0]), head: d([0, 0, 0]), armL: d([0.5, 0, 0.4]), foreL: d([-1.2, 0, 0]), armR: d([0.5, 0, -0.4]), foreR: d([-1.2, 0, 0]), legL: d([-0.15, 0, 0.08]), calfL: d([0.15, 0, 0]), legR: d([0.15, 0, -0.08]), calfR: d([0.1, 0, 0]) }, { ease: 'recovery' }),
  ],
};

export function sampleClip(clipName, progress) {
  const clip = CLIPS[clipName] || CLIPS.idle;
  const t = clamp01(progress);

  let startPhase = clip[0];
  let endPhase = clip[clip.length - 1];

  for (let i = 0; i < clip.length - 1; i++) {
    if (t >= clip[i].start && t < clip[i + 1].start) {
      startPhase = clip[i];
      endPhase = clip[i + 1];
      break;
    }
  }

  if (t >= clip[clip.length - 1].start) {
    startPhase = clip[clip.length - 1];
    endPhase = clip[clip.length - 1];
  }

  const phaseDur = endPhase.start - startPhase.start || 1;
  const localT = phaseDur <= 0 ? 0 : clamp01((t - startPhase.start) / phaseDur);
  const easeFn = EASES[startPhase.ease] || EASES.linear;
  const et = easeFn(localT);

  const pose = {};
  for (const key of Object.keys(ID)) {
    const a = startPhase.pose[key];
    const b = endPhase.pose[key];
    if (Array.isArray(a)) {
      pose[key] = [a[0] + (b[0] - a[0]) * et, a[1] + (b[1] - a[1]) * et, a[2] + (b[2] - a[2]) * et];
    } else {
      pose[key] = a + (b - a) * et;
    }
  }

  const roA = startPhase.rootOffset;
  const roB = endPhase.rootOffset;
  const rootOffset = [roA[0] + (roB[0] - roA[0]) * et, roA[1] + (roB[1] - roA[1]) * et, roA[2] + (roB[2] - roA[2]) * et];

  return { pose, rootOffset, phase: startPhase };
}
