import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { sampleClip } from '../animation/animationClips.js';
import { idlePose, addDelta, mirrorPose } from '../animation/poseMath.js';
import { registerFighterPosition } from '../arenas/components/RepellingParticles';
import {
  XBOT_BONE_MAP,
  XBOT_REST_CORRECTION,
  ROBOT_BONE_MAP,
  FIGHTER_BONE_SCALES,
} from '../animation/glbBoneMap.js';

/**
 * Smoothly chase a value with frame-rate-independent lerp.
 */
function damp(current, target, lambda, dt) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const BACKSTEP_TOTAL = 0.35;
const BACKSTEP_IFRAME_DURATION = 0.05;
const BACKSTEP_RECOVERY_DURATION = 0.12;
const BACKSTEP_RECOVERY_START = BACKSTEP_RECOVERY_DURATION;

const LOCOMOTION_ANIMS = new Set(['idle', 'walk']);
const GROUNDED_REACTIONS = new Set(['fall', 'knockdown', 'thrown']);
const RAISED_ROOT_ANIMS = new Set(['uppercut', 'roundhouse', 'getup']);

const NATIVE_CLIP_NAMES = {
  idle: ['idle', 'Idle', 'Standing'],
  walk: ['walk', 'Walk', 'Walking', 'run', 'Running'],
};

const STRIKE_IMPULSE = {
  jab: 0.42,
  cross: 0.62,
  low_kick: 0.5,
  roundhouse: 0.9,
  uppercut: 0.86,
  parry: 0.28,
  clinch: 0.45,
  throw: 0.78,
};

function getFighterPhysics(character) {
  const stats = character?.stats || {};
  const strength = stats.strength ?? stats.power ?? 60;
  const speed = stats.speed ?? 60;
  const defense = stats.defense ?? 55;
  const configuredWeight = character?.physics?.weight;
  const mass = configuredWeight || clamp(0.72 + strength / 180 + defense / 260 - speed / 420, 0.7, 1.45);
  return {
    mass,
    response: clamp(15 / mass, 8, 22),
    lean: clamp(1.35 / mass, 0.82, 1.55),
    followThrough: clamp(0.74 + strength / 180, 0.82, 1.32),
    footWidth: clamp((character?.bodyScale || 1) * 0.18, 0.14, 0.24),
  };
}

function clipByNames(clips, names) {
  return clips.find((clip) => names.some((name) => clip.name === name));
}

function stabilizedClip(clip) {
  if (!clip) return null;
  const tracks = clip.tracks.map((track) => {
    const isRootPosition =
      track.ValueTypeName === 'vector' &&
      track.name.endsWith('.position') &&
      /(mixamorigHips|Hips|Bone|Body)\.position$/.test(track.name);
    if (!isRootPosition) return track;
    const values = track.values.slice();
    for (let i = 0; i < values.length; i += 3) {
      values[i] = 0;
      values[i + 2] = 0;
    }
    return new THREE.VectorKeyframeTrack(track.name, track.times, values);
  });
  return new THREE.AnimationClip(`${clip.name}_grounded`, clip.duration, tracks);
}

