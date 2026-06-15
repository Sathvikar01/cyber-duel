import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import ArenaLighting from './components/ArenaLighting';
import VolumetricBeam from './components/VolumetricBeam';
import ProceduralFloor from './components/ProceduralFloor';
import ParallaxLayer from './components/ParallaxLayer';
import FloorFog from './particles/FloorFog';
import DustField from './particles/DustField';
import EmberField from './particles/EmberField';
import { gradientSkyVertex, sunsetSkyFragment } from './shaders/skyShaders';

// Deterministic pseudo-random generator for stable render data.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function BrokenColumn({ position, height, lean, color = '#6e5a45' }) {
  return (
    <group position={position} rotation={[lean[0], lean[1], lean[2]]}>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.55, 0.65, height, 14]} />
        <meshStandardMaterial color={color} roughness={0.95} metalness={0.1} />
      </mesh>
      {/* Broken top cap */}
      <mesh castShadow position={[0, height + 0.15, 0]} rotation={[0.4, 0, 0.2]}>
        <cylinderGeometry args={[0.45, 0.55, 0.3, 12]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* Fluted grooves */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={i} position={[Math.cos((i / 6) * Math.PI * 2) * 0.55, height / 2, Math.sin((i / 6) * Math.PI * 2) * 0.55]}>
          <boxGeometry args={[0.08, height * 0.9, 0.04]} />
          <meshStandardMaterial color="#5c4a38" roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

function Torch({ position }) {
  const lightRef = useRef();
  const flameRef = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (lightRef.current) {
      lightRef.current.intensity = 1.4 + Math.sin(t * 8 + position[0]) * 0.3;
    }
    if (flameRef.current) {
      flameRef.current.scale.setScalar(1 + Math.sin(t * 10 + position[2]) * 0.08);
      flameRef.current.rotation.z = Math.sin(t * 6) * 0.1;
    }
  });

  return (
    <group position={position}>
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 1.6, 8]} />
        <meshStandardMaterial color="#3d3024" roughness={0.9} />
      </mesh>
      <mesh ref={flameRef} position={[0, 1.75, 0]}>
        <coneGeometry args={[0.12, 0.35, 8]} />
        <meshBasicMaterial color="#ff9d3e" transparent opacity={0.85} />
      </mesh>
      <pointLight ref={lightRef} position={[0, 1.8, 0]} intensity={1.4} color="#ff7b2e" distance={14} decay={2} />
    </group>
  );
}

export default function ShatteredColiseum({ arena }) {
  const { atmosphere } = arena || {};

  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color('#2a1c4a') },
      midColor: { value: new THREE.Color('#b45a2b') },
      bottomColor: { value: new THREE.Color('#e8a64d') },
      intensity: { value: 1.05 },
      time: { value: 0 },
    }),
    []
  );

  useFrame((state) => {
    uniforms.time.value = state.clock.elapsedTime;
  });

  const columns = useMemo(
    () => [
      { position: [-14, 0, -10], height: 5.5, lean: [0.1, 0, 0.05] },
      { position: [-10, 0, -14], height: 7, lean: [-0.05, 0, 0.08] },
      { position: [10, 0, -13], height: 4.2, lean: [0.06, 0, -0.1] },
      { position: [15, 0, -9], height: 6.3, lean: [0, 0, -0.06] },
      { position: [-17, 0, -4], height: 3.5, lean: [0.12, 0, 0] },
      { position: [17, 0, -5], height: 4, lean: [-0.08, 0, 0.04] },
    ],
    []
  );

  return (
    <>
      <color attach="background" args={['#2a1c4a']} />
      <fog attach="fog" args={['#5c3a1e', 14, 52]} />

      {/* Sunset sky dome */}
      <mesh scale={[-120, 120, 120]}>
        <sphereGeometry args={[1, 32, 32]} />
        <shaderMaterial
          vertexShader={gradientSkyVertex}
          fragmentShader={sunsetSkyFragment}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      <ArenaLighting lighting={atmosphere.lighting} />

      {/* Decorative central glow */}
      <pointLight position={[0, 6, -8]} intensity={0.8} color="#d4af37" distance={28} decay={2} />

      {/* Procedural cracked-marble floor */}
      <ProceduralFloor floor={atmosphere.floor} />

      {/* Parallax background silhouettes (broken coliseum arches) */}
      {atmosphere.parallax.map((p, i) => (
        <ParallaxLayer key={i} {...p} />
      ))}

      {/* Broken columns (distinctive coliseum feature) */}
      {columns.map((col, i) => (
        <BrokenColumn key={i} {...col} />
      ))}

      {/* Sunset beam through the broken ceiling */}
      {(atmosphere.beams || []).map((b, i) => (
        <VolumetricBeam key={`beam-${i}`} {...b} />
      ))}

      {/* Low-lying floor fog */}
      {atmosphere.floorFog && <FloorFog {...atmosphere.floorFog} />}

      {/* Scattered rubble */}
      {useMemo(() => {
        const rand = mulberry32(0xC0115E);
        const positions = [
          [-6, 0.12, -6],
          [7, 0.1, -7],
          [-4, 0.08, 3],
          [5, 0.1, 4],
        ];
        return positions.map((pos, i) => ({
          position: pos,
          rotation: [rand() * 0.4, rand() * Math.PI, rand() * 0.4],
          size: [0.5 + rand() * 0.4, 0.2 + rand() * 0.2, 0.5 + rand() * 0.4],
          key: i,
        }));
      }, []).map(({ position, rotation, size, key }) => (
        <mesh key={key} position={position} rotation={rotation} castShadow receiveShadow>
          <boxGeometry args={size} />
          <meshStandardMaterial color="#6e5a45" roughness={0.95} />
        </mesh>
      ))}

      {/* Torches (distinctive arena accent) */}
      <Torch position={[-11, 0, 4]} />
      <Torch position={[11, 0, 4]} />
      <Torch position={[0, 0, -9]} />

      {/* Atmospheric particles */}
      {atmosphere.particles.map((cfg, i) => {
        if (cfg.kind === 'dust') return <DustField key={`p-${i}`} {...cfg} />;
        if (cfg.kind === 'ember') return <EmberField key={`p-${i}`} {...cfg} />;
        return null;
      })}
    </>
  );
}
