import { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useVfx } from './vfxContext.js';

export default function SplatterRenderer() {
  const { splattersRef } = useVfx();
  const groupRef = useRef();
  const { camera } = useThree();
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const dt = Math.min(delta, 0.05);
    const splats = splattersRef.current;

    for (let i = splats.length - 1; i >= 0; i--) {
      const s = splats[i];
      s.life -= dt;
      if (s.life <= 0) splats.splice(i, 1);
    }

    const children = groupRef.current.children;
    for (let i = 0; i < children.length; i++) {
      const mesh = children[i];
      const s = splats[i];
      if (s) {
        mesh.visible = true;
        mesh.position.set(s.x, s.y, s.z);
        mesh.lookAt(camera.position);
        tmpQuat.copy(mesh.quaternion);
        mesh.setRotationFromQuaternion(tmpQuat);
        const a = Math.max(0, s.life / s.maxLife);
        const scale = s.scale * (1 + (1 - a) * 0.8);
        mesh.scale.set(scale, scale, scale);
        tmpColor.setHex(s.color);
        mesh.material.color.copy(tmpColor);
        mesh.material.opacity = a * 0.9;
      } else {
        mesh.visible = false;
      }
    }
  });

  const meshes = useMemo(() => {
    return Array.from({ length: 8 }).map((_, i) => (
      <mesh key={i} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    ));
  }, []);

  return <group ref={groupRef}>{meshes}</group>;
}
