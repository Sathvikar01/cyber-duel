/**
 * FloorFog
 *
 * A small Points system of soft additive sprites that drift near the floor,
 * giving the impression of low-lying mist catching the key light. Tuned to be
 * subtle and atmospheric rather than distracting.
 *
 * Particles use a cached soft-circle sprite and additive blending, so they
 * pick up the beam / key light color naturally. Each particle has its own
 * phase and orbits slowly within a flat volume around the arena origin.
 *
 * Props:
 *  - count:   number of particles (default 40)
 *  - color:   tint for the sprites (default #cbd5e0)
 *  - size:    sprite size (default 1.2)
 *  - opacity: 0..1 base opacity (default 0.18)
 *  - spread:  [x, y, z]  flat-ish volume of motion (default [40, 0.5, 25])
 *  - origin:  [x, y, z]  center of the volume (default [0, 0.2, -4])
 */
import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getSoftCircle } from './spriteTexture';

export default function FloorFog({
  count = 40,
  color = '#cbd5e0',
  size = 1.2,
  opacity = 0.18,
  spread = [40, 0.5, 25],
  origin = [0, 0.2, -4],
}) {
  const pointsRef = useRef();
  const texture = useMemo(() => getSoftCircle(), []);

  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const phases = useMemo(() => new Float32Array(count), [count]);
  const yOffsets = useMemo(() => new Float32Array(count), [count]);

  useEffect(() => {
    const [sx, , sz] = spread;
    const [ox, , oz] = origin;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * sx;
      positions[i * 3 + 1] = origin[1];
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * sz;
      phases[i] = Math.random() * Math.PI * 2;
      yOffsets[i] = Math.random() * 0.5;
    }
    if (pointsRef.current) {
      pointsRef.current.geometry.attributes.position.needsUpdate = true;
    }
  }, [count, spread, origin, positions, phases, yOffsets]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const t = state.clock.elapsedTime;
    const [sx, , sz] = spread;
    const [ox, oy, oz] = origin;

    for (let i = 0; i < count; i++) {
      const p = phases[i];
      const x = ox + Math.sin(t * 0.18 + p) * (sx * 0.42)
                     + Math.sin(t * 0.55 + p * 2.1) * 1.2;
      const z = oz + Math.cos(t * 0.16 + p * 0.7) * (sz * 0.42)
                     + Math.cos(t * 0.48 + p * 1.3) * 1.0;
      const y = oy + Math.sin(t * 0.4 + p * 1.4) * 0.12 + yOffsets[i] * 0.25;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={size}
        color={color}
        map={texture}
        alphaMap={texture}
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
