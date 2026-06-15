import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGlow } from './spriteTexture';

/**
 * EmberField
 *
 * Upward-rising glowing embers. Each particle spawns somewhere inside the
 * bounds box, drifts gently in X / Z, and resets to the bottom when it
 * reaches the top. Uses additive blending and a soft glow sprite.
 *
 * Props:
 *  - count:   number of particles
 *  - bounds:  [x, y, z] emitter volume size
 *  - origin:  [x, y, z] center of the emitter (default [0, 0, 0])
 *  - color:   ember color
 *  - size:    point sprite size in world units
 *  - opacity: 0..1
 *  - speed:   vertical rise speed multiplier
 *  - drift:   horizontal drift amplitude
 */
export default function EmberField({
  count = 120,
  bounds = [40, 9, 28],
  origin = [0, 0, -4],
  color = '#ffae3b',
  size = 0.2,
  opacity = 0.8,
  speed = 0.6,
  drift = 0.4,
}) {
  const pointsRef = useRef();
  const [bx, by, bz] = bounds;
  const [ox, oy, oz] = origin;

  // Per-particle initial state, generated once on mount via a lazy useState
  // initializer so the component remains pure across renders.
  const [data] = useState(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    const dx = new Float32Array(count);
    const dz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * bx;
      positions[i * 3 + 1] = oy + Math.random() * by;
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * bz;
      speeds[i] = 0.5 + Math.random() * 1.0;
      phases[i] = Math.random() * Math.PI * 2;
      dx[i] = (Math.random() - 0.5) * drift;
      dz[i] = (Math.random() - 0.5) * drift;
    }
    return { positions, speeds, phases, dx, dz };
  });

  const texture = useMemo(() => getGlow(), []);

  useFrame((state, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    const pos = points.geometry.attributes.position.array;
    const time = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] += data.speeds[i] * delta * speed;
      pos[i * 3] += data.dx[i] * Math.sin(time * 0.7 + data.phases[i]) * delta;
      pos[i * 3 + 2] += data.dz[i] * Math.cos(time * 0.5 + data.phases[i]) * delta;
      if (pos[i * 3 + 1] > oy + by) {
        pos[i * 3 + 1] = oy;
        pos[i * 3] = ox + Math.random() * bx - bx * 0.5;
        pos[i * 3 + 2] = oz + Math.random() * bz - bz * 0.5;
      }
    }
    points.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={data.positions}
          count={count}
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
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}
