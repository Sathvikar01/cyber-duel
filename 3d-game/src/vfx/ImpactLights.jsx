/**
 * ImpactLights
 *
 * A ref-driven pool of brief dynamic point lights that flash on hit and decay
 * exponentially over ~0.15s. Each light is spawned by the parent via the
 * imperative `spawn(position, color)` method exposed through `ref`:
 *
 *   const impactLightsRef = useRef(null);
 *   impactLightsRef.current?.spawn([x, y, z], '#e71d36');
 *
 * The component manages its own internal state for the active lights, removes
 * dead lights in useFrame, and renders one <pointLight> per active entry.
 *
 * Light parameters:
 *  - color:     attacker's accent color
 *  - position:  midpoint between attacker and defender at y=1.2
 *  - intensity: 1.5 → 0 over 0.15s, exponential decay (Math.exp(-elapsed * 25))
 *  - distance:  4 (short throw, sells the local flash without flooding the rig)
 */
import { forwardRef, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';

const MAX_LIFE = 0.15;
const BASE_INTENSITY = 1.5;
const LIGHT_DISTANCE = 4;
const DECAY_RATE = 25;

const ImpactLights = forwardRef((_, ref) => {
  const lightsRef = useRef([]);
  const idRef = useRef(0);
  const [, setTick] = useState(0);
  const force = useCallback(() => setTick((v) => (v + 1) | 0), []);

  useImperativeHandle(ref, () => ({
    spawn: (position, color) => {
      idRef.current += 1;
      lightsRef.current.push({
        id: idRef.current,
        position: [position[0], position[1] ?? 1.2, position[2] ?? 0],
        color: color || '#ff3344',
        life: MAX_LIFE,
        maxLife: MAX_LIFE,
        intensity: BASE_INTENSITY,
      });
      force();
    },
    clear: () => {
      lightsRef.current.length = 0;
      force();
    },
  }), [force]);

  useFrame((_, delta) => {
    const lights = lightsRef.current;
    if (lights.length === 0) return;
    const dt = Math.min(delta, 0.05);
    let changed = false;
    for (let i = lights.length - 1; i >= 0; i--) {
      const newLife = lights[i].life - dt;
      if (newLife <= 0) {
        lights.splice(i, 1);
        changed = true;
      } else if (newLife !== lights[i].life) {
        lights[i].life = newLife;
        changed = true;
      }
    }
    if (changed) force();
  });

  return (
    <>
      {lightsRef.current.map((l) => {
        const elapsed = l.maxLife - l.life;
        const intensity = l.intensity * Math.exp(-elapsed * DECAY_RATE);
        return (
          <pointLight
            key={l.id}
            position={l.position}
            color={l.color}
            intensity={intensity}
            distance={LIGHT_DISTANCE}
            decay={2}
          />
        );
      })}
    </>
  );
});

ImpactLights.displayName = 'ImpactLights';

export default ImpactLights;
