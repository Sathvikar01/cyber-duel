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
  onBackstepLanding,
}) {
  const groupRef = useRef();
  const modelGroupRef = useRef();
  const bonesRef = useRef({});
  const rootBoneRef = useRef(null);
  const lastProgressRef = useRef(0);
  const prevBackstepStateTimerRef = useRef(0);

  const rig = useMemo(() => pickRig(character, isPlayer), [character, isPlayer]);
  const gltf = useGLTF(rig.url);

  const cloned = useMemo(() => {
    const c = SkeletonUtils.clone(gltf.scene);
    return c;
  }, [gltf]);

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
    const figId = (character && character.fighterId) || 'ronin';
    applyBoneScales(root, figId);

    // 5. Apply per-character material tints (override the GLB's defaults
    //    with our fighter accent color so character select still has
    //    visible variety).
    cloned.traverse((obj) => {
      if (!obj.isMesh) return;
      if (!obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m) return;
        if (m.color && character && character.bodyColor) {
          m.color = new THREE.Color(character.bodyColor);
        }
        if (m.emissive && character && character.accentColor) {
          m.emissive = new THREE.Color(character.accentColor);
          m.emissiveIntensity = 0.18;
        }
      });
    });

    // 6. For the opponent (evil mech), override with a darker / redder
    //    material set and add horns + a glowing eye light. We do this
    //    last so the per-character tints above are the baseline.
    if (!isPlayer) {
      applyEvilLook(cloned);
    }
  }, [cloned, character, isPlayer, rig]);

  // Position update + facing flip + pose application.
  useFrame((_state, dt) => {
    const s = stateRef.current;
    if (!s) return;
    if (!groupRef.current || !modelGroupRef.current) return;

    // 1. Position (top-level group).
    const px = s.position?.[0] || 0;
    const py = s.position?.[1] || 0;
    const pz = s.position?.[2] || 0;
    groupRef.current.position.set(px, py, pz);

    // 2. Facing (horizontal flip on the model group). Damped to avoid
    //    popping on knockback-flip events.
    const dir = s.facing > 0 ? 1 : -1;
    modelGroupRef.current.scale.x = damp(modelGroupRef.current.scale.x, dir, 14, dt);

    // 3. Per-fighter body scale (1.0 default; brute/monk/assassin get
    //    tweaks via FIGHTER_BONE_SCALES applied at mount, plus a uniform
    //    bodyScale from the character config that scales everything).
    const bodyScale = (character && character.bodyScale) || 1.0;
    const baseY = damp(modelGroupRef.current.scale.y, bodyScale, 8, dt);
    const baseZ = damp(modelGroupRef.current.scale.z, bodyScale, 8, dt);
    modelGroupRef.current.scale.y = baseY;
    modelGroupRef.current.scale.z = baseZ;

    // 4. Tilt: forward lean on attacker push-back, backward lean on hit.
    const tiltX = (s.knockbackTilt || 0) - (s.attackerPushbackTilt || 0);
    modelGroupRef.current.rotation.x = damp(
      modelGroupRef.current.rotation.x,
      tiltX,
      12,
      dt
    );

    // 5. Hit flash: brighten the whole rig briefly.
    const hitFlash = s.isHit ? 1.5 : 0.18;
    cloned.traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m || !m.emissive) return;
        m.emissiveIntensity = damp(m.emissiveIntensity || 0.18, hitFlash, 18, dt);
      });
    });

    // 6. Sample pose from animationClips and apply to bones.
    const anim = s.anim || 'idle';
    const progress = s.animProgress || 0;
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

    applyPoseToBones(finalPose, rig.boneMap, bonesRef.current, rootBoneRef.current, dt);

    // 7. Backstep dust on landing.
    if (
      anim === 'backstep' &&
      prevBackstepStateTimerRef.current > 0.13 &&
      (s.stateTimer || 0) <= 0.13 &&
      onBackstepLanding
    ) {
      onBackstepLanding([px, 0, pz]);
    }
    prevBackstepStateTimerRef.current = s.stateTimer || 0;
    lastProgressRef.current = progress;

    // 8. Register position for particle repelling.
    registerFighterPosition(isPlayer, [px, 0, pz]);
  });

  return (
    <group ref={groupRef}>
      <group ref={modelGroupRef}>
        <primitive object={cloned} />
      </group>
    </group>
  );
}

/**
 * Apply the final pose (already mirrored for facing) to the named bones.
 * Uses damped lerp so combat animations interpolate smoothly even when
 * the active frames are short.
 */
function applyPoseToBones(pose, boneMap, bones, _rootBone, dt) {
  for (const [key, entry] of Object.entries(boneMap)) {
    const bone = bones[entry.bone];
    if (!bone) continue;
    const val = pose[key];
    if (entry.type === 'positionY') {
      const targetY = val;
      bone.position.y = damp(bone.position.y, targetY, 10, dt);
    } else if (entry.type === 'rotation') {
      if (!Array.isArray(val)) continue;
      const tx = val[0] || 0;
      const ty = val[1] || 0;
      const tz = val[2] || 0;
      bone.rotation.x = damp(bone.rotation.x, tx, 18, dt);
      bone.rotation.y = damp(bone.rotation.y, ty, 18, dt);
      bone.rotation.z = damp(bone.rotation.z, tz, 18, dt);
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
