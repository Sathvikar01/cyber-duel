/**
 * Per-arena lighting rig. Replaces the previous hard-coded ambient + directional
 * pair that each arena inlined, and is intended to be driven by data in
 * arenaData.js so that look-and-feel can be tuned without touching code.
 *
 * Props:
 *  - lighting: {
 *      ambient: { intensity, color },
 *      key:     { position, intensity, color, castShadow, flickerSeed },
 *      rim:     { position, intensity, color, flickerSeed },
 *    }
 *
 * The key light is the primary shadow caster. The rim is a soft back light to
 * separate silhouettes from the background. Arenas may still add their own
 * decorative point / spot lights (torches, lanterns, etc.).
 *
 * Light flicker:
 *  - The key and rim lights subtly modulate their intensity each frame with a
 *    small noise function (sin-based) so torch / lantern / moonlight feels
 *    alive. The variation is small (±5-10% around the base) — the scene should
 *    never feel like it's strobing.
 *  - Optional `flickerSeed` per light offsets the phase so multiple arenas (or
 *    key vs rim) don't pulse in sync. Defaults to 0.
 *  - Warm lights also receive a tiny color shift (candle-like hue jitter) on
 *    the red/blue channels.
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export default function ArenaLighting({ lighting }) {
  const { ambient, key, rim } = lighting || {};

  const keyLightRef = useRef();
  const rimLightRef = useRef();
  const keyBaseColor = useRef(null);
  const rimBaseColor = useRef(null);
  const keyFlickerColor = useRef(new THREE.Color());
  const rimFlickerColor = useRef(new THREE.Color());

  useFrame((state) => {
    if (!lighting) return;
    const t = state.clock.elapsedTime;

    if (keyLightRef.current && key) {
      if (!keyBaseColor.current) {
        keyBaseColor.current = new THREE.Color().copy(keyLightRef.current.color);
      }
      const seed = Number.isFinite(key.flickerSeed) ? key.flickerSeed : 0;
      const flicker = Math.sin(t * 8 + seed) * 0.1 + 0.95;
      keyLightRef.current.intensity = key.intensity * flicker;

      const base = keyBaseColor.current;
      const shift = Math.sin(t * 5 + seed) * 0.02;
      keyFlickerColor.current.setRGB(
        Math.max(0, Math.min(1, base.r + shift * 0.3)),
        Math.max(0, Math.min(1, base.g + shift * 0.1)),
        Math.max(0, Math.min(1, base.b - shift * 0.1))
      );
      keyLightRef.current.color.copy(keyFlickerColor.current);
    }

    if (rimLightRef.current && rim) {
      if (!rimBaseColor.current) {
        rimBaseColor.current = new THREE.Color().copy(rimLightRef.current.color);
      }
      const seed = Number.isFinite(rim.flickerSeed) ? rim.flickerSeed : 1.7;
      const flicker = Math.sin(t * 7 + seed) * 0.08 + 0.96;
      rimLightRef.current.intensity = rim.intensity * flicker;

      const base = rimBaseColor.current;
      const shift = Math.sin(t * 4.5 + seed) * 0.015;
      rimFlickerColor.current.setRGB(
        Math.max(0, Math.min(1, base.r + shift * 0.25)),
        Math.max(0, Math.min(1, base.g + shift * 0.05)),
        Math.max(0, Math.min(1, base.b - shift * 0.05))
      );
      rimLightRef.current.color.copy(rimFlickerColor.current);
    }
  });

  if (!lighting) return null;

  return (
    <>
      {ambient && (
        <ambientLight intensity={ambient.intensity} color={ambient.color} />
      )}

      {key && (
        <directionalLight
          ref={keyLightRef}
          position={key.position}
          intensity={key.intensity}
          color={key.color}
          castShadow={Boolean(key.castShadow)}
          shadow-mapSize-width={key.castShadow ? 1024 : undefined}
          shadow-mapSize-height={key.castShadow ? 1024 : undefined}
          shadow-bias={-0.001}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
          shadow-camera-near={0.5}
          shadow-camera-far={60}
        />
      )}

      {rim && (
        <directionalLight
          ref={rimLightRef}
          position={rim.position}
          intensity={rim.intensity}
          color={rim.color}
        />
      )}
    </>
  );
}
