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
  // Note: hipY is intentionally NOT mapped to a bone position. The Xbot
  // GLB uses a 0.01 cm->m internal scale, so writing positionY to the
  // Hips bone in model units is wrong (it would shove the legs below
  // the floor). Instead, hipY is applied as a world-space Y offset on
  // the model group in GLBFighter.jsx -- see the breathing block.
  torso: { bone: 'mixamorigSpine2', type: 'rotation' },
  head: { bone: 'mixamorigHead', type: 'rotation' },
  armL: { bone: 'mixamorigLeftArm', type: 'rotation' },
  foreL: { bone: 'mixamorigLeftForeArm', type: 'rotation' },
  armR: { bone: 'mixamorigRightArm', type: 'rotation' },
  foreR: { bone: 'mixamorigRightForeArm', type: 'rotation' },
  legL: { bone: 'mixamorigLeftUpLeg', type: 'rotation' },
  calfL: { bone: 'mixamorigLeftLeg', type: 'rotation' },
  footL: { bone: 'mixamorigLeftFoot', type: 'rotation' },
  legR: { bone: 'mixamorigRightUpLeg', type: 'rotation' },
  calfR: { bone: 'mixamorigRightLeg', type: 'rotation' },
  footR: { bone: 'mixamorigRightFoot', type: 'rotation' },
});

/**
 * One-time rest-pose correction for the Mixamo T-pose so the arms hang
 * naturally at the sides and the character stands upright. Applied at
 * mount; thereafter, our pose Euler angles are additive deltas.
 *
 * Bone names use the Mixamo `mixamorig` prefix because that's what
 * the Xbot GLB actually exports. (The old version of this table
 * used bare names like "Hips" / "LeftArm" which never matched the
 * scene, so the correction was silently a no-op and the Xbot stayed
 * in T-pose with arms sticking out horizontally.)
 *
 * Values tuned by eye against Xbot.glb (three.js r184):
 *   - mixamorigHips:  no rotation (Y-flip was removed -- it was
 *                     making the character face away from the camera).
 *   - mixamorigLeftArm:  z = +π/2  (~+90 deg, hangs the T-pose arm
 *                                     straight down)
 *   - mixamorigRightArm: z = -π/2  (~-90 deg, mirror)
 *
 * The pose's idle `armL=[0.5, 0, 0.4]` then adds a forward pitch on
 * top, bringing the hands up into a guard.
 */
export const XBOT_REST_CORRECTION = Object.freeze({
  mixamorigHips: { rotation: [0, 0, 0] },
  mixamorigSpine: { rotation: [0, 0, 0] },
  mixamorigSpine1: { rotation: [0, 0, 0] },
  mixamorigSpine2: { rotation: [0, 0, 0] },
  mixamorigNeck: { rotation: [0, 0, 0] },
  mixamorigHead: { rotation: [0, 0, 0] },
  mixamorigLeftArm: { rotation: [0, 0, Math.PI / 2] },
  mixamorigLeftForeArm: { rotation: [0, 0, 0] },
  mixamorigLeftHand: { rotation: [0, 0, 0] },
  mixamorigRightArm: { rotation: [0, 0, -Math.PI / 2] },
  mixamorigRightForeArm: { rotation: [0, 0, 0] },
  mixamorigRightHand: { rotation: [0, 0, 0] },
  mixamorigLeftUpLeg: { rotation: [0, 0, 0] },
  mixamorigLeftLeg: { rotation: [0, 0, 0] },
  mixamorigLeftFoot: { rotation: [0, 0, 0] },
  mixamorigRightUpLeg: { rotation: [0, 0, 0] },
  mixamorigRightLeg: { rotation: [0, 0, 0] },
  mixamorigRightFoot: { rotation: [0, 0, 0] },
});

/**
 * RobotExpressive bone map (three.js r184).
 *
 * Verified by inspect_robot.mjs against the actual GLB skeleton. The
 * three.js example ships a flat humanoid rig with bones named
 * `Hips`, `Torso_1`, `Neck`, `Head`, `UpperArmL/R`, `LowerArmL/R`,
 * `UpperLegL/R`, `LowerLegL/R`, etc. (no `Bone_` prefix). The rest
 * pose already has the arms at the sides, so no rest-correction
 * block is needed.
 */
export const ROBOT_BONE_MAP = Object.freeze({
  // hipY omitted for the same reason as Xbot (RobotExpressive uses
  // its own internal scale; we apply hipY as a world-space group
  // offset in GLBFighter).
  torso: { bone: 'Torso_1', type: 'rotation' },
  head: { bone: 'Head', type: 'rotation' },
  armL: { bone: 'UpperArmL', type: 'rotation' },
  foreL: { bone: 'LowerArmL', type: 'rotation' },
  armR: { bone: 'UpperArmR', type: 'rotation' },
  foreR: { bone: 'LowerArmR', type: 'rotation' },
  legL: { bone: 'UpperLegL', type: 'rotation' },
  calfL: { bone: 'LowerLegL', type: 'rotation' },
  footL: { bone: 'FootL', type: 'rotation' },
  legR: { bone: 'UpperLegR', type: 'rotation' },
  calfR: { bone: 'LowerLegR', type: 'rotation' },
  footR: { bone: 'FootR', type: 'rotation' },
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
