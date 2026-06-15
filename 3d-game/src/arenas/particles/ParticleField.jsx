import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Generic reusable particle system for all arenas.
 *
 * Props:
 * - count: number of particles (default 120)
 * - color: particle color (default #d4af37)
 * - size: particle size (default 0.08)
 * - opacity: base opacity (default 0.6)
 * - spread: [x, y, z] bounds of the emitter volume (default [30, 10, 20])
 * - origin: [x, y, z] center offset (default [0, 0, 0])
 * - speed: vertical / life speed (default 0.4)
 * - drift: horizontal drift amount (default 0.1)
 * - additive: use additive blending (default true)
 * - pulse: whether particles pulse in size (default false)
 */
export default function ParticleField({
  count = 120,
  color = '#d4af37',
  size = 0.08,
  opacity = 0.6,
  spread = [30, 10, 20],
  origin = [0, 0, 0],
  speed = 0.4,
  drift = 0.1,
  additive = true,
  pulse = false,
}) {
  const pointsRef = useRef();
  const materialRef = useRef();

  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const speeds = useMemo(() => new Float32Array(count), [count]);
  const drifts = useMemo(() => new Float32Array(count * 2), [count]);
  const phases = useMemo(() => new Float32Array(count), [count]);
  const initialY = useMemo(() => new Float32Array(count), [count]);

  useEffect(() => {
    const [sx, sy, sz] = spread;
    const [ox, oy, oz] = origin;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * sx;
      positions[i * 3 + 1] = oy + Math.random() * sy;
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * sz;
      initialY[i] = positions[i * 3 + 1];
      speeds[i] = 0.2 + Math.random() * 0.8;
      drifts[i * 2] = (Math.random() - 0.5) * drift;
      drifts[i * 2 + 1] = (Math.random() - 0.5) * drift;
      phases[i] = Math.random() * Math.PI * 2;
    }

    if (pointsRef.current) {
      pointsRef.current.geometry.attributes.position.needsUpdate = true;
    }
  }, [count, spread, origin, drift, positions, speeds, drifts, phases, initialY]);

  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    const pos = pointsRef.current.geometry.attributes.position.array;
    const time = state.clock.elapsedTime;
    const [sx, sy, sz] = spread;
    const [ox, oy, oz] = origin;

    for (let i = 0; i < count; i++) {
      // Vertical movement
      pos[i * 3 + 1] += speeds[i] * delta * speed;

      // Horizontal drift
      pos[i * 3] += drifts[i * 2] * Math.sin(time * 0.5 + phases[i]) * delta;
      pos[i * 3 + 2] += drifts[i * 2 + 1] * Math.cos(time * 0.4 + phases[i]) * delta;

      // Reset if out of vertical bounds
      if (pos[i * 3 + 1] > oy + sy) {
        pos[i * 3 + 1] = oy;
        pos[i * 3] = ox + (Math.random() - 0.5) * sx;
        pos[i * 3 + 2] = oz + (Math.random() - 0.5) * sz;
      }
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;

    if (materialRef.current && pulse) {
      materialRef.current.size = size * (1 + Math.sin(time * 2) * 0.15);
    }
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
        ref={materialRef}
        size={size}
        color={color}
        transparent
        opacity={opacity}
        sizeAttenuation
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
        depthWrite={false}
      />
    </points>
  );
}
