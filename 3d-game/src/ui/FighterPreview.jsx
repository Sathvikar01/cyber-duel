import { useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment } from '@react-three/drei';
import * as THREE from 'three';
import GLBFighter from '../fighters/GLBFighter.jsx';

const PREVIEW_SEQUENCE = [
  { anim: 'idle', duration: 1.1 },
  { anim: 'walk', duration: 1.0 },
  { anim: 'jab', duration: 0.55 },
  { anim: 'cross', duration: 0.62 },
  { anim: 'backstep', duration: 0.44 },
  { anim: 'roundhouse', duration: 0.9 },
  { anim: 'idle', duration: 0.8 },
];

const PREVIEW_TOTAL = PREVIEW_SEQUENCE.reduce((sum, step) => sum + step.duration, 0);

function PreviewDirector({ stateRef, characterId }) {
  const phaseOffsetRef = useRef(0);

  useEffect(() => {
    phaseOffsetRef.current = performance.now() / 1000;
  }, [characterId]);

  useFrame((state) => {
    const now = state.clock.elapsedTime - phaseOffsetRef.current;
    const wrapped = ((now % PREVIEW_TOTAL) + PREVIEW_TOTAL) % PREVIEW_TOTAL;
    let cursor = 0;
    let step = PREVIEW_SEQUENCE[0];
    for (const candidate of PREVIEW_SEQUENCE) {
      if (wrapped >= cursor && wrapped < cursor + candidate.duration) {
        step = candidate;
        break;
      }
      cursor += candidate.duration;
    }

    const local = Math.max(0, Math.min(1, (wrapped - cursor) / step.duration));
    const drift = Math.sin(state.clock.elapsedTime * 0.75) * 0.045;
    const f = stateRef.current;
    f.position = [drift, 0, Math.sin(state.clock.elapsedTime * 0.45) * 0.025];
    f.velX = Math.cos(state.clock.elapsedTime * 0.75) * 0.034;
    f.velZ = Math.cos(state.clock.elapsedTime * 0.45) * 0.012;
    f.facing = 1;
    f.anim = step.anim;
    f.animProgress = local;
    f.isAttacking = !['idle', 'walk', 'backstep'].includes(step.anim);
    f.isBlocking = false;
    f.isHit = false;
    f.stateTimer = step.anim === 'backstep' ? Math.max(0, 0.35 * (1 - local)) : 0;
  });

  return null;
}

/**
 * Renders a single fighter in a preview pose for the character-select
 * screen. Uses GLBFighter (real three.js glTF character) so the preview
 * matches the in-game model.
 *
 * Props:
 * - character: full character config object (id, name, bodyColor, accentColor,
 *   bodyScale, torsoScale, headScale, limbScale, handScale, stanceOffset,
 *   silhouette config, etc.)
 * - arena: optional arena id used to tint the preview backdrop
 */
export default function FighterPreview({ character, arena }) {
  const stateRef = useRef({
    position: [0, 0, 0],
    facing: 1,
    anim: 'idle',
    animProgress: 0,
    isHit: false,
    isBlocking: false,
    isAttacking: false,
    hp: 100,
    stamina: 100,
  });

  const backdropTint = {
    temple: '#05040a',
    bamboo: '#0d1f17',
    coliseum: '#2a1c4a',
    shrine: '#0a1424',
  }[arena] || '#05040a';

  return (
    <div className="h-full w-full overflow-hidden rounded border border-gold/30 bg-ink-900/60">
      <Canvas
        shadows
        camera={{ position: [0, 1.75, 4.8], fov: 38 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        frameloop="always"
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}
      >
        <color attach="background" args={[backdropTint]} />
        <Environment preset="warehouse" environmentIntensity={0.55} />
        <ambientLight intensity={0.18} color="#f0e6d2" />
        <directionalLight
          position={[2.5, 5.2, 3.4]}
          intensity={2.1}
          color="#f0e6d2"
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <pointLight
          position={[-2.4, 2.2, 2.2]}
          intensity={1.4}
          color={character?.glowColor || '#d4af37'}
          distance={8}
          decay={2}
        />
        <pointLight position={[1.6, 0.8, -1.4]} intensity={0.5} color="#6ecfff" distance={5} decay={2} />

        <PreviewDirector stateRef={stateRef} characterId={character?.id} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]} receiveShadow>
          <circleGeometry args={[1.7, 64]} />
          <meshStandardMaterial
            color="#17111d"
            roughness={0.86}
            metalness={0.12}
            emissive={character?.glowColor || '#d4af37'}
            emissiveIntensity={0.05}
          />
        </mesh>
        <ContactShadows
          position={[0, 0.01, 0]}
          opacity={0.48}
          scale={3.7}
          blur={2.4}
          far={2.4}
          color="#020106"
        />

        <GLBFighter
          stateRef={stateRef}
          character={character}
          isPlayer
        />
      </Canvas>
    </div>
  );
}
