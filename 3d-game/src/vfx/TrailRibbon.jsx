import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const MAX_SEGMENTS = 24;

export default function TrailRibbon({ getStart, getEnd, color, life = 0.12 }) {
  const meshRef = useRef();
  const segmentsRef = useRef([]);
  const tmpA = useMemo(() => new THREE.Vector3(), []);
  const tmpB = useMemo(() => new THREE.Vector3(), []);
  const tmpC = useMemo(() => new THREE.Vector3(), []);

  const positions = useMemo(() => new Float32Array(MAX_SEGMENTS * 6), []);
  const colors = useMemo(() => new Float32Array(MAX_SEGMENTS * 6), []);
  const indices = useMemo(() => {
    const idx = [];
    for (let i = 0; i < MAX_SEGMENTS - 1; i++) {
      const base = i * 2;
      idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    return new Uint16Array(idx);
  }, []);

  const baseColor = useMemo(() => new THREE.Color(color), [color]);

  useFrame((state, delta) => {
    if (!meshRef.current || !getStart || !getEnd) return;

    const dt = Math.min(delta, 0.05);
    const start = getStart();
    const end = getEnd();
    if (!start || !end) return;

    segmentsRef.current.push({ start: start.clone(), end: end.clone(), life });

    for (let i = segmentsRef.current.length - 1; i >= 0; i--) {
      segmentsRef.current[i].life -= dt;
      if (segmentsRef.current[i].life <= 0) {
        segmentsRef.current.splice(i, 1);
      }
    }

    while (segmentsRef.current.length > MAX_SEGMENTS) {
      segmentsRef.current.shift();
    }

    const segs = segmentsRef.current;
    const pos = positions;
    const col = colors;

    for (let i = 0; i < MAX_SEGMENTS; i++) {
      const seg = segs[i];
      const base = i * 6;
      if (seg) {
        const a = seg.life / life;
        tmpA.copy(seg.start);
        tmpB.copy(seg.end);
        tmpC.copy(tmpB).sub(tmpA);
        const offset = new THREE.Vector3(-tmpC.z, 0, tmpC.x).normalize().multiplyScalar(0.03 * a);

        pos[base] = tmpA.x + offset.x;
        pos[base + 1] = tmpA.y;
        pos[base + 2] = tmpA.z + offset.z;
        pos[base + 3] = tmpA.x - offset.x;
        pos[base + 4] = tmpA.y;
        pos[base + 5] = tmpA.z - offset.z;

        for (let j = 0; j < 2; j++) {
          col[base + j * 3] = baseColor.r * a;
          col[base + j * 3 + 1] = baseColor.g * a;
          col[base + j * 3 + 2] = baseColor.b * a;
        }
      } else {
        pos[base + 1] = -1000;
        pos[base + 4] = -1000;
      }
    }

    const geo = meshRef.current.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });

  return (
    <mesh ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={MAX_SEGMENTS * 2} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={MAX_SEGMENTS * 2} array={colors} itemSize={3} />
        <bufferAttribute attach="index" count={indices.length} array={indices} itemSize={1} />
      </bufferGeometry>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
