import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Camera-driven parallax background layer.
 *
 * The layer's group is offset in X by `cameraX * (1 - depth) * strength`
 * on every frame, so distant layers (depth ~ 1) move very little while
 * near layers (depth ~ 0) track the camera. Renders unlit (`meshBasicMaterial`)
 * planes or simple silhouette shapes against the fog/background.
 *
 * Props:
 *  - depth:    0..1 (1 = static, 0 = follows camera)
 *  - strength: multiplier on the camera offset
 *  - color:    base color for the layer / shapes
 *  - y, z:     world placement of the layer
 *  - kind:     'plane' | 'silhouette'
 *  - size:     [w, h] for plane kind
 *  - shapes:   array of shape defs for silhouette kind
 *              shape = { type: 'box', position: [x,y,z], size: [w,h,d] }
 *                   | { type: 'arch', position: [x,y,z], width, height, thickness }
 *  - opacity:  0..1 (default 1)
 */
export default function ParallaxLayer({
  depth = 0.5,
  strength = 1,
  color = '#000000',
  y = 0,
  z = -20,
  kind = 'plane',
  size = [40, 20],
  shapes = [],
  opacity = 1,
}) {
  const { camera } = useThree();
  const ref = useRef();

  useFrame(() => {
    if (!ref.current) return;
    const camX = camera.position?.x ?? 0;
    ref.current.position.x = camX * (1 - depth) * strength;
  });

  const materialProps = {
    color,
    depthWrite: false,
    transparent: opacity < 1,
    opacity,
  };

  return (
    <group ref={ref} position={[0, y, z]}>
      {kind === 'plane' && (
        <mesh>
          <planeGeometry args={size} />
          <meshBasicMaterial {...materialProps} />
        </mesh>
      )}

      {kind === 'silhouette' &&
        shapes.map((s, i) => {
          if (s.type === 'box') {
            return (
              <mesh key={i} position={s.position || [0, 0, 0]}>
                <boxGeometry args={s.size || [1, 1, 1]} />
                <meshBasicMaterial {...materialProps} />
              </mesh>
            );
          }
          if (s.type === 'arch') {
            const { width, height, thickness } = s;
            return (
              <group key={i} position={s.position || [0, 0, 0]}>
                <mesh position={[-width / 2, height / 2, 0]}>
                  <boxGeometry args={[thickness, height, 0.1]} />
                  <meshBasicMaterial {...materialProps} />
                </mesh>
                <mesh position={[width / 2, height / 2, 0]}>
                  <boxGeometry args={[thickness, height, 0.1]} />
                  <meshBasicMaterial {...materialProps} />
                </mesh>
                <mesh position={[0, height + thickness / 2, 0]}>
                  <boxGeometry args={[width + thickness, thickness, 0.1]} />
                  <meshBasicMaterial {...materialProps} />
                </mesh>
              </group>
            );
          }
          return null;
        })}
    </group>
  );
}