function poseCopy(pose) {
  const out = {};
  for (const [key, value] of Object.entries(pose)) {
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

function addRot(pose, key, delta) {
  if (!pose[key]) pose[key] = [0, 0, 0];
  pose[key][0] += delta[0] || 0;
  pose[key][1] += delta[1] || 0;
  pose[key][2] += delta[2] || 0;
}

function strikeImpulse(anim, progress) {
  const amp = STRIKE_IMPULSE[anim] || 0;
  if (!amp) return 0;
  const t = clamp(progress || 0, 0, 1);
  const windup = clamp(t / 0.18, 0, 1);
  const release = 1 - clamp((t - 0.36) / 0.5, 0, 1);
  return amp * Math.sin(windup * Math.PI * 0.5) * release;
}

function proceduralWeightFor(anim) {
  return LOCOMOTION_ANIMS.has(anim) ? 0.26 : 1.0;
}

function bodyYOffset(anim, hipY) {
  const dy = (hipY || 1) - 1;
  if (GROUNDED_REACTIONS.has(anim)) return dy * 0.72;
  if (anim === 'stumble' || anim === 'clinched') return dy * 0.28;
  if (RAISED_ROOT_ANIMS.has(anim)) return dy * 0.18;
  return dy * 0.018;
}

function enrichPoseWithPhysics(pose, physicsState) {
  const p = poseCopy(pose);
  const {
    lean,
    sway,
    twist,
    impactTilt,
    strike,
    idleWeight,
    time,
    facing,
    speed,
  } = physicsState;

  const breath = Math.sin(time * 2.15) * 0.018 * idleWeight;
  const scan = Math.sin(time * 0.85 + (facing > 0 ? 0 : Math.PI)) * 0.08 * idleWeight;
  const shoulderCounter = clamp(speed * 0.012, 0, 0.12);

  addRot(p, 'torso', [
    impactTilt + lean + strike * 0.16 + breath,
    twist + strike * 0.18,
    sway,
  ]);
  addRot(p, 'head', [
    -lean * 0.35 - impactTilt * 0.22,
    scan - twist * 0.18,
    -sway * 0.35,
  ]);
  addRot(p, 'armL', [strike * 0.04, 0, shoulderCounter - sway * 0.22]);
  addRot(p, 'armR', [strike * 0.04, 0, -shoulderCounter - sway * 0.22]);
  addRot(p, 'foreL', [-strike * 0.035, 0, 0]);
  addRot(p, 'foreR', [-strike * 0.035, 0, 0]);
  addRot(p, 'legL', [Math.max(0, -lean) * 0.12, 0, sway * 0.12]);
  addRot(p, 'legR', [Math.max(0, -lean) * 0.12, 0, sway * 0.12]);
  addRot(p, 'footL', [-lean * 0.12, 0, sway * 0.08]);
  addRot(p, 'footR', [-lean * 0.12, 0, sway * 0.08]);

  return p;
}

/**
 * Pick the right model URL + bone map for a fighter.
 *
 *   player fighter  -> Xbot (humanoid, Mixamo skeleton, blue accent)
 *   opponent fighter -> RobotExpressive (mech, distinct non-human look,
 *                       recolored dark red for "evil" treatment)
 */
function pickRig(character, isPlayer) {
  if (isPlayer) {
    return {
      url: '/models/characters/xbot.glb',
      boneMap: XBOT_BONE_MAP,
      restCorrection: XBOT_REST_CORRECTION,
    };
  }
  return {
    url: '/models/characters/robot_expressive.glb',
    boneMap: ROBOT_BONE_MAP,
    restCorrection: null,
  };
}

/**
 * Apply per-character bone scales (preserves the 4-variant fighter roster).
 * We do this on the SkinnedMesh root bone (mixamorigHips / Bone_BackWaist /
 * whichever is the root) so the whole skeleton scales as one piece.
 */
function applyBoneScales(rootBone, fighterId) {
  if (!rootBone) return;
  const scales = FIGHTER_BONE_SCALES[fighterId] || FIGHTER_BONE_SCALES.ronin;
  if (!rootBone.userData) rootBone.userData = {};
  rootBone.userData.fighterScales = scales;

  const groups = {
    spineScale: [
      'mixamorigSpine',
      'mixamorigSpine1',
      'mixamorigSpine2',
      'Body',
      'Abdomen',
      'Torso_1',
    ],
    armScale: [
      'mixamorigLeftArm',
      'mixamorigLeftForeArm',
      'mixamorigRightArm',
      'mixamorigRightForeArm',
      'UpperArmL',
      'LowerArmL',
      'UpperArmR',
      'LowerArmR',
    ],
    legScale: [
      'mixamorigLeftUpLeg',
      'mixamorigLeftLeg',
      'mixamorigRightUpLeg',
      'mixamorigRightLeg',
      'UpperLegL',
      'LowerLegL',
      'UpperLegR',
      'LowerLegR',
    ],
    headScale: ['mixamorigHead', 'Head'],
  };

  for (const [scaleKey, boneNames] of Object.entries(groups)) {
    const scale = scales[scaleKey];
    if (!scale) continue;
    for (const name of boneNames) {
      const bone = rootBone.getObjectByName(name);
      if (bone) bone.scale.set(scale[0], scale[1], scale[2]);
    }
  }
}

/**
 * GLBFighter -- drop-in replacement for SilhouetteFighter that drives a
 * real three.js glTF character (Xbot for the player, RobotExpressive for
 * the opponent). Combat semantics, hit detection, damage, AI and UI are
 * untouched. Only the visual rig changes.
 *
 * Lifecycle:
 *   1. Mount: useGLTF loads the model, SkeletonUtils.clone makes a
 *      per-instance skeleton (critical: without cloning, both fighters
 *      would share bones and animate together).
 *   2. First frame: findBone() looks up each bone referenced by the
 *      bone map, applies rest-pose correction (Mixamo T-pose -> hanging
 *      arms), and applies per-fighter bone scales.
 *   3. useFrame: sample the current pose from animationClips.js, mirror
 *      it for the opposite facing direction, and apply each Euler
 *      rotation to the mapped bone. Smoothing uses frame-rate-
 *      independent exponential decay.
 *   4. For the opponent, override materials with a dark-red "evil"
 *      variant and parent a pair of horn meshes to the head bone.
 */
export default function GLBFighter({
  stateRef,
  character,
  isPlayer = true,
  onFootstep,
  onBackstepLanding,
}) {
  const groupRef = useRef();
  const modelGroupRef = useRef();
  const bonesRef = useRef({});
  const rootBoneRef = useRef(null);
  const lastProgressRef = useRef(0);
  const prevStrideRef = useRef(0);
  const backstepDustTimerRef = useRef(0);
  const prevBackstepStateTimerRef = useRef(0);
  const prevAnimProgressRef = useRef(0);
  const prevPositionRef = useRef(new THREE.Vector3());
  const leanRef = useRef(0);
  const swayRef = useRef(0);
  const twistRef = useRef(0);
  const squashRef = useRef(0);
  const mixerRef = useRef(null);
  const nativeActionsRef = useRef({});
  const nativeWeightsRef = useRef({});

  const rig = useMemo(() => pickRig(character, isPlayer), [character, isPlayer]);
  const gltf = useGLTF(rig.url);
  const physics = useMemo(() => getFighterPhysics(character), [character]);

  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(gltf.scene);
    return c;
  }, [gltf]);

  useEffect(() => {
    if (!cloned || !gltf.animations?.length) return undefined;

    const mixer = new THREE.AnimationMixer(cloned);
    const actions = {};
    const weights = {};

    for (const [key, names] of Object.entries(NATIVE_CLIP_NAMES)) {
      const source = clipByNames(gltf.animations, names);
      if (!source) continue;
      const clip = stabilizedClip(source);
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.enabled = true;
      action.clampWhenFinished = false;
      action.play();
      action.setEffectiveWeight(key === 'idle' ? 1 : 0);
      actions[key] = action;
      weights[key] = key === 'idle' ? 1 : 0;
    }

    mixerRef.current = mixer;
    nativeActionsRef.current = actions;
    nativeWeightsRef.current = weights;

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(cloned);
      mixerRef.current = null;
      nativeActionsRef.current = {};
      nativeWeightsRef.current = {};
    };
  }, [cloned, gltf.animations]);

  // Cache and apply rest-pose correction + bone lookup once per instance.
  useEffect(() => {
    if (!cloned) return;

    // 1. Find root bone and stash bone references.
    let root = null;
    cloned.traverse((obj) => {
      if (obj.isBone && !root) {
        root = obj;
      }
    });
    if (!root) {
      cloned.traverse((obj) => {
        if (!root && (obj.isObject3D || obj.isBone)) {
          if (obj.parent && obj.parent.isBone) {
            root = obj;
          }
        }
      });
    }
    rootBoneRef.current = root;

    // 2. Build a name -> bone map for fast lookup.
    const map = {};
    cloned.traverse((obj) => {
      if (obj.isBone || obj.name) {
        map[obj.name] = obj;
      }
    });
    bonesRef.current = map;

    // 3. Rest-pose correction. Done once so the rest pose is stable.
    //
    // Critical: do NOT rotate the Hips 180° around Y -- that flips the
    // character's "front" to face away from the camera. The Xbot ships
    // already facing -Z, which is the correct "into the screen"
    // direction for a side-view fighter. The horizontal-flip on the
    // outer modelGroupRef handles left/right facing.
    //
    // Also critical: do NOT touch the Hips.position.y in rest. The GLB
    // uses a 0.01 internal scale (cm -> m) and the Hips local-Y in
    // model units is 103.99; overriding it to 1.0 would place the hips
    // at world Y=0.01 and shove the legs (children with negative local
    // Y) below the floor.
    //
    // The only corrections we apply: tilt the arms forward from the
    // horizontal T-pose into a natural "ready" hang. The Z rotation
    // here is small and positive; the pose's idle `armL=[0.5, 0, 0.4]`
    // then stacks on top to bring the hands up into a guard.
    if (rig.restCorrection) {
      cloned.traverse((obj) => {
        const corr = rig.restCorrection[obj.name];
        if (corr && obj.isBone) {
          obj.rotation.set(corr.rotation[0], corr.rotation[1], corr.rotation[2]);
          obj.updateMatrix();
          obj.matrixAutoUpdate = true;
        }
      });
    }

    // 4. Per-fighter bone scales.
    const figId = character?.fighterId || (character?.id === 'champion' ? 'brute' : character?.id) || 'ronin';
    applyBoneScales(root, figId);

    // 5. PBR materials. The GLB ships with MeshStandardMaterial, which is what
    //    we want now that the arenas provide image-based lighting (IBL) via
    //    drei <Environment>. The earlier downgrade to MeshLambertMaterial was a
    //    workaround for the absence of IBL — with IBL present the PBR materials
    //    render correctly with real reflections, roughness and indirect fill.
    //
    //    We rebuild each material from the GLB's original textures (albedo map,
    //    normal/roughness/metal maps if present) and apply a per-character
    //    accent tint as a subtle emissive so each fighter still reads as Ronin
    //    (red), Monk (green), etc. without flattening to one flat color.
    const accentThree = character && character.accentColor
      ? new THREE.Color(character.accentColor)
      : new THREE.Color(0x444444);
    cloned.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const newMats = mats.map((m) => {
        if (!m) return m;
        const std = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: m.map || null,
          normalMap: m.normalMap || null,
          roughnessMap: m.roughnessMap || null,
          metalnessMap: m.metalnessMap || null,
          // Sensible PBR defaults if the GLB doesn't carry roughness/metal.
          roughness: 0.62,
          metalness: 0.08,
          // Faint accent emissive so each fighter reads in low light; the IBL
          // does the heavy lifting, this is just a tonal hint.
          emissive: accentThree,
          emissiveIntensity: 0.08,
          envMapIntensity: 1.0,
        });
        // Preserve any alpha/transparency from the original material (hair,
        // scarves, etc.).
        if (m.transparent || (m.alphaMap !== undefined && m.alphaMap)) {
          std.transparent = true;
          std.alphaTest = m.alphaTest || 0;
          std.alphaMap = m.alphaMap || null;
        }
        return std;
      });
      obj.material = newMats.length === 1 ? newMats[0] : newMats;
    });

    // 6. For the opponent (evil mech), override with a darker / redder
    //    material set and add horns + a glowing eye light. We do this
    //    last so the per-character tints above are the baseline.
    if (!isPlayer) {
      applyEvilLook(cloned);
    }
  }, [cloned, character, isPlayer, rig]);

  // Position update + native/procedural pose application.
  useFrame((_state, dt) => {
    try {
      const s = stateRef.current;
      if (!s) return;
      if (!groupRef.current || !modelGroupRef.current) return;
      const frameDt = Math.min(dt || 0.016, 0.05);

      // 1. Position (top-level group).
      const px = s.position?.[0] || 0;
      const py = s.position?.[1] || 0;
      const pz = s.position?.[2] || 0;
      groupRef.current.position.set(px, py, pz);

      const prevPos = prevPositionRef.current;
      const measuredVx = frameDt > 0 ? (px - prevPos.x) / frameDt : 0;
      const measuredVz = frameDt > 0 ? (pz - prevPos.z) / frameDt : 0;
      const vx = Number.isFinite(s.velX) ? s.velX : measuredVx;
      const vz = Number.isFinite(s.velZ) ? s.velZ : measuredVz;
      const speed = Math.sqrt(vx * vx + vz * vz);
      prevPos.set(px, py, pz);

      // 2. Facing (horizontal flip on the model group). Damped to avoid
      //    popping on knockback-flip events.
      const dir = s.facing > 0 ? 1 : -1;
      const bodyScale = (character && character.bodyScale) || 1.0;
      const squashTarget = clamp(speed * 0.012 + (s.isHit ? 0.08 : 0), 0, 0.14);
      squashRef.current = damp(squashRef.current, squashTarget, 12, frameDt);
      modelGroupRef.current.scale.x = damp(
        modelGroupRef.current.scale.x,
        dir * bodyScale * (1 + squashRef.current * 0.1),
        14,
        frameDt
      );
      modelGroupRef.current.scale.y = damp(
        modelGroupRef.current.scale.y,
        bodyScale * (1 - squashRef.current * 0.08),
        9,
        frameDt
      );
      modelGroupRef.current.scale.z = damp(
        modelGroupRef.current.scale.z,
        bodyScale * (1 + squashRef.current * 0.06),
        9,
        frameDt
      );

      // 3. Native GLB locomotion clips. We keep the imported idle/walk
      //    animation alive for natural micro-motion, then layer combat poses
      //    over the mapped bones below.
      const anim = s.anim || 'idle';
      const progress = s.animProgress || 0;
      const actions = nativeActionsRef.current;
      const nativeWeights = nativeWeightsRef.current;
      const nativeTarget = anim === 'walk' && actions.walk ? 'walk' : 'idle';
      const nativeBlend = LOCOMOTION_ANIMS.has(anim) ? 1 : 0.12;
      for (const [key, action] of Object.entries(actions)) {
        const targetWeight = key === nativeTarget ? nativeBlend : 0;
        const nextWeight = damp(nativeWeights[key] ?? 0, targetWeight, 9, frameDt);
        nativeWeights[key] = nextWeight;
        action.enabled = nextWeight > 0.001;
        action.setEffectiveWeight(nextWeight);
        if (key === 'walk') action.timeScale = clamp(0.75 + speed * 0.16, 0.75, 1.65);
        if (key === 'idle') action.timeScale = clamp(0.88 + (physics.mass - 1) * 0.1, 0.82, 1.08);
      }
      if (mixerRef.current) mixerRef.current.update(frameDt);

      // 4. Velocity and impact physics. These are visual only; combat
      //    positions still come from Game.jsx.
      const forwardVel = vx * (s.facing || 1);
      const targetLean = clamp(-forwardVel * 0.045 * physics.lean, -0.28, 0.24);
      const targetSway = clamp(-vz * 0.04, -0.18, 0.18);
      const targetTwist = clamp(forwardVel * 0.025 + strikeImpulse(anim, progress) * 0.16, -0.28, 0.32);
      leanRef.current = damp(leanRef.current, targetLean, physics.response, frameDt);
      swayRef.current = damp(swayRef.current, targetSway, physics.response * 0.8, frameDt);
      twistRef.current = damp(twistRef.current, targetTwist, physics.response * 0.75, frameDt);

      if (s.attackerPushbackTilt > 0) {
        s.attackerPushbackTilt = Math.max(0, s.attackerPushbackTilt - 0.2 * frameDt / 0.15);
      }
      if (s.knockbackTilt > 0) {
        s.knockbackTilt = Math.max(0, s.knockbackTilt - 0.25 * frameDt / 0.15);
      }

      const impactTilt = (s.attackerPushbackTilt || 0) - (s.knockbackTilt || 0);
      modelGroupRef.current.rotation.x = damp(
        modelGroupRef.current.rotation.x,
        impactTilt * 0.3 + leanRef.current * 0.22,
        12,
        frameDt
      );
      modelGroupRef.current.rotation.z = damp(
        modelGroupRef.current.rotation.z,
        swayRef.current * 0.18,
        10,
        frameDt
      );

      // 5. Hit flash: spike the accent emissive briefly on impact. With PBR
      //    the base emissive is a faint tint (0.08) and the IBL lights the
      //    body normally; on a hit we punch it up so the struck area flares.
      const hitFlash = s.isHit ? 1.6 : 0.08;
      cloned.traverse((obj) => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m || !m.emissive) return;
          m.emissiveIntensity = damp(m.emissiveIntensity ?? 0.08, hitFlash, 18, frameDt);
        });
      });

      // 6. Sample pose from animationClips and apply to bones.
      const time = performance.now() / 1000;

      const sample = sampleClip(anim, progress);
      const base = idlePose(time);
      const pose = {};
      for (const key of Object.keys(base)) {
        if (key === 'hipY') {
          pose[key] = base[key] + (sample.pose[key] || 0);
        } else {
          pose[key] = addDelta(base[key], sample.pose[key]);
        }
      }
      // Mirror for the opposite facing.
      const finalPose = dir > 0 ? pose : mirrorPose(pose);
      const physicalPose = enrichPoseWithPhysics(finalPose, {
        lean: leanRef.current,
        sway: swayRef.current,
        twist: twistRef.current,
        impactTilt,
        strike: strikeImpulse(anim, progress) * physics.followThrough,
        idleWeight: anim === 'idle' ? 1 : 0,
        time,
        facing: dir,
        speed,
      });

      applyPoseToBones(
        physicalPose,
        rig.boneMap,
        bonesRef.current,
        rootBoneRef.current,
        frameDt,
        proceduralWeightFor(anim)
      );

      // 6b. Visual root offsets: attack lunges, collapses, and breathing are
      //     applied to the model group, not the authoritative combat state.
      const rootOffset = sample.rootOffset || [0, 0, 0];
      const visualX = (dir > 0 ? rootOffset[0] : -rootOffset[0]) * 0.62;
      const visualY = bodyYOffset(anim, physicalPose.hipY) + (rootOffset[1] || 0) * 0.35;
      const visualZ = (rootOffset[2] || 0) * 0.62;
      modelGroupRef.current.position.x = damp(modelGroupRef.current.position.x, visualX, 13, frameDt);
      modelGroupRef.current.position.y = damp(modelGroupRef.current.position.y, visualY, 10, frameDt);
      modelGroupRef.current.position.z = damp(modelGroupRef.current.position.z, visualZ, 13, frameDt);

      // 7. Footstep / landing events for ground VFX.
      if (anim === 'walk') {
        const stride = Math.sin((progress || 0) * Math.PI * 2);
        const prevStride = prevStrideRef.current;
        if (prevStride > 0 && stride <= 0) {
          onFootstep?.([px - physics.footWidth * dir, 0.05, pz], { intensity: 1.0, type: 'walk' });
        } else if (prevStride < 0 && stride >= 0) {
          onFootstep?.([px + physics.footWidth * dir, 0.05, pz], { intensity: 1.0, type: 'walk' });
        }
        prevStrideRef.current = stride;
      } else {
        prevStrideRef.current = 0;
      }

      if (
        anim === 'backstep' &&
        s.stateTimer > 0 &&
        s.stateTimer < BACKSTEP_TOTAL - BACKSTEP_IFRAME_DURATION
      ) {
        backstepDustTimerRef.current += frameDt;
        if (backstepDustTimerRef.current >= 0.06) {
          backstepDustTimerRef.current = 0;
          onFootstep?.([px, 0.05, pz], { intensity: 0.6, type: 'slide' });
        }
      } else {
        backstepDustTimerRef.current = 0;
      }

      if (
        anim === 'backstep' &&
        prevBackstepStateTimerRef.current >= BACKSTEP_RECOVERY_START &&
        (s.stateTimer || 0) < BACKSTEP_RECOVERY_START &&
        onBackstepLanding
      ) {
        onBackstepLanding([px, 0.05, pz]);
      }
      prevBackstepStateTimerRef.current = s.stateTimer || 0;

      if (GROUNDED_REACTIONS.has(anim)) {
        const prevProgress = prevAnimProgressRef.current;
        if (prevProgress < 0.65 && progress >= 0.65) {
          onFootstep?.([px, 0.05, pz], { intensity: 1.4, type: 'landing' });
        }
        prevAnimProgressRef.current = progress;
      } else {
        prevAnimProgressRef.current = 0;
      }

      lastProgressRef.current = progress;

      // 8. Register position for particle repelling.
      registerFighterPosition(isPlayer ? 0 : 1, px, py, pz);
    } catch (err) {
      // Surface any GLB / skeleton / pose runtime errors to the
      // console so a "blank" canvas isn't a silent failure.
      if (import.meta.env.DEV) {
        console.error(`[GLBFighter ${isPlayer ? 'player' : 'opponent'}] useFrame error:`, err);
      }
    }
  });

  return (
    <group ref={groupRef}>
      <group ref={modelGroupRef}>
        <primitive object={cloned} />
        {/* The per-fighter attached lights that used to live here have been
            removed: the arenas now provide image-based lighting (drei
            <Environment>) plus boosted key/rim lights, which is enough for the
            PBR materials to read correctly from every angle without flattening
            the shading with a follow-spot. */}
      </group>
    </group>
  );
}

