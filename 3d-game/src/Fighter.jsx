import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

function lerp(a, b, t) { return a + (b - a) * t; }

function attackCurve(t) {
  if (t < 0.15) return -(t / 0.15) * 0.3;
  if (t < 0.35) return -0.3 + ((t - 0.15) / 0.2) * 1.3;
  return Math.max(0, 1.0 - ((t - 0.35) / 0.65));
}

function getPose(anim, progress, time) {
  const e = attackCurve(progress);

  const idle = {
    hipY: 1.0 + Math.sin(time * 3) * 0.02,
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
  };

  switch (anim) {
    case 'idle':
      return idle;

    case 'walk': {
      const c = Math.sin(time * 10);
      return {
        hipY: 1.0 + Math.abs(Math.cos(time * 10)) * 0.04,
        torso: [0, 0, Math.sin(time * 5) * 0.04],
        head: [0, 0, 0],
        armL: [0.5 - c * 0.3, 0, 0.4],
        foreL: [-1.2, 0, 0],
        armR: [0.5 + c * 0.3, 0, -0.4],
        foreR: [-1.2, 0, 0],
        legL: [-0.15 + c * 0.5, 0, 0.08],
        calfL: [Math.max(0, c * 0.5), 0, 0],
        legR: [0.15 - c * 0.5, 0, -0.08],
        calfR: [Math.max(0, -c * 0.5), 0, 0],
      };
    }

    case 'jab':
      return {
        ...idle,
        hipY: 1.0,
        torso: [0, -0.35 * e, 0],
        armL: [lerp(0.5, -1.5, e), 0, lerp(0.4, 0.05, e)],
        foreL: [lerp(-1.2, -0.1, e), 0, 0],
        legL: [-0.15 - 0.15 * e, 0, 0.08],
      };

    case 'cross':
      return {
        ...idle,
        hipY: 1.0,
        torso: [0, -0.9 * e, 0.1 * e],
        armR: [lerp(0.5, -1.6, e), 0, lerp(-0.4, -0.05, e)],
        foreR: [lerp(-1.2, -0.1, e), 0, 0],
        legR: [0.15 + 0.1 * e, 0, -0.08],
      };

    case 'low_kick':
      return {
        ...idle,
        hipY: 1.0,
        torso: [-0.25 * e, -0.2 * e, 0],
        legR: [lerp(0.15, -1.4, e), 0, lerp(-0.08, 0.4, e)],
        calfR: [lerp(0.1, 0.3, e), 0, 0],
      };

    case 'roundhouse':
      return {
        ...idle,
        hipY: 1.0 + 0.25 * e,
        torso: [-0.3 * e, -1.8 * e, 0],
        legL: [lerp(-0.15, -1.4, e), lerp(0, -0.6, e), lerp(0.08, -1.2, e)],
        calfL: [lerp(0.15, 0, e), 0, 0],
        armL: [lerp(0.5, 0.8, e), 0, lerp(0.4, 0.8, e)],
        armR: [lerp(0.5, 0.8, e), 0, lerp(-0.4, -0.8, e)],
      };

    case 'uppercut':
      return {
        ...idle,
        hipY: 1.0 + 0.35 * e,
        torso: [lerp(0, -0.25, e), 0, 0],
        armR: [lerp(0.5, -2.6, e), 0, lerp(-0.4, 0, e)],
        foreR: [lerp(-1.2, -0.6, e), 0, 0],
        legL: [lerp(-0.15, -0.5, e), 0, 0.08],
        calfL: [lerp(0.15, 0.5, e), 0, 0],
        legR: [lerp(0.15, -0.4, e), 0, -0.08],
        calfR: [lerp(0.1, 0.4, e), 0, 0],
      };

    case 'hit':
      return {
        ...idle,
        hipY: 0.95,
        torso: [0.3, 0, -0.15],
        head: [0.4, 0, 0.2],
        armL: [0.8, 0, 0.7],
        foreL: [-0.5, 0, 0],
        armR: [0.8, 0, -0.7],
        foreR: [-0.5, 0, 0],
      };

    case 'block':
      return {
        ...idle,
        hipY: 0.95,
        torso: [0.1, 0, 0],
        armL: [-0.3, 0, 0.8],
        foreL: [-1.8, 0, 0],
        armR: [-0.3, 0, -0.8],
        foreR: [-1.8, 0, 0],
      };

    default:
      return idle;
  }
}

