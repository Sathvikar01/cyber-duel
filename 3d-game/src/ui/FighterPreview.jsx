import { useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import GLBFighter from '../fighters/GLBFighter.jsx';

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
        camera={{ position: [0, 2.2, 5.5], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        frameloop="always"
      >
        <color attach="background" args={[backdropTint]} />
        <ambientLight intensity={0.25} color="#f0e6d2" />
        <directionalLight position={[2, 5, 4]} intensity={1.2} color="#f0e6d2" castShadow />
        <pointLight position={[-2, 3, 2]} intensity={0.8} color={character?.glowColor || '#d4af37'} distance={12} decay={2} />

        <GLBFighter
          stateRef={stateRef}
          character={character}
          isPlayer
        />
      </Canvas>
    </div>
  );
}
