import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGlow } from '../particles/spriteTexture';

/**
 * RepellingParticles
 *
 * Ambient point-sprite particle field that pushes itself away from the
 * fighters when they enter `repelRadius`. Used by each arena to make the
 * environment feel reactive: embers swirl out of the way during a clash,
 * fireflies dart aside as a fighter dashes through, etc.
 *
 * Two ways to pass fighter positions:
 *
 *  1. Explicit refs via `playerRef` / `npcRef`. Each ref's `.current` may be
 *     either a fighter-state object (with `position: [x, y, z]`) or a
 *     THREE.Object3D (with `.position`).
 *
 *  2. Implicit, via the module-level registry that SilhouetteFighter populates
 *     every frame. Arenas do not receive the fighter refs as props, so they
 *     mount this component without explicit refs and let the registry feed
 *     the positions in for free.
 *
 * Props:
 *  - playerRef, npcRef: optional fighter refs (see above).
 *  - count:         particle count.
 *  - bounds:        [xRange, yRange, zRange] spawn / drift volume.
 *  - origin:        [x, y, z] volume center.
 *  - color:         sprite color.
 *  - size:          sprite size (world units, sizeAttenuation on).
 *  - opacity:       base opacity (additive blending).
 *  - drift:         base random drift amplitude (units / s).
 *  - repelRadius:   distance at which particles start being pushed away.
 *  - repelStrength: how hard they're pushed (units / s at radius 0).
 *  - damping:       per-second velocity damping (0..1, higher = stickier).
 *  - texture:       optional override sprite texture (defaults to soft glow).
 *  - sizePulseRef:  optional ref whose `.current` is added (multiplicatively)
 *                   to the base sprite size each frame. Arenas can drive this
 *                   from a hit-detection signal to briefly brighten / enlarge
 *                   particles on impact. The arena owns the decay.
 */

const REGISTRY_SIZE = 2;
const registry = [
  { active: false, x: 0, y: 0, z: 0 },
  { active: false, x: 0, y: 0, z: 0 },
];

/**
 * Called from SilhouetteFighter every frame to publish the latest world
 * position of fighter `slot` (0 = player, 1 = npc).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function registerFighterPosition(slot, x, y, z) {
  if (slot < 0 || slot >= REGISTRY_SIZE) return;
  const e = registry[slot];
  e.active = true;
  e.x = x;
  e.y = y;
  e.z = z;
}

/**
 * Resolve a fighter ref into a {x, y, z} reading, or null when the ref is
 * not yet populated. Accepts both stateRef-shaped objects and Object3D refs.
 */
function readRef(ref) {
  if (!ref || !ref.current) return null;
  const c = ref.current;
  if (Array.isArray(c.position)) {
    return { x: c.position[0] || 0, y: c.position[1] || 0, z: c.position[2] || 0 };
  }
  if (c.position && typeof c.position.x === 'number') {
    return { x: c.position.x, y: c.position.y, z: c.position.z };
  }
  return null;
}

