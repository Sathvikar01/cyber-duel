import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { getSoftCircle, getFlake } from './spriteTexture';

/**
 * SnowField
 *
 * Two stacked particle layers: a foreground of large soft flakes (circle
 * sprite) and a background of small sharp ice crystals (custom flake sprite).
 * Both fall downward with sinusoidal drift, recycling at the bottom.
 *
 * Props:
 *  - count:   total flake count. The foreground uses ~70%, background ~30%.
 *  - bounds:  [x, y, z] fall volume
 *  - origin:  [x, y, z] center of the volume
 *  - color:   snow color
 *  - opacity: 0..1
 *  - speed:   fall speed multiplier
 *  - drift:   horizontal drift amplitude
 */
export default function SnowField({
  count = 220,
  bounds = [55, 14, 40],
  origin = [0, 6, -6],
  color = '#e8f4ff',
  opacity = 0.85,
  speed = 0.35,
  drift = 0.18,
}) {
  const foregroundRef = useRef();
  const backgroundRef = useRef();
  const [bx, by, bz] = bounds;
  const [ox, oy, oz] = origin;

  const fgCount = Math.max(1, Math.floor(count * 0.7));
  const bgCount = Math.max(1, count - fgCount);

  const [foregroundData] = useState(() => {
    const positions = new Float32Array(fgCount * 3);
    const phases = new Float32Array(fgCount);
    const fall = new Float32Array(fgCount);
    for (let i = 0; i < fgCount; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * bx;
      positions[i * 3 + 1] = oy + (Math.random() - 0.5) * by;
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * bz;
      phases[i] = Math.random() * Math.PI * 2;
      fall[i] = 0.5 + Math.random() * 0.6;
    }
    return { positions, phases, fall };
  });

  const [backgroundData] = useState(() => {
    const positions = new Float32Array(bgCount * 3);
    const phases = new Float32Array(bgCount);
    const fall = new Float32Array(bgCount);
    for (let i = 0; i < bgCount; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * bx * 1.1;
      positions[i * 3 + 1] = oy + (Math.random() - 0.5) * by;
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * bz * 1.1;
      phases[i] = Math.random() * Math.PI * 2;
      fall[i] = 0.6 + Math.random() * 0.8;
    }
    return { positions, phases, fall };
  });

  const softTex = useMemo(() => getSoftCircle(), []);
  const flakeTex = useMemo(() => getFlake(), []);

  useFrame((state, delta) => {
    const fg = foregroundRef.current;
    const bg = backgroundRef.current;
    const time = state.clock.elapsedTime;

    if (fg) {
      const pos = fg.geometry.attributes.position.array;
      for (let i = 0; i < fgCount; i++) {
        pos[i * 3 + 1] -= foregroundData.fall[i] * delta * speed;
        pos[i * 3] += Math.sin(time * 0.6 + foregroundData.phases[i]) * delta * drift;
        pos[i * 3 + 2] += Math.cos(time * 0.5 + foregroundData.phases[i]) * delta * drift * 0.4;
        if (pos[i * 3 + 1] < oy - by * 0.5) {
          pos[i * 3 + 1] = oy + by * 0.5;
          pos[i * 3] = ox + Math.random() * bx - bx * 0.5;
          pos[i * 3 + 2] = oz + Math.random() * bz - bz * 0.5;
        }
      }
      fg.geometry.attributes.position.needsUpdate = true;
    }

    if (bg) {
      const pos = bg.geometry.attributes.position.array;
      for (let i = 0; i < bgCount; i++) {
        pos[i * 3 + 1] -= backgroundData.fall[i] * delta * speed * 1.3;
        pos[i * 3] += Math.sin(time * 0.8 + backgroundData.phases[i]) * delta * drift * 1.2;
        pos[i * 3 + 2] += Math.cos(time * 0.7 + backgroundData.phases[i]) * delta * drift * 0.5;
        if (pos[i * 3 + 1] < oy - by * 0.5) {
          pos[i * 3 + 1] = oy + by * 0.5;
          pos[i * 3] = ox + Math.random() * bx * 1.1 - bx * 0.55;
          pos[i * 3 + 2] = oz + Math.random() * bz * 1.1 - bz * 0.55;
        }
      }
      bg.geometry.attributes.position.needsUpdate = true;
    }
  });

  return (
    <>
      {/* Foreground: large soft flakes */}
      <points ref={foregroundRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={foregroundData.positions}
            count={fgCount}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.18}
          color={color}
          map={softTex}
          alphaMap={softTex}
          transparent
          opacity={opacity}
          sizeAttenuation
          depthWrite={false}
        />
      </points>

      {/* Background: small sharp ice crystals */}
      <points ref={backgroundRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={backgroundData.positions}
            count={bgCount}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.07}
          color={color}
          map={flakeTex}
          alphaMap={flakeTex}
          transparent
          opacity={opacity * 0.85}
          sizeAttenuation
          depthWrite={false}
        />
      </points>
    </>
  );
}
