import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVfx } from './vfxContext.js';

export default function ShockwaveRenderer() {
  const { shockwavesRef } = useVfx();
  const groupRef = useRef();
  const tmpColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const dt = Math.min(delta, 0.05);
    const waves = shockwavesRef.current;

    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.radius += (w.maxRadius - w.radius) * 4 * dt;
      w.life -= dt * 2.5;
      if (w.life <= 0) waves.splice(i, 1);
    }

    const children = groupRef.current.children;
    for (let i = 0; i < children.length; i++) {
      const mesh = children[i];
      const wave = waves[i];
      if (wave) {
        mesh.visible = true;
        mesh.position.set(wave.x, wave.y, wave.z);
        const scale = wave.radius;
        mesh.scale.set(scale, scale, scale);
        tmpColor.setHex(wave.color);
        mesh.material.color.copy(tmpColor);
        mesh.material.opacity = Math.max(0, wave.life * 0.7);
      } else {
        mesh.visible = false;
      }
    }
  });

  const meshes = useMemo(() => {
    return Array.from({ length: 8 }).map((_, i) => (
      <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.85, 1.0, 64]} />
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
