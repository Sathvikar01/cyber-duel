import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getLeaf } from './spriteTexture';

/**
 * LeafField
 *
 * Falling leaves with per-particle rotation and wind drift. Uses a custom
 * ShaderMaterial so each sprite can be rotated by an `aAngle` attribute and
 * the angle is incremented in the vertex shader over time.
 *
 * Props:
 *  - count:   number of leaves
 *  - bounds:  [x, y, z] volume the leaves fall through
 *  - origin:  [x, y, z] center of the volume
 *  - color:   leaf color
 *  - opacity: 0..1
 *  - speed:   fall speed multiplier
 *  - drift:   horizontal wind amplitude
 *  - spin:    rotation speed multiplier
 */

const vertexShader = /* glsl */ `
  attribute float aAngle;
  attribute float aSpin;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAngle;

  void main() {
    vAngle = aAngle + aSpin * uTime;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = 60.0 * uPixelRatio / max(0.1, -mvPosition.z);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAngle;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float s = sin(vAngle);
    float co = cos(vAngle);
    vec2 r = vec2(c.x * co - c.y * s, c.x * s + c.y * co);
    vec2 uv = r + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    vec4 t = texture2D(uMap, uv);
    if (t.a < 0.04) discard;
    gl_FragColor = vec4(uColor, t.a * uOpacity);
  }
`;

export default function LeafField({
  count = 90,
  bounds = [45, 7, 30],
  origin = [0, 3, -6],
  color = '#adff2f',
  opacity = 0.9,
  speed = 0.5,
  drift = 0.35,
  spin = 1.4,
}) {
  const pointsRef = useRef();
  const [bx, by, bz] = bounds;
  const [ox, oy, oz] = origin;

  const [data] = useState(() => {
    const positions = new Float32Array(count * 3);
    const angles = new Float32Array(count);
    const spins = new Float32Array(count);
    const phases = new Float32Array(count);
    const fall = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * bx;
      positions[i * 3 + 1] = oy + (Math.random() - 0.5) * by;
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * bz;
      angles[i] = Math.random() * Math.PI * 2;
      spins[i] = (Math.random() - 0.5) * spin;
      phases[i] = Math.random() * Math.PI * 2;
      fall[i] = 0.4 + Math.random() * 0.8;
    }
    return { positions, angles, spins, phases, fall };
  });

  const uniforms = useMemo(
    () => ({
      uMap: { value: getLeaf() },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2) },
    }),
    [color, opacity]
  );

  useFrame((state, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    uniforms.uTime.value = state.clock.elapsedTime;
    const pos = points.geometry.attributes.position.array;
    const time = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] -= data.fall[i] * delta * speed;
      pos[i * 3] += Math.sin(time * 0.8 + data.phases[i]) * delta * drift;
      pos[i * 3 + 2] += Math.cos(time * 0.6 + data.phases[i]) * delta * drift * 0.5;
      if (pos[i * 3 + 1] < oy - by * 0.5) {
        pos[i * 3 + 1] = oy + by * 0.5;
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
        <bufferAttribute
          attach="attributes-aAngle"
          array={data.angles}
          count={count}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-aSpin"
          array={data.spins}
          count={count}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.NormalBlending}
      />
    </points>
  );
}
