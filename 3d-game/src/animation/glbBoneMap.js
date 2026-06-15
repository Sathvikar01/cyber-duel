/**
 * Bone name mapping from our pose-space (SilhouetteFighter procedural rig)
 * to the Mixamo skeleton used by Xbot.glb (three.js official example).
 *
 * Pose fields emitted by animationClips.js (Euler [x, y, z] in radians):
 *   hipY    - vertical root offset (applied to Hips.position.y)
 *   torso   - chest/spine upper rotation
 *   head    - neck/head rotation
 *   armL/R  - upper arm rotation (shoulder pitch/yaw/roll)
 *   foreL/R - forearm rotation
 *   legL/R  - thigh rotation
 *   calfL/R - shin rotation
 *
 * The Mixamo rest pose is a T-pose: arms horizontal. We bake a rest-pose
 * correction once at mount time (see GLBFighter.jsx) so the arms hang down
 * at the side. After that, the pose Euler angles are applied as-is and
 * behave like the silhouette rig (armL[0]=0.5 lifts the arm up at the
 * shoulder, foreL[0]=-1.2 bends the elbow).
 *
 * For RobotExpressive (the evil opponent), the bone names are different
 * (Hip, Spine, LeftArm, RightArm, LeftLeg, RightLeg, etc.) and the rest
 * pose is slightly different. The "robot" skeleton remap is a flat list
 * of bone names without a `correction` block because we only apply the
 * pose deltas — RobotExpressive's natural rest is close enough that no
 * large correction is needed.
 */

export const XBOT_BONE_MAP = Object.freeze({
  hipY: { bone: 'mixamorigHips', type: 'positionY' },
  torso: { bone: 'mixamorigSpine2', type: 'rotation' },
  head: { bone: 'mixamorigHead', type: 'rotation' },
  armL: { bone: 'mixamorigLeftArm', type: 'rotation' },
  foreL: { bone: 'mixamorigLeftForeArm', type: 'rotation' },
  armR: { bone: 'mixamorigRightArm', type: 'rotation' },
  foreR: { bone: 'mixamorigRightForeArm', type: 'rotation' },
  legL: { bone: 'mixamorigLeftUpLeg', type: 'rotation' },
  calfL: { bone: 'mixamorigLeftLeg', type: 'rotation' },
  legR: { bone: 'mixamorigRightUpLeg', type: 'rotation' },
  calfR: { bone: 'mixamorigRightLeg', type: 'rotation' },
});

/**
 * One-time rest-pose correction for the Mixamo T-pose so the arms hang
 * naturally at the sides and the character stands upright. Applied at
 * mount; thereafter, our pose Euler angles are additive deltas.
 *
 * Values tuned by eye against Xbot.glb (three.js r184):
 *   - LeftArm:  z = +0.6  (~+34 deg, rotates the T-pose arm down to side)
 *   - RightArm: z = -0.6  (~-34 deg, mirror)
 *   - Hips:     y = +π    (Y-up; Mixamo ships Z-up for Xbot so we need
 *                           a Y-flip to align with our Y-up world)
 *
 * If bones look inverted, flip the signs in this block.
 */
export const XBOT_REST_CORRECTION = Object.freeze({
  Hips: { rotation: [0, Math.PI, 0] },
  Spine: { rotation: [0, 0, 0] },
  Spine1: { rotation: [0, 0, 0] },
  Spine2: { rotation: [0, 0, 0] },
  Neck: { rotation: [0, 0, 0] },
  Head: { rotation: [0, 0, 0] },
  LeftArm: { rotation: [0, 0, 0.6] },
  LeftForeArm: { rotation: [0, 0, 0] },
  LeftHand: { rotation: [0, 0, 0] },
  RightArm: { rotation: [0, 0, -0.6] },
  RightForeArm: { rotation: [0, 0, 0] },
  RightHand: { rotation: [0, 0, 0] },
  LeftUpLeg: { rotation: [0, 0, 0] },
  LeftLeg: { rotation: [0, 0, 0] },
  LeftFoot: { rotation: [0, 0, 0] },
  RightUpLeg: { rotation: [0, 0, 0] },
  RightLeg: { rotation: [0, 0, 0] },
  RightFoot: { rotation: [0, 0, 0] },
});

/**
 * RobotExpressive bone map (three.js r184).
 *
 * The robot's skeleton is a simplified humanoid with no shoulder twist
 * bone and a single hip. We only drive the limbs we need; head, fingers
 * and toes are left to their rest pose.
 */
export const ROBOT_BONE_MAP = Object.freeze({
  hipY: { bone: 'Bone_BackWaist', type: 'positionY' },
  torso: { bone: 'Bone_SpineChest', type: 'rotation' },
  head: { bone: 'Bone_Head', type: 'rotation' },
  armL: { bone: 'Bone_LeftArm', type: 'rotation' },
  foreL: { bone: 'Bone_LeftForeArm', type: 'rotation' },
  armR: { bone: 'Bone_RightArm', type: 'rotation' },
  foreR: { bone: 'Bone_RightForeArm', type: 'rotation' },
  legL: { bone: 'Bone_LeftThigh', type: 'rotation' },
  calfL: { bone: 'Bone_LeftShin', type: 'rotation' },
  legR: { bone: 'Bone_RightThigh', type: 'rotation' },
  calfR: { bone: 'Bone_RightShin', type: 'rotation' },
});

/**
 * Per-character bone-scale table. Preserves the four-variant fighter
 * roster (Ronin/Brute/Monk/Assassin) by stretching the underlying GLB
 * skeleton at mount time. The pose deltas are applied on top.
 *
 * The values were calibrated against the silhouette torsoScale / limbScale
 * fields in fighterConfigs.js so the visual proportion of the GLB
 * roughly matches the silhouette of the same character.
 */
export const FIGHTER_BONE_SCALES = Object.freeze({
  ronin: {
    spineScale: [1.0, 1.0, 1.0],
    armScale: [1.0, 1.0, 1.0],
    legScale: [1.0, 1.0, 1.0],
    headScale: [1.0, 1.0, 1.0],
  },
  brute: {
    spineScale: [1.25, 1.05, 1.15],
    armScale: [1.15, 1.1, 1.1],
    legScale: [1.1, 1.0, 1.1],
    headScale: [0.95, 0.95, 0.95],
  },
  monk: {
    spineScale: [0.9, 1.0, 0.9],
    armScale: [1.1, 1.05, 1.05],
    legScale: [1.15, 1.0, 1.05],
    headScale: [1.0, 1.0, 1.0],
  },
  assassin: {
    spineScale: [0.85, 1.05, 0.85],
    armScale: [1.05, 1.1, 1.0],
    legScale: [1.1, 1.15, 1.0],
    headScale: [0.95, 1.0, 0.95],
  },
});
