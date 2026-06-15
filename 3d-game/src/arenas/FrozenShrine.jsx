import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import ArenaLighting from './components/ArenaLighting';
import VolumetricBeam from './components/VolumetricBeam';
import ProceduralFloor from './components/ProceduralFloor';
import ParallaxLayer from './components/ParallaxLayer';
import RepellingParticles from './components/RepellingParticles';
import FloorFog from './particles/FloorFog';
import SnowField from './particles/SnowField';
import DustField from './particles/DustField';
import { gradientSkyVertex, gradientSkyFragment } from './shaders/skyShaders';

// Deterministic pseudo-random generator for stable render data.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ShrineGate({ position }) {
  const glowRef = useRef();

  useFrame((state) => {
    if (glowRef.current) {
      glowRef.current.material.opacity = 0.35 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
    }
  });

  return (
    <group position={position}>
      {/* Left pillar */}
      <mesh castShadow position={[-2.5, 3.5, 0]}>
        <boxGeometry args={[0.8, 7, 0.8]} />
        <meshStandardMaterial color="#2a3d52" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Right pillar */}
      <mesh castShadow position={[2.5, 3.5, 0]}>
        <boxGeometry args={[0.8, 7, 0.8]} />
        <meshStandardMaterial color="#2a3d52" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Top lintel */}
      <mesh castShadow position={[0, 7.2, 0]}>
        <boxGeometry args={[6.2, 0.6, 0.9]} />
        <meshStandardMaterial color="#2a3d52" roughness={0.7} metalness={0.2} />
      </mesh>
      {/* Snow cap */}
      <mesh position={[0, 7.6, 0]}>
        <boxGeometry args={[6.6, 0.25, 1.1]} />
        <meshStandardMaterial color="#e8f0f7" roughness={0.9} />
      </mesh>
      {/* Glowing center rune */}
      <mesh ref={glowRef} position={[0, 4.5, 0.1]}>
        <torusGeometry args={[0.55, 0.06, 8, 32]} />
        <meshBasicMaterial color="#6ecfff" transparent opacity={0.4} />
      </mesh>
      <pointLight position={[0, 4.5, 0.5]} intensity={1.2} color="#6ecfff" distance={16} decay={2} />
    </group>
  );
}

/**
 * Aurora
 *
 * A large transparent plane parked behind the play field. Three soft color
 * "bands" (cyan, violet, mint) slowly drift across the sky in opposite
 * directions and crossfade in intensity, painting a slow aurora curtain.
 * Additive blending keeps the existing gradient sky readable underneath.
 */
const auroraVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const auroraFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;
  varying vec2 vUv;

  // Soft 1D wave: a sin centered on c with width w, returns 0..1.
  float band(float x, float c, float w) {
    float d = (x - c) / w;
    return exp(-d * d);
  }

  void main() {
    // Curtain altitude bias: aurora is brightest in the upper half of the
    // plane and fades to nothing toward the floor.
    float vertical = smoothstep(0.05, 0.55, vUv.y) * (1.0 - smoothstep(0.75, 1.05, vUv.y));

    // Three bands drifting at different rates and widths.
    float a = band(vUv.x, 0.5 + 0.35 * sin(uTime * 0.07),       0.18);
    float b = band(vUv.x, 0.5 + 0.30 * sin(uTime * 0.11 + 2.1), 0.14);
    float c = band(vUv.x, 0.5 + 0.40 * sin(uTime * 0.05 + 4.2), 0.22);

    // Slow hue cycle so the bands gently breathe in and out.
    float pa = 0.5 + 0.5 * sin(uTime * 0.13);
    float pb = 0.5 + 0.5 * sin(uTime * 0.17 + 1.7);
    float pc = 0.5 + 0.5 * sin(uTime * 0.09 + 3.4);

    vec3 color = uColorA * (a * pa) + uColorB * (b * pb) + uColorC * (c * pc);
    float alpha = (a * pa + b * pb + c * pc) * vertical * uOpacity;
    gl_FragColor = vec4(color, alpha);
  }