/**
 * Apply the final pose (already mirrored for facing) to the named bones.
 * Uses damped lerp so combat animations interpolate smoothly even when
 * the active frames are short.
 */
function applyPoseToBones(pose, boneMap, bones, _rootBone, dt, weight = 1) {
  for (const [key, entry] of Object.entries(boneMap)) {
    const bone = bones[entry.bone];
    if (!bone) continue;
    const val = pose[key];
    if (entry.type === 'positionY') {
      const targetY = val;
      const blendedY = bone.position.y + (targetY - bone.position.y) * weight;
      bone.position.y = damp(bone.position.y, blendedY, 10, dt);
    } else if (entry.type === 'rotation') {
      if (!Array.isArray(val)) continue;
      const tx = val[0] || 0;
      const ty = val[1] || 0;
      const tz = val[2] || 0;
      const bx = bone.rotation.x + (tx - bone.rotation.x) * weight;
      const by = bone.rotation.y + (ty - bone.rotation.y) * weight;
      const bz = bone.rotation.z + (tz - bone.rotation.z) * weight;
      bone.rotation.x = damp(bone.rotation.x, bx, 18, dt);
      bone.rotation.y = damp(bone.rotation.y, by, 18, dt);
      bone.rotation.z = damp(bone.rotation.z, bz, 18, dt);
    }
  }
}

