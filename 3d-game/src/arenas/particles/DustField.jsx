import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getSoftCircle } from './spriteTexture';

/**
 * DustField
 *
 * Suspended dust motes drifting near the ground. Particles spawn at low
 * altitudes and slowly rise with strong horizontal meander, giving the
 * impression of air catching sunlight through the arena.
 *
 * Props:
 *  - count:   number of motes
 *  - bounds:  [x, y, z] volume (typically flat in Y)
 *  - origin:  [x, y, z] center of the volume
 *  - color:   dust color (warm light)
 *  - size:    sprite size
 *  - opacity: 0..1
 *  - speed:   vertical rise speed multiplier
 *  - drift:   horizontal drift amplitude
 */
export default function DustField({
  count = 160,
  bounds = [50, 4, 35],
  origin = [0, 1, -4],
  color = '#e8c98f',
  size = 0.1,
  opacity = 0.5,
  speed = 0.12,
  drift = 0.25,
}) {
  const pointsRef = useRef();
  const [bx, by, bz] = bounds;
  const [ox, oy, oz] = origin;

  const [data] = useState(() => {
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * bx;
      positions[i * 3 + 1] = oy + (Math.random() - 0.5) * by;
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * bz;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.3 + Math.random() * 0.7;
    }
    return { positions, phases, speeds };
  });

  const texture = useMemo(() => getSoftCircle(), []);

  useFrame((state, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    const pos = points.geometry.attributes.position.array;
    const time = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] += data.speeds[i] * delta * speed;
      pos[i * 3] += Math.sin(time * 0.4 + data.phases[i]) * delta * drift;
      pos[i * 3 + 2] += Math.cos(time * 0.35 + data.phases[i]) * delta * drift * 0.6;
      if (pos[i * 3 + 1] > oy + by * 0.5) {
        pos[i * 3 + 1] = oy - by * 0.5;
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
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}
