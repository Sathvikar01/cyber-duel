import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import ArenaLighting from './components/ArenaLighting';
import VolumetricBeam from './components/VolumetricBeam';
import ProceduralFloor from './components/ProceduralFloor';
import ParallaxLayer from './components/ParallaxLayer';
import RepellingParticles from './components/RepellingParticles';
import FloorFog from './particles/FloorFog';
import LeafField from './particles/LeafField';
import DustField from './particles/DustField';
import { gradientSkyVertex, noiseSkyFragment } from './shaders/skyShaders';

// Deterministic pseudo-random generator for stable instance data.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function BambooStalks({ count = 80 }) {
  const meshRef = useRef();
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const instances = useMemo(() => {
    const rand = mulberry32(0xB4A700);
    const data = [];
    for (let i = 0; i < count; i++) {
      const x = (rand() - 0.5) * 50;
      const z = -8 - rand() * 30;
      const scale = 0.8 + rand() * 0.7;
      const height = 6 + rand() * 5;
      const lean = (rand() - 0.5) * 0.15;
      // Per-stalk wind responsiveness: some stalks are stiffer than others.
      // We bake direction bias and response in here so the per-frame loop
      // stays branch-free.
      const windResponse = 0.5 + rand() * 0.9;     // 0.5..1.4
      const windBias = (rand() - 0.5) * 0.4;       // small per-stalk offset
      const windFreq = 0.85 + rand() * 0.5;        // individual frequencies
      data.push({
        x, z, scale, height, lean,
        phase: rand() * Math.PI * 2,
        windResponse,
        windBias,
        windFreq,
      });
    }
    return data;
  }, [count]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;

    // Global wind direction oscillates left->right->left over a 10s period
    // (5s per direction). The gust factor pulses on a faster cycle so the
    // grove visibly "breathes" with stronger and weaker bursts.
    const windDirection = Math.sin(t * (Math.PI / 5));
    const gust = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 0.6));

    instances.forEach((inst, i) => {
      // Baseline ambient sway (kept from the original tuning so the grove
      // never feels totally still even when the wind direction is crossing
      // zero).
      const baseSway = Math.sin(t * 1.2 * inst.windFreq + inst.phase) * 0.04;
      // Wind-driven sway: signed by the global direction, scaled by the
      // per-stalk response and the current gust amplitude.
      const windSway =
        (windDirection + inst.windBias) * inst.windResponse * 0.08 * gust;
      const sway = baseSway + windSway;

      dummy.position.set(inst.x, inst.height / 2, inst.z);
      dummy.scale.set(inst.scale, inst.height, inst.scale);
      dummy.rotation.set(inst.lean, 0, sway);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]} receiveShadow castShadow>
      <cylinderGeometry args={[0.06, 0.08, 1, 8]} />
      <meshStandardMaterial color="#2d4a32" roughness={0.85} metalness={0.05} />
    </instancedMesh>
  );
}

function MistLayer({ y, opacity, color }) {
  const ref = useRef();
  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    ref.current.position.x = Math.sin(t * 0.15) * 2;
    ref.current.material.opacity = opacity + Math.sin(t + y) * 0.03;
  });

  return (
    <mesh position={[0, y, -15]} rotation={[-Math.PI / 2, 0, 0]} ref={ref}>
      <planeGeometry args={[70, 40, 1, 1]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

export default function BambooGrove({ arena }) {
  const { atmosphere } = arena || {};

  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color('#0d1f17') },
      bottomColor: { value: new THREE.Color('#3a5f40') },
      noiseColor: { value: new THREE.Color('#8fbc8f') },
      intensity: { value: 1.1 },
      time: { value: 0 },
    }),
    []
  );

  useFrame((state) => {
    uniforms.time.value = state.clock.elapsedTime;
  });

  return (
    <>
      <color attach="background" args={['#0d1f17']} />
      <fog attach="fog" args={['#1a3322', 12, 46]} />

      {/* Shader gradient sky dome */}
      <mesh scale={[-120, 120, 120]}>
        <sphereGeometry args={[1, 32, 32]} />
        <shaderMaterial
          vertexShader={gradientSkyVertex}
          fragmentShader={noiseSkyFragment}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      <ArenaLighting lighting={atmosphere.lighting} />

      {/* Decorative moonlight point light */}
      <pointLight position={[0, 5, -5]} intensity={0.8} color="#90ee90" distance={24} decay={2} />

      {/* Procedural wet path floor */}
      <ProceduralFloor floor={atmosphere.floor} />

      {/* Bamboo stalks (distinctive grove feature) */}
      <BambooStalks count={90} />

      {/* Parallax background silhouettes (distant bamboo + horizon) */}
      {atmosphere.parallax.map((p, i) => (
        <ParallaxLayer key={i} {...p} />
      ))}

      {/* Volumetric moonbeam through the canopy */}
      {(atmosphere.beams || []).map((b, i) => (
        <VolumetricBeam key={`beam-${i}`} {...b} />
      ))}

      {/* Low-lying floor fog */}
      {atmosphere.floorFog && <FloorFog {...atmosphere.floorFog} />}

      {/* Mist layers */}
      <MistLayer y={0.3} opacity={0.18} color="#a8c6a8" />
      <MistLayer y={1.2} opacity={0.12} color="#d4e8d4" />

      {/* Atmospheric particles */}
      {atmosphere.particles.map((cfg, i) => {
        if (cfg.kind === 'leaf') return <LeafField key={`p-${i}`} {...cfg} />;
        if (cfg.kind === 'dust') return <DustField key={`p-${i}`} {...cfg} />;
        return null;
      })}

      {/* Reactive fireflies: pale-green motes that drift through the grove
          and scatter when a fighter passes through them. */}
      <RepellingParticles
        count={70}
        bounds={[28, 5, 16]}
        origin={[0, 1.8, -3]}
        color="#b8ff96"
        size={0.16}
        opacity={0.6}
        drift={0.3}
        repelRadius={1.8}
        repelStrength={6.0}
        damping={1.5}
      />
    </>
  );
}