`;

function Aurora() {
  const matRef = useRef();
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color('#5af0d6') }, // cyan
      uColorB: { value: new THREE.Color('#9b7cff') }, // purple
      uColorC: { value: new THREE.Color('#6effa2') }, // green
      uOpacity: { value: 0.18 },
    }),
    []
  );

  useFrame((state) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  return (
    <mesh position={[0, 14, -50]} renderOrder={-1}>
      <planeGeometry args={[140, 32, 1, 1]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={auroraVertex}
        fragmentShader={auroraFragment}
        uniforms={uniforms}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

export default function FrozenShrine({ arena }) {
  const { atmosphere } = arena || {};
  const iceRef = useRef();
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color('#0a1424') },
      bottomColor: { value: new THREE.Color('#3a6b8c') },
      intensity: { value: 0.95 },
    }),
    []
  );

  useFrame((state) => {
    if (iceRef.current) {
      iceRef.current.material.opacity = 0.55 + Math.sin(state.clock.elapsedTime * 1.5) * 0.05;
    }
  });

  return (
    <>
      <color attach="background" args={['#0a1424']} />
      <fog attach="fog" args={['#1a2e42', 14, 54]} />

      {/* Gradient sky dome */}
      <mesh scale={[-120, 120, 120]}>
        <sphereGeometry args={[1, 32, 32]} />
        <shaderMaterial
          vertexShader={gradientSkyVertex}
          fragmentShader={gradientSkyFragment}
          uniforms={uniforms}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Aurora curtain: drifts behind the shrine, additive over the sky */}
      <Aurora />

      <ArenaLighting lighting={atmosphere.lighting} />

      {/* Decorative central glow */}
      <pointLight position={[0, 5, -6]} intensity={1.0} color="#6ecfff" distance={22} decay={2} />

      {/* Procedural black-ice floor */}
      <ProceduralFloor floor={atmosphere.floor} />

      {/* Glossy ice highlight plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} ref={iceRef}>
        <planeGeometry args={[22, 22]} />
        <meshBasicMaterial color="#6ecfff" transparent opacity={0.55} depthWrite={false} />
      </mesh>

      {/* Parallax background silhouettes (distant shrine silhouettes) */}
      {atmosphere.parallax.map((p, i) => (
        <ParallaxLayer key={i} {...p} />
      ))}

      {/* Shrine gate (distinctive frozen-shrine feature) */}
      <ShrineGate position={[0, 0, -16]} />

      {/* Moonbeam through the shrine gate */}
      {(atmosphere.beams || []).map((b, i) => (
        <VolumetricBeam key={`beam-${i}`} {...b} />
      ))}

      {/* Low-lying floor fog */}
      {atmosphere.floorFog && <FloorFog {...atmosphere.floorFog} />}

      {/* Snow drifts */}
      {useMemo(() => {
        const rand = mulberry32(0xF2057);
        const positions = [
          [-10, 0.3, -8],
          [11, 0.25, -9],
          [-7, 0.2, 5],
          [8, 0.25, 4],
        ];
        return positions.map((pos, i) => ({
          position: pos,
          radius: 1.2 + rand() * 0.5,
          key: i,
        }));
      }, []).map(({ position, radius, key }) => (
        <mesh key={key} position={position} receiveShadow>
          <sphereGeometry args={[radius, 12, 12]} />
          <meshStandardMaterial color="#dce8f2" roughness={0.95} />
        </mesh>
      ))}

      {/* Atmospheric particles */}
      {atmosphere.particles.map((cfg, i) => {
        if (cfg.kind === 'snow') return <SnowField key={`p-${i}`} {...cfg} />;
        if (cfg.kind === 'dust') return <DustField key={`p-${i}`} {...cfg} />;
        return null;
      })}

      {/* Reactive snowflakes near the play field: scatter when a fighter
          rushes through. Sits low and tight so the existing SnowField still
          carries the volumetric snowfall, while these add local reactivity. */}
      <RepellingParticles
        count={70}
        bounds={[24, 4, 12]}
        origin={[0, 2.0, -3]}
        color="#dcefff"
        size={0.18}
        opacity={0.55}
        drift={0.22}
        repelRadius={1.9}
        repelStrength={5.5}
        damping={1.7}
      />
    </>
  );
}
