import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { sampleClip } from './animationClips.js';
import { idlePose, applyPose, addDelta, mirrorPose } from './poseMath.js';

const HEAVY_MOVES = new Set(['uppercut', 'roundhouse', 'throw']);

export function useFighterAnimator(stateRef, refs) {
  const rootPos = useRef(new THREE.Vector3());
  const lastPos = useRef(new THREE.Vector3());
  const trailActive = useRef(false);

  const {
    groupRef,
    hipRef,
    torsoRef,
    headRef,
    armLRef,
    foreLRef,
    armRRef,
    foreRRef,
    legLRef,
    calfLRef,
    legRRef,
    calfRRef,
  } = refs;

  useFrame((state) => {
    const s = stateRef.current;
    if (!s) return;

    const time = state.clock.elapsedTime;
    const anim = s.anim || 'idle';
    const progress = s.animProgress || 0;
    const facing = s.facing || 1;

    const sample = sampleClip(anim, progress);
    const base = idlePose(time);

    // Add clip deltas on top of idle pose
    const pose = {};
    for (const key of Object.keys(base)) {
      if (key === 'hipY') {
        pose[key] = base[key] + (sample.pose[key] || 0);
      } else {
        pose[key] = addDelta(base[key], sample.pose[key]);
      }
    }

    // Mirror for fighters facing the opposite direction
    const finalPose = facing > 0 ? pose : mirrorPose(pose);

    // Mirror root offset for opposite facing
    const ro = sample.rootOffset;
    const rootOffset = facing > 0 ? ro : [-ro[0], ro[1], ro[2]];

    // Apply group position + root offset
    if (groupRef && groupRef.current) {
      rootPos.current.set(
        (s.position[0] || 0) + rootOffset[0],
        (s.position[1] || 0) + rootOffset[1],
        (s.position[2] || 0) + rootOffset[2]
      );
      groupRef.current.position.lerp(rootPos.current, 0.5);

      const targetRotY = facing > 0 ? -Math.PI / 2 : Math.PI / 2;
      groupRef.current.rotation.y += (targetRotY - groupRef.current.rotation.y) * 0.15;
    }

    // Apply hip height
    if (hipRef && hipRef.current) {
      hipRef.current.position.y = finalPose.hipY;
    }

    // Apply rotations
    applyPose(torsoRef, finalPose.torso);
    applyPose(headRef, finalPose.head);
    applyPose(armLRef, finalPose.armL);
    applyPose(foreLRef, finalPose.foreL);
    applyPose(armRRef, finalPose.armR);
    applyPose(foreRRef, finalPose.foreR);
    applyPose(legLRef, finalPose.legL);
    applyPose(calfLRef, finalPose.calfL);
    applyPose(legRRef, finalPose.legR);
    applyPose(calfRRef, finalPose.calfR);

    // Trail active during the strike window of heavy moves
    const inStrikeWindow = progress >= 0.15 && progress <= 0.45;
    trailActive.current = HEAVY_MOVES.has(anim) && inStrikeWindow;

    lastPos.current.copy(rootPos.current);
  });

  return trailActive;
}