export default function RepellingParticles({
  playerRef = null,
  npcRef = null,
  count = 80,
  bounds = [30, 8, 18],
  origin = [0, 2, -4],
  color = '#ffae3b',
  size = 0.14,
  opacity = 0.7,
  drift = 0.25,
  repelRadius = 1.8,
  repelStrength = 6.0,
  damping = 1.6,
  texture = null,
  sizePulseRef = null,
}) {
  const pointsRef = useRef();
  const materialRef = useRef();
  const [bx, by, bz] = bounds;
  const [ox, oy, oz] = origin;

  const sprite = useMemo(() => texture || getGlow(), [texture]);

  // Per-particle buffers, generated once. Positions live on the geometry
  // buffer; velocities and phases live in a parallel typed array so the
  // useFrame loop can integrate them without React reconciliation.
  // useState lazy initializer is the canonical escape hatch for one-time
  // random init: the function only runs on mount, not on every render.
  const [data] = useState(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    const driftScales = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = ox + (Math.random() - 0.5) * bx;
      positions[i * 3 + 1] = oy + (Math.random() - 0.5) * by;
      positions[i * 3 + 2] = oz + (Math.random() - 0.5) * bz;
      velocities[i * 3] = 0;
      velocities[i * 3 + 1] = 0;
      velocities[i * 3 + 2] = 0;
      phases[i] = Math.random() * Math.PI * 2;
      driftScales[i] = 0.5 + Math.random() * 0.5;
    }
    return { positions, velocities, phases, driftScales };
  });

  // Bounds half-extents and inverse-radius for the per-frame loop.
  const hx = bx * 0.5;
  const hy = by * 0.5;
  const hz = bz * 0.5;
  const invR = repelRadius > 1e-4 ? 1 / repelRadius : 0;

  useFrame((state, delta) => {
    const points = pointsRef.current;
    if (!points) return;
    const dt = Math.min(delta || 0.016, 0.05);
    const time = state.clock.elapsedTime;

    // Resolve fighter positions: explicit refs win over registry.
    const r0 = readRef(playerRef) ||
      (registry[0].active ? registry[0] : null);
    const r1 = readRef(npcRef) ||
      (registry[1].active ? registry[1] : null);

    const pos = points.geometry.attributes.position.array;
    const vel = data.velocities;
    const phases = data.phases;
    const driftScales = data.driftScales;

    const dampFactor = Math.exp(-damping * dt);

    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const iy = ix + 1;
      const iz = ix + 2;

      let px = pos[ix];
      let py = pos[iy];
      let pz = pos[iz];

      // --- Repulsion contribution from each fighter -----------------------
      // We treat the fighter as a vertical line so embers that drift up high
      // are still nudged when the fighter is directly below them. Distance
      // is clamped horizontally + a softer vertical component.
      let ax = 0;
      let ay = 0;
      let az = 0;

      if (r0) {
        const dx = px - r0.x;
        const dy = py - (r0.y + 1.0); // aim repulsion at chest height
        const dz = pz - r0.z;
        const distSq = dx * dx + dy * dy * 0.4 + dz * dz;
        const dist = Math.sqrt(distSq);
        if (dist < repelRadius && dist > 1e-4) {
          const falloff = 1 - dist * invR;     // 1 at center, 0 at radius
          const k = repelStrength * falloff * falloff / dist;
          ax += dx * k;
          ay += dy * k;
          az += dz * k;
        }
      }
      if (r1) {
        const dx = px - r1.x;
        const dy = py - (r1.y + 1.0);
        const dz = pz - r1.z;
        const distSq = dx * dx + dy * dy * 0.4 + dz * dz;
        const dist = Math.sqrt(distSq);
        if (dist < repelRadius && dist > 1e-4) {
          const falloff = 1 - dist * invR;
          const k = repelStrength * falloff * falloff / dist;
          ax += dx * k;
          ay += dy * k;
          az += dz * k;
        }
      }

      // --- Ambient drift: smooth pseudo-Brownian motion -------------------
      const phase = phases[i];
      const driftAmp = drift * driftScales[i];
      const dxAmb = Math.sin(time * 0.7 + phase) * driftAmp;
      const dyAmb = Math.cos(time * 0.5 + phase * 1.3) * driftAmp * 0.4;
      const dzAmb = Math.sin(time * 0.6 + phase * 0.7) * driftAmp;

      // Integrate velocity (damped) + ambient drift forcing.
      let vx = vel[ix] * dampFactor + ax * dt;
      let vy = vel[iy] * dampFactor + ay * dt;
      let vz = vel[iz] * dampFactor + az * dt;

      px += (vx + dxAmb) * dt;
      py += (vy + dyAmb) * dt;
      pz += (vz + dzAmb) * dt;

      // --- Soft volume containment: wrap particles back into bounds -------
      const cx = px - ox;
      const cy = py - oy;
      const cz = pz - oz;
      if (cx > hx) { px = ox - hx; vx = 0; }
      else if (cx < -hx) { px = ox + hx; vx = 0; }
      if (cy > hy) { py = oy - hy; vy = 0; }
      else if (cy < -hy) { py = oy + hy; vy = 0; }
      if (cz > hz) { pz = oz - hz; vz = 0; }
      else if (cz < -hz) { pz = oz + hz; vz = 0; }

      pos[ix] = px;
      pos[iy] = py;
      pos[iz] = pz;
      vel[ix] = vx;
      vel[iy] = vy;
      vel[iz] = vz;
    }

    points.geometry.attributes.position.needsUpdate = true;

    // Optional hit pulse: arenas drive this ref to briefly enlarge sprites
    // when a hit lands. We do *not* decay the pulse here; the arena owns the
    // decay so the curve and lifetime can be tuned per environment.
    if (materialRef.current) {
      const pulse = sizePulseRef && typeof sizePulseRef.current === 'number'
        ? sizePulseRef.current
        : 0;
      materialRef.current.size = size * (1 + pulse);
      materialRef.current.opacity = opacity * (1 + pulse * 0.6);
    }
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={data.positions}
          count={count}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        size={size}
        color={color}
        map={sprite}
        alphaMap={sprite}
        transparent
        opacity={opacity}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}
