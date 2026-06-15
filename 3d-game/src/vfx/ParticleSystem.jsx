import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useVfx, MAX_PARTICLES } from './vfxContext.js';

export default function ParticleSystem() {
  const { particlesRef } = useVfx();
  const pointsRef = useRef();
  const positionsRef = useRef(new Float32Array(MAX_PARTICLES * 3));
  const colorsRef = useRef(new Float32Array(MAX_PARTICLES * 3));
  const sizesRef = useRef(new Float32Array(MAX_PARTICLES));
  const tmpColor = useRef(new THREE.Color());

  useFrame((state, delta) => {
    if (!pointsRef.current) return;

    const particles = particlesRef.current;
    const dt = Math.min(delta, 0.05);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      if (p.type === 'spark') {
        p.vy -= 9.8 * dt;
        p.life -= dt * 2.2;
      } else {
        p.vy *= 0.96;
        p.vx *= 0.96;
        p.vz *= 0.96;
        p.life -= dt * 1.4;
      }

      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }

    const pos = positionsRef.current;
    const col = colorsRef.current;
    const sizes = sizesRef.current;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (i < particles.length) {
        const p = particles[i];
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y;
        pos[i * 3 + 2] = p.z;
        tmpColor.current.setHex(p.color);
        const a = Math.max(0, p.life);
        col[i * 3] = tmpColor.current.r * a;
        col[i * 3 + 1] = tmpColor.current.g * a;
        col[i * 3 + 2] = tmpColor.current.b * a;
        sizes[i] = p.size * a;
      } else {
        pos[i * 3 + 1] = -1000;
        col[i * 3] = 0;
        col[i * 3 + 1] = 0;
        col[i * 3 + 2] = 0;
        sizes[i] = 0;
      }
    }

    const geo = pointsRef.current.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={MAX_PARTICLES} array={positionsRef.current} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={MAX_PARTICLES} array={colorsRef.current} itemSize={3} />
        <bufferAttribute attach="attributes-size" count={MAX_PARTICLES} array={sizesRef.current} itemSize={1} />
      </bufferGeometry>
      <pointsMaterial
        size={0.1}
        vertexColors
        transparent
        opacity={0.95}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}
