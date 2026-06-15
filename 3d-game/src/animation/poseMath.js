/**
 * Pose math utilities for blending phase-based animation clips.
 * All rotations are expressed as [x, y, z] Euler triples in radians.
 */

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

export function blendRot(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function addDelta(base, delta) {
  if (!delta) return base;
  return [base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]];
}

export function applyPose(ref, rot) {
  if (!ref || !ref.current || !rot) return;
  ref.current.rotation.x = rot[0];
  ref.current.rotation.y = rot[1];
  ref.current.rotation.z = rot[2];
}

export function idlePose(time) {
  const breath = Math.sin((time || 0) * 3) * 0.02;
  return {
    hipY: 1.0 + breath,
    torso: [0, 0, 0],
    head: [0, 0, 0],
    armL: [0.5, 0, 0.4],
    foreL: [-1.2, 0, 0],
    armR: [0.5, 0, -0.4],
    foreR: [-1.2, 0, 0],
    legL: [-0.15, 0, 0.08],
    calfL: [0.15, 0, 0],
    legR: [0.15, 0, -0.08],
    calfR: [0.1, 0, 0],
    footL: [0.04, 0, 0.02],
    footR: [0.04, 0, -0.02],
  };
}

/**
 * Mirror a pose for the opposite facing direction.
 * Swaps left/right limbs and inverts Z-axis rotations so poses work
 * for fighters facing either direction.
 */
export function mirrorPose(pose) {
  const mirrorRot = (rot) => (rot ? [rot[0], -rot[1], -rot[2]] : rot);
  return {
    hipY: pose.hipY,
    torso: mirrorRot(pose.torso),
    head: mirrorRot(pose.head),
    armL: mirrorRot(pose.armR),
    foreL: mirrorRot(pose.foreR),
    armR: mirrorRot(pose.armL),
    foreR: mirrorRot(pose.foreL),
    legL: mirrorRot(pose.legR),
    calfL: mirrorRot(pose.calfR),
    legR: mirrorRot(pose.legL),
    calfR: mirrorRot(pose.calfL),
    footL: mirrorRot(pose.footR),
    footR: mirrorRot(pose.footL),
  };
}
