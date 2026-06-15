import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import ArenaLighting from './components/ArenaLighting';
import VolumetricBeam from './components/VolumetricBeam';
import ProceduralFloor from './components/ProceduralFloor';
import ParallaxLayer from './components/ParallaxLayer';
import RepellingParticles from './components/RepellingParticles';
import FloorFog from './particles/FloorFog';
import EmberField from './particles/EmberField';
import { useVfx } from '../vfx/vfxContext.js';

function EmberColumn({ position, color }) {
  const orbRef = useRef();
  const lightRef = useRef();

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (orbRef.current) {
      orbRef.current.material.opacity = 0.5 + Math.sin(t * 3 + position[0]) * 0.15;
    }
    if (lightRef.current) {
      lightRef.current.intensity = 1.2 + Math.sin(t * 3 + position[0]) * 0.3;
    }
  });

  return (
    <group position={position}>
      <mesh castShadow position={[0, 4, 0]}>
        <cylinderGeometry args={[0.35, 0.45, 8, 12]} />
        <meshStandardMaterial color="#151219" roughness={0.95} metalness={0.2} />
      </mesh>
      <mesh position={[0, 8.4, 0]} ref={orbRef}>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} />
      </mesh>
      <pointLight
        ref={lightRef}
        position={[0, 8.4, 0]}
        intensity={1.2}
        color={color}
        distance={20}
        decay={2}
      />
    </group>
  );
}

export default function TempleOfCinder({ arena }) {
  const ringRef = useRef();
  const atmosphere = arena?.atmosphere;

  // Reactive ember pulse: each new shockwave (a landed hit) bumps the
  // RepellingParticles' size briefly and the pulse decays here per-frame.
  const emberPulseRef = useRef(0);
  const prevShockCountRef = useRef(0);
  const { shockwavesRef } = useVfx();

  useFrame((state, delta) => {
    if (ringRef.current) {
      ringRef.current.material.opacity = 0.4 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
    }

    // Detect new shockwaves (landed hits) and bump the ember pulse.
    const shocks = shockwavesRef?.current;
    if (shocks) {
      const len = shocks.length;
      const prev = prevShockCountRef.current;
      if (len > prev) {
        emberPulseRef.current = Math.min(0.6, emberPulseRef.current + 0.4);
      }
      prevShockCountRef.current = len;
    }
    // Exponential decay toward 0 (~0.4s half-life).
    const dt = Math.min(delta || 0.016, 0.05);
    emberPulseRef.current *= Math.exp(-1.8 * dt);
    if (emberPulseRef.current < 0.001) emberPulseRef.current = 0;
  });

  const pillars = useMemo(
    () => [
      { x: -12, color: '#2ec4b6' },
      { x: -7, color: '#d4af37' },
      { x: 7, color: '#d4af37' },
      { x: 12, color: '#e71d36' },
    ],
    []
  );

  return (
    <>
      <color attach="background" args={['#05040a']} />
      <fog attach="fog" args={['#05040a', 14, 50]} />

      <ArenaLighting lighting={atmosphere.lighting} />

      {/* Decorative accent lights (kept from the original look) */}
      <pointLight position={[-4, 6, 3]} intensity={1.8} color="#2ec4b6" distance={22} decay={2} />
      <pointLight position={[4, 6, 3]} intensity={1.8} color="#e71d36" distance={22} decay={2} />
      <pointLight position={[0, 4, -8]} intensity={0.9} color="#d4af37" distance={18} decay={2} />
      <spotLight
        position={[0, 16, 8]}
        intensity={1.0}
        angle={0.55}
        penumbra={0.85}
        color="#f0e6d2"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.001}
      />

      {/* Procedural floor */}
      <ProceduralFloor floor={atmosphere.floor} />

      {/* Floor ring (distinctive to the temple) */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} ref={ringRef}>
        <ringGeometry args={[4, 4.25, 64]} />
        <meshBasicMaterial color="#2a2010" transparent opacity={0.6} />
      </mesh>

      {/* Parallax background silhouettes */}
      {atmosphere.parallax.map((p, i) => (
        <ParallaxLayer key={i} {...p} />
      ))}

      {/* Volumetric god rays through the broken arches */}
      {(atmosphere.beams || []).map((b, i) => (
        <VolumetricBeam key={`beam-${i}`} {...b} />
      ))}

      {/* Low-lying floor fog */}
      {atmosphere.floorFog && <FloorFog {...atmosphere.floorFog} />}

      {/* Pillars with glowing orbs (distinctive temple feature) */}
      {pillars.map((p, i) => (
        <EmberColumn key={i} position={[p.x, 0, -12]} color={p.color} />
      ))}

      {/* Atmospheric ember particles */}
      {atmosphere.particles.map((cfg, i) => {
        if (cfg.kind === 'ember') {
          return <EmberField key={`p-${i}`} {...cfg} />;
        }
        return null;
      })}

      {/* Reactive embers: drift away from fighters within ~2 units and
          flare briefly when a hit lands. Sits on top of the ambient
          EmberField layer for extra visual life around the action. */}
      <RepellingParticles
        count={80}
        bounds={[24, 6, 14]}
        origin={[0, 2.5, -3]}
        color="#ffb45a"
        size={0.22}
        opacity={0.55}
        drift={0.35}
        repelRadius={2.0}
        repelStrength={7.5}
        damping={1.4}
        sizePulseRef={emberPulseRef}
      />
    </>
  );
}
