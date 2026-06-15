/**
 * VolumetricBeam
 *
 * A soft, additive "god ray" rendered as two crossed vertical planes with a
 * vertical gradient texture (bright at top, fading to transparent at bottom).
 * Used in arenas to suggest light pouring through an opening in the
 * architecture (broken arch, canopy, broken ceiling, shrine gate, etc.).
 *
 * Implementation notes:
 *  - The beam is built from two thin planeGeometry panels (XY and YZ) so it
 *    reads as volumetric from any camera angle.
 *  - The gradient texture is cached at module scope — one canvas per page.
 *  - Additive blending + depthWrite:false ensures the beam never writes to
 *    the depth buffer (so it doesn't punch a hole in the scene) and stacks
 *    with other additive layers nicely.
 *  - A slow opacity shimmer (sin-based, ±10%) keeps the beam feeling alive
 *    without strobing.
 *
 * Props:
 *  - position: [x, y, z]  Top of the beam (the "source")
 *  - targetY:  number     Floor / base of the beam
 *  - color:    string     Beam tint
 *  - width:    number     Plane width
 *  - intensity: 0..1      Master brightness, mapped to base opacity (~0.25 cap)
 *  - animated: boolean    If true, the beam shimmers subtly over time
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

let cachedGradient = null;
function getGradientTexture() {
  if (cachedGradient) return cachedGradient;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  cachedGradient = tex;
  return tex;
}

export default function VolumetricBeam({
  position = [0, 12, 0],
  targetY = 0,
  color = '#fff5d8',
  width = 2.5,
  intensity = 0.6,
  animated = true,
}) {
  const matARef = useRef();
  const matBRef = useRef();
  const texture = useMemo(() => getGradientTexture(), []);

  const topY = position[1];
  const height = Math.max(0.1, topY - targetY);
  const centerY = (topY + targetY) / 2;
  const baseOpacity = Math.max(0, Math.min(1, intensity)) * 0.25;
  const phase = (position[0] * 0.3) + (position[2] * 0.7);

  useFrame((state) => {
    if (!animated) {
      if (matARef.current) matARef.current.opacity = baseOpacity;
      if (matBRef.current) matBRef.current.opacity = baseOpacity * 0.7;
      return;
    }
    const t = state.clock.elapsedTime;
    const shimmer = 1 + Math.sin(t * 1.4 + phase) * 0.1;
    if (matARef.current) matARef.current.opacity = baseOpacity * shimmer;
    if (matBRef.current) matBRef.current.opacity = baseOpacity * 0.7 * shimmer;
  });

  return (
    <group position={[position[0], centerY, position[2]]}>
      {/* Primary plane: faces the +Z direction (default) */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          ref={matARef}
          color={color}
          map={texture}
          alphaMap={texture}
          transparent
          opacity={baseOpacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {/* Crossed plane: gives the beam apparent thickness from side angles */}
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          ref={matBRef}
          color={color}
          map={texture}
          alphaMap={texture}
          transparent
          opacity={baseOpacity * 0.7}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