/**
 * Apply the "evil opponent" look:
 *   - Replace all materials with a dark-red, high-emissive variant
 *     (sharp specular, glowing cracks) -- the existing RobotExpressive
 *     mech body is recolored, not reshaded from scratch.
 *   - Add two small horn meshes parented to the head bone.
 *   - Add a small red point light at the head.
 */
function applyEvilLook(scene) {
  // 1. Recolor.
  const bodyColor = new THREE.Color(0x140509);
  const accentColor = new THREE.Color(0xc4001a);
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const newMats = mats.map((m) => {
      if (!m) return m;
      const replacement = new THREE.MeshStandardMaterial({
        color: bodyColor,
        emissive: accentColor,
        emissiveIntensity: 0.35,
        roughness: 0.35,
        metalness: 0.55,
        flatShading: false,
      });
      if (m.map) replacement.map = m.map;
      if (m.normalMap) replacement.normalMap = m.normalMap;
      return replacement;
    });
    obj.material = newMats.length === 1 ? newMats[0] : newMats;
    // Cast shadows if a light is configured.
    obj.castShadow = true;
  });

  // 2. Horns -- two cones parented to whatever head bone we can find.
  const headBone =
    scene.getObjectByName('Bone_Head') ||
    scene.getObjectByName('mixamorigHead') ||
    scene.getObjectByName('Head') ||
    null;

  const hornGeom = new THREE.ConeGeometry(0.05, 0.18, 6);
  const hornMat = new THREE.MeshStandardMaterial({
    color: 0x0a0204,
    emissive: 0x8a0010,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    metalness: 0.7,
  });
  const leftHorn = new THREE.Mesh(hornGeom, hornMat);
  leftHorn.position.set(-0.08, 0.12, 0.0);
  leftHorn.rotation.z = 0.3;
  const rightHorn = new THREE.Mesh(hornGeom, hornMat);
  rightHorn.position.set(0.08, 0.12, 0.0);
  rightHorn.rotation.z = -0.3;

  if (headBone) {
    headBone.add(leftHorn);
    headBone.add(rightHorn);
  } else {
    // Fallback: parent to the scene root at approximate head height.
    const fallback = new THREE.Object3D();
    fallback.position.set(0, 1.6, 0);
    fallback.add(leftHorn);
    fallback.add(rightHorn);
    scene.add(fallback);
  }

  // 3. Red point light at the head -- a halo of menace.
  const headLight = new THREE.PointLight(0xff2540, 0.7, 2.5, 2.0);
  headLight.position.set(0, 0.05, 0.05);
  if (headBone) {
    headBone.add(headLight);
  } else {
    const fallback = new THREE.Object3D();
    fallback.position.set(0, 1.6, 0);
    fallback.add(headLight);
    scene.add(fallback);
  }
}

// Preload the rig URLs so the first combat frame is instant.
useGLTF.preload('/models/characters/xbot.glb');
useGLTF.preload('/models/characters/robot_expressive.glb');