export default function Fighter({ stateRef, bodyColor, glowColor }) {
  const groupRef = useRef();
  const hipRef = useRef();
  const torsoRef = useRef();
  const headRef = useRef();
  const armLRef = useRef();
  const foreLRef = useRef();
  const armRRef = useRef();
  const foreRRef = useRef();
  const legLRef = useRef();
  const calfLRef = useRef();
  const legRRef = useRef();
  const calfRRef = useRef();

  const bodyMatRef = useRef(new THREE.MeshStandardMaterial({
    color: new THREE.Color(bodyColor),
    roughness: 0.25,
    metalness: 0.8,
    emissive: new THREE.Color(glowColor),
    emissiveIntensity: 0.35,
  }));

  const jointMatRef = useRef(new THREE.MeshStandardMaterial({
    color: new THREE.Color(glowColor),
    roughness: 0.1,
    metalness: 0.9,
    emissive: new THREE.Color(glowColor),
    emissiveIntensity: 0.8,
  }));

  const visorMatRef = useRef(new THREE.MeshBasicMaterial({
    color: new THREE.Color(glowColor),
    transparent: true,
    opacity: 0.9,
  }));

  useFrame((state) => {
    if (!groupRef.current) return;
    const s = stateRef.current;
    const time = state.clock.elapsedTime;

    groupRef.current.position.set(s.position[0], s.position[1] || 0, s.position[2] || 0);

    const targetRotY = s.facing > 0 ? -Math.PI / 2 : Math.PI / 2;
    groupRef.current.rotation.y += (targetRotY - groupRef.current.rotation.y) * 0.15;

    const pose = getPose(s.anim, s.animProgress || 0, time);

    if (hipRef.current) hipRef.current.position.y = pose.hipY;

    const applyRot = (ref, rot) => {
      if (ref.current) {
        ref.current.rotation.x = rot[0];
        ref.current.rotation.y = rot[1];
        ref.current.rotation.z = rot[2];
      }
    };

    applyRot(torsoRef, pose.torso);
    applyRot(headRef, pose.head);
    applyRot(armLRef, pose.armL);
    applyRot(foreLRef, pose.foreL);
    applyRot(armRRef, pose.armR);
    applyRot(foreRRef, pose.foreR);
    applyRot(legLRef, pose.legL);
    applyRot(calfLRef, pose.calfL);
    applyRot(legRRef, pose.legR);
    applyRot(calfRRef, pose.calfR);

    const mat = bodyMatRef.current;
    if (s.isHit) {
      mat.emissive.setHex(0xffffff);
      mat.emissiveIntensity = 2.0;
    } else {
      mat.emissive.set(glowColor);
      mat.emissiveIntensity = 0.35;
    }
  });

  const bm = bodyMatRef.current;
  const jm = jointMatRef.current;
  const vm = visorMatRef.current;

  return (
    <group ref={groupRef}>
      <group ref={hipRef} position={[0, 1.0, 0]}>
        <group ref={torsoRef}>
          <mesh material={bm} castShadow position={[0, 0, 0]}>
            <boxGeometry args={[0.5, 0.7, 0.25]} />
          </mesh>

          <group position={[0, 0.55, 0]} ref={headRef}>
            <mesh material={bm} castShadow position={[0, 0.18, 0]}>
              <sphereGeometry args={[0.2, 16, 16]} />
            </mesh>
            <mesh material={vm} position={[0, 0.18, 0.15]}>
              <boxGeometry args={[0.3, 0.08, 0.12]} />
            </mesh>
          </group>

          <group position={[-0.35, 0.28, 0]}>
            <group ref={armLRef}>
              <mesh material={bm} castShadow position={[0, -0.2, 0]}>
                <capsuleGeometry args={[0.07, 0.3, 4, 8]} />
              </mesh>
              <mesh material={jm} position={[0, 0, 0]}>
                <sphereGeometry args={[0.06, 8, 8]} />
              </mesh>
              <group position={[0, -0.42, 0]} ref={foreLRef}>
                <mesh material={bm} castShadow position={[0, -0.18, 0]}>
                  <capsuleGeometry args={[0.06, 0.28, 4, 8]} />
                </mesh>
                <mesh material={jm} position={[0, 0, 0]}>
                  <sphereGeometry args={[0.05, 8, 8]} />
                </mesh>
                <mesh material={bm} position={[0, -0.38, 0]}>
                  <sphereGeometry args={[0.07, 8, 8]} />
                </mesh>
              </group>
            </group>
          </group>

          <group position={[0.35, 0.28, 0]}>
            <group ref={armRRef}>
              <mesh material={bm} castShadow position={[0, -0.2, 0]}>
                <capsuleGeometry args={[0.07, 0.3, 4, 8]} />
              </mesh>
              <mesh material={jm} position={[0, 0, 0]}>
                <sphereGeometry args={[0.06, 8, 8]} />
              </mesh>
              <group position={[0, -0.42, 0]} ref={foreRRef}>
                <mesh material={bm} castShadow position={[0, -0.18, 0]}>
                  <capsuleGeometry args={[0.06, 0.28, 4, 8]} />
                </mesh>
                <mesh material={jm} position={[0, 0, 0]}>
                  <sphereGeometry args={[0.05, 8, 8]} />
                </mesh>
                <mesh material={bm} position={[0, -0.38, 0]}>
                  <sphereGeometry args={[0.07, 8, 8]} />
                </mesh>
              </group>
            </group>
          </group>
        </group>

        <group position={[-0.13, -0.05, 0]}>
          <group ref={legLRef}>
            <mesh material={bm} castShadow position={[0, -0.25, 0]}>
              <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
            </mesh>
            <mesh material={jm} position={[0, 0, 0]}>
              <sphereGeometry args={[0.07, 8, 8]} />
            </mesh>
            <group position={[0, -0.52, 0]} ref={calfLRef}>
              <mesh material={bm} castShadow position={[0, -0.24, 0]}>
                <capsuleGeometry args={[0.07, 0.38, 4, 8]} />
              </mesh>
              <mesh material={jm} position={[0, 0, 0]}>
                <sphereGeometry args={[0.06, 8, 8]} />
              </mesh>
              <mesh material={bm} position={[0, -0.48, 0.05]}>
                <boxGeometry args={[0.1, 0.06, 0.2]} />
              </mesh>
            </group>
          </group>
        </group>

        <group position={[0.13, -0.05, 0]}>
          <group ref={legRRef}>
            <mesh material={bm} castShadow position={[0, -0.25, 0]}>
              <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
            </mesh>
            <mesh material={jm} position={[0, 0, 0]}>
              <sphereGeometry args={[0.07, 8, 8]} />
            </mesh>
            <group position={[0, -0.52, 0]} ref={calfRRef}>
              <mesh material={bm} castShadow position={[0, -0.24, 0]}>
                <capsuleGeometry args={[0.07, 0.38, 4, 8]} />
              </mesh>
              <mesh material={jm} position={[0, 0, 0]}>
                <sphereGeometry args={[0.06, 8, 8]} />
              </mesh>
              <mesh material={bm} position={[0, -0.48, 0.05]}>
                <boxGeometry args={[0.1, 0.06, 0.2]} />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
