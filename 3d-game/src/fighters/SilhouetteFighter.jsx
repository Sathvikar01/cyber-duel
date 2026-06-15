import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { registerFighterPosition } from '../arenas/components/RepellingParticles';

/**
 * Linear interpolation helper.
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Backstep phase constants (kept in sync with Game.jsx).
 *
 *   stateTimer is a countdown from BACKSTEP_TOTAL down to 0:
 *     stateTimer in [0.30, 0.35]  -> i-frames (no movement)
 *     stateTimer in [0.12, 0.30]  -> active (dodging backward)
 *     stateTimer in [0,    0.12]  -> recovery (vulnerable)
 *   So the recovery phase begins when stateTimer drops through 0.12.
 */
const BACKSTEP_TOTAL = 0.35;
const BACKSTEP_IFRAME_DURATION = 0.05;
const BACKSTEP_RECOVERY_DURATION = 0.12;
const BACKSTEP_RECOVERY_START = BACKSTEP_RECOVERY_DURATION; // 0.12 - stateTimer value at the start of recovery

/**
 * Deep clone a pose object so we can keep a persistent "current pose" ref
 * that the visual reads from every frame, and smoothly lerp it toward
 * the freshly computed target pose.
 */
function clonePose(p) {
  return {
    hipY: p.hipY,
    torso: [p.torso[0], p.torso[1], p.torso[2]],
    head: [p.head[0], p.head[1], p.head[2]],
    armL: [p.armL[0], p.armL[1], p.armL[2]],
    foreL: [p.foreL[0], p.foreL[1], p.foreL[2]],
    armR: [p.armR[0], p.armR[1], p.armR[2]],
    foreR: [p.foreR[0], p.foreR[1], p.foreR[2]],
    legL: [p.legL[0], p.legL[1], p.legL[2]],
    calfL: [p.calfL[0], p.calfL[1], p.calfL[2]],
    legR: [p.legR[0], p.legR[1], p.legR[2]],
    calfR: [p.calfR[0], p.calfR[1], p.calfR[2]],
  };
}

/**
 * Lerp every channel of `current` toward `target` by `t` (0..1).
 */
function lerpPose(current, target, t) {
  current.hipY += (target.hipY - current.hipY) * t;
  for (let i = 0; i < 3; i++) {
    current.torso[i] += (target.torso[i] - current.torso[i]) * t;
    current.head[i] += (target.head[i] - current.head[i]) * t;
    current.armL[i] += (target.armL[i] - current.armL[i]) * t;
    current.foreL[i] += (target.foreL[i] - current.foreL[i]) * t;
    current.armR[i] += (target.armR[i] - current.armR[i]) * t;
    current.foreR[i] += (target.foreR[i] - current.foreR[i]) * t;
    current.legL[i] += (target.legL[i] - current.legL[i]) * t;
    current.calfL[i] += (target.calfL[i] - current.calfL[i]) * t;
    current.legR[i] += (target.legR[i] - current.legR[i]) * t;
    current.calfR[i] += (target.calfR[i] - current.calfR[i]) * t;
  }
}

/**
 * Attack easing curve: brief wind-up, fast extension, then recovery.
 * Matches the timing used in the legacy Fighter component.
 */
function attackCurve(t) {
  if (t < 0.15) return -(t / 0.15) * 0.3;
  if (t < 0.35) return -0.3 + ((t - 0.15) / 0.2) * 1.3;
  return Math.max(0, 1.0 - (t - 0.35) / 0.65);
}

/**
 * Build the base idle pose for a character.
 *
 * `idleParams` is { stance, anim } where:
 *   stance.legSpread / armSpread / armForward / kneeBend / torsoTilt / headTilt
 *   are character-specific idle-pose offsets (see silhouette.stanceModifier).
 *   anim.breathAmp / breathRate / torsoSwayAmp / torsoSwayRate / ...
 *   drive the per-frame breathing/sway on top of the base pose (see
 *   silhouette.idleAnim).
 *
 * The result is the same shape as the legacy "idle" object so all attack
 * poses that spread `...idle` keep working unchanged.
 */
function computeIdlePose(time, idleParams) {
  const stance = idleParams.stance;
  const a = idleParams.anim;
  return {
    hipY: 1.0 + Math.sin(time * a.breathRate * Math.PI * 2) * a.breathAmp,
    torso: [
      stance.torsoTilt + Math.sin(time * a.torsoSwayRate * Math.PI * 2) * a.torsoSwayAmp,
      0,
      Math.sin(time * a.torsoRollRate * Math.PI * 2) * a.torsoRollAmp,
    ],
    head: [
      stance.headTilt,
      Math.sin(time * a.headScanRate * Math.PI * 2) * a.headScanAmp,
      Math.sin(time * a.headSwayRate * Math.PI * 2) * a.headSwayAmp,
    ],
    armL: [0.5 + stance.armForward, 0, stance.armSpread],
    foreL: [-1.2, 0, 0],
    armR: [0.5 + stance.armForward, 0, -stance.armSpread],
    foreR: [-1.2, 0, 0],
    legL: [-stance.legSpread, 0, 0.08],
    calfL: [stance.kneeBend, 0, 0],
    legR: [stance.legSpread, 0, -0.08],
    calfR: [stance.kneeBend, 0, 0],
  };
}

/**
 * Returns a pose object for the requested animation.
 * The keys are the same rotations exported by the legacy Fighter so this
 * component can be dropped into Game.jsx without touching the game loop.
 *
 * The optional `idleParams` argument shapes the idle pose per character.
 * All other animations spread `...idle` so they inherit the same
 * character-specific offsets (e.g. a stocky monk keeps his wide crouch
 * even mid-jab).
 */
function getPose(anim, progress, time, idleParams) {
  const e = attackCurve(progress);
  // Default idle params match the original Ronin tuning so callers that
  // don't pass anything in (or characters without a silhouette config)
  // still get the legacy behavior.
  const idle = idleParams
    ? computeIdlePose(time, idleParams)
    : {
        hipY: 1.0 + Math.sin(time * 1.9 * Math.PI * 2) * 0.045,
        torso: [
          Math.sin(time * 1.7 * Math.PI * 2) * 0.0525,
          0,
          Math.sin(time * 2.1 * Math.PI * 2) * 0.033,
        ],
        head: [0, 0, Math.sin(time * 2.0 * Math.PI * 2) * 0.0375],
        armL: [0.5, 0, 0.4],
        foreL: [-1.2, 0, 0],
        armR: [0.5, 0, -0.4],
        foreR: [-1.2, 0, 0],
        legL: [-0.15, 0, 0.08],
        calfL: [0.15, 0, 0],
        legR: [0.15, 0, -0.08],
        calfR: [0.1, 0, 0],
      };

  switch (anim) {
    case 'idle':
      return idle;

    case 'walk': {
      const c = Math.sin(time * 10);
      return {
        hipY: 1.0 + Math.abs(Math.cos(time * 10)) * 0.04,
        torso: [0, 0, Math.sin(time * 5) * 0.04],
        head: [0, 0, 0],
        armL: [0.5 - c * 0.3, 0, 0.4],
        foreL: [-1.2, 0, 0],
        armR: [0.5 + c * 0.3, 0, -0.4],
        foreR: [-1.2, 0, 0],
        legL: [-0.15 + c * 0.5, 0, 0.08],
        calfL: [Math.max(0, c * 0.5), 0, 0],
        legR: [0.15 - c * 0.5, 0, -0.08],
        calfR: [Math.max(0, -c * 0.5), 0, 0],
      };
    }

    case 'jab':
      return {
        ...idle,
        hipY: 1.0,
        torso: [0, -0.35 * e, 0],
        armL: [lerp(0.5, -1.5, e), 0, lerp(0.4, 0.05, e)],
        foreL: [lerp(-1.2, -0.1, e), 0, 0],
        legL: [-0.15 - 0.15 * e, 0, 0.08],
      };

    case 'cross':
      return {
        ...idle,
        hipY: 1.0,
        torso: [0, -0.9 * e, 0.1 * e],
        armR: [lerp(0.5, -1.6, e), 0, lerp(-0.4, -0.05, e)],
        foreR: [lerp(-1.2, -0.1, e), 0, 0],
        legR: [0.15 + 0.1 * e, 0, -0.08],
      };

    case 'low_kick':
      return {
        ...idle,
        hipY: 1.0,
        torso: [-0.25 * e, -0.2 * e, 0],
        legR: [lerp(0.15, -1.4, e), 0, lerp(-0.08, 0.4, e)],
        calfR: [lerp(0.1, 0.3, e), 0, 0],
      };

    case 'roundhouse':
      return {
        ...idle,
        hipY: 1.0 + 0.25 * e,
        torso: [-0.3 * e, -1.8 * e, 0],
        legL: [lerp(-0.15, -1.4, e), lerp(0, -0.6, e), lerp(0.08, -1.2, e)],
        calfL: [lerp(0.15, 0, e), 0, 0],
        armL: [lerp(0.5, 0.8, e), 0, lerp(0.4, 0.8, e)],
        armR: [lerp(0.5, 0.8, e), 0, lerp(-0.4, -0.8, e)],
      };

    case 'uppercut':
      return {
        ...idle,
        hipY: 1.0 + 0.35 * e,
        torso: [lerp(0, -0.25, e), 0, 0],
        armR: [lerp(0.5, -2.6, e), 0, lerp(-0.4, 0, e)],
        foreR: [lerp(-1.2, -0.6, e), 0, 0],
        legL: [lerp(-0.15, -0.5, e), 0, 0.08],
        calfL: [lerp(0.15, 0.5, e), 0, 0],
        legR: [lerp(0.15, -0.4, e), 0, -0.08],
        calfR: [lerp(0.1, 0.4, e), 0, 0],
      };

    case 'hit':
      return {
        ...idle,
        hipY: 0.95,
        torso: [0.3, 0, -0.15],
        head: [0.4, 0, 0.2],
        armL: [0.8, 0, 0.7],
        foreL: [-0.5, 0, 0],
        armR: [0.8, 0, -0.7],
        foreR: [-0.5, 0, 0],
      };

    case 'block':
      return {
        ...idle,
        hipY: 0.95,
        torso: [0.1, 0, 0],
        armL: [-0.3, 0, 0.8],
        foreL: [-1.8, 0, 0],
        armR: [-0.3, 0, -0.8],
        foreR: [-1.8, 0, 0],
      };

    case 'parry':
      return {
        ...idle,
        hipY: 0.95,
        torso: [0, 0, 0.15],
        armL: [-0.6, 0, 1.2],
        foreL: [-1.4, 0, 0],
        armR: [-0.6, 0, -1.2],
        foreR: [-1.4, 0, 0],
      };

    case 'backstep': {
      const e2 = 1 - progress;
      return {
        ...idle,
        hipY: 0.95,
        torso: [0, 0.25 * e2, 0],
        armL: [0.8, 0, 0.7],
        foreL: [-1.4, 0, 0],
        armR: [0.8, 0, -0.7],
        foreR: [-1.4, 0, 0],
        legL: [-0.45 * e2, 0, 0.08],
        calfL: [0.4 * e2, 0, 0],
        legR: [0.55 * e2, 0, -0.08],
        calfR: [0.35 * e2, 0, 0],
      };
    }

    case 'clinch':
      return {
        ...idle,
        hipY: 0.95,
        torso: [0, 0, 0.05],
        armL: [-1.1, 0, 1.1],
        foreL: [-1.4, 0, 0],
        armR: [-1.1, 0, -1.1],
        foreR: [-1.4, 0, 0],
        legL: [-0.25, 0, 0.08],
        legR: [0.25, 0, -0.08],
      };

    case 'throw': {
      const et = attackCurve(progress);
      return {
        ...idle,
        hipY: 0.9 + 0.15 * et,
        torso: [0, 0, -0.2 * et],
        armL: [lerp(0.5, -1.4, et), 0, lerp(0.4, 0.9, et)],
        foreL: [lerp(-1.2, -0.6, et), 0, 0],
        armR: [lerp(0.5, -1.4, et), 0, lerp(-0.4, -0.9, et)],
        foreR: [lerp(-1.2, -0.6, et), 0, 0],
        legL: [-0.3 * et, 0, 0.08],
        legR: [0.3 + 0.3 * et, 0, -0.08],
      };
    }

    case 'flinch':
      return {
        ...idle,
        hipY: 0.9,
        torso: [0.15, 0, -0.2],
        head: [0.25, 0, 0.15],
        armL: [0.9, 0, 0.8],
        foreL: [-0.6, 0, 0],
        armR: [0.9, 0, -0.8],
        foreR: [-0.6, 0, 0],
      };

    case 'stumble': {
      const st = Math.min(1, progress * 2);
      return {
        ...idle,
        hipY: 0.85 - 0.15 * st,
        torso: [0.35 * st, 0, -0.35 * st],
        head: [0.4 * st, 0, 0.25 * st],
        armL: [1.0, 0, 0.9],
        foreL: [-0.4, 0, 0],
        armR: [1.0, 0, -0.9],
        foreR: [-0.4, 0, 0],
        legL: [-0.3 * st, 0, 0.08],
        calfL: [0.2 * st, 0, 0],
        legR: [0.2 * st, 0, -0.08],
        calfR: [0.25 * st, 0, 0],
      };
    }

    case 'knockdown':
      return {
        ...idle,
        hipY: 0.45,
        torso: [1.25, 0, 0],
        head: [0.6, 0, 0],
        armL: [0.9, 0, 0.8],
        foreL: [-0.5, 0, 0],
        armR: [0.9, 0, -0.8],
        foreR: [-0.5, 0, 0],
        legL: [-0.4, 0, 0.08],
        calfL: [0.8, 0, 0],
        legR: [0.2, 0, -0.08],
        calfR: [0.7, 0, 0],
      };

    case 'fall':
      return {
        ...idle,
        hipY: 0.12,
        torso: [1.45, 0, 0],
        head: [0.3, 0, 0],
        armL: [0.4, 0, 0.6],
        foreL: [-0.2, 0, 0],
        armR: [0.4, 0, -0.6],
        foreR: [-0.2, 0, 0],
        legL: [-0.1, 0, 0.08],
        calfL: [0.1, 0, 0],
        legR: [0.1, 0, -0.08],
        calfR: [0.1, 0, 0],
      };

    case 'getup': {
      const gu = Math.min(1, progress * 1.5);
      return {
        ...idle,
        hipY: 0.2 + 0.8 * gu,
        torso: [1.45 * (1 - gu), 0, 0],
        head: [0.3 * (1 - gu), 0, 0],
        armL: [0.4 + 0.5 * gu, 0, 0.6 - 0.2 * gu],
        foreL: [-0.2 - 1.0 * gu, 0, 0],
        armR: [0.4 + 0.5 * gu, 0, -0.6 + 0.2 * gu],
        foreR: [-0.2 - 1.0 * gu, 0, 0],
        legL: [-0.1 + 0.05 * gu, 0, 0.08],
        calfL: [0.1 - 0.05 * gu, 0, 0],
        legR: [0.1 - 0.05 * gu, 0, -0.08],
        calfR: [0.1 - 0.05 * gu, 0, 0],
      };
    }

    default:
      return idle;
  }
}

/**
 * SilhouetteFighter
 *
 * A flat, orthographic-friendly fighter replacement. Built from near-black
 * MeshBasicMaterial shapes with thin accent strips that suggest form. It uses
 * the same ref hierarchy and stateRef shape as the legacy Fighter component.
 *
 * Props:
 *  - stateRef:           mutable ref with position, facing, anim, animProgress, isHit
 *  - character:          fighter config object (see fighterConfigs.js)
 *  - isPlayer:           boolean, currently unused by the visual but reserved for UI
 *  - onFootstep:         (worldPos, { intensity }) => void, fires on walk foot-down
 *                        events, backstep slide ticks, and knockdown/fall landings.
 *  - onBackstepLanding:  (worldPos) => void, fires once when a backstep transitions
 *                        from its active dodge phase into the recovery phase.
 */
export default function SilhouetteFighter({
  stateRef,
  character,
  isPlayer,
  onFootstep,
  onBackstepLanding,
}) {
  // --- Ref hierarchy (must match Fighter.jsx exactly) ----------------------
  const groupRef = useRef();
  const charRef = useRef(); // inner group that is horizontally flipped

  const hipRef = useRef();
  const torsoRef = useRef();
  const headRef = useRef();
  const armLRef = useRef();
  const foreLRef = useRef();
  const armRRef = useRef();
  const foreRRef = useRef();
  const legLRef = useRef();
  const calfLRef = useRef();
  const legRRef = useRef();
  const calfRRef = useRef();

  // --- Procedural physics state -------------------------------------------
  const currentPoseRef = useRef(null);
  const leanRef = useRef(0);
  const prevStrideRef = useRef(0);
  const backstepDustTimerRef = useRef(0);
  const prevBackstepStateTimerRef = useRef(0);
  const prevAnimProgressRef = useRef(0);

  // --- Materials -----------------------------------------------------------
  // The body uses MeshStandardMaterial so it responds to the arena's
  // directional/ambient lights and gains visible form instead of reading as
  // a flat black cutout. The accent emissive gives a subtle "shadow energy"
  // pulse through the dark silhouette, brightening on hit.
  //
  // Slightly less rough than before (0.75) so the surfaces pick up subtle
  // sheen, smooth shading so the rounded primitives (capsules / rounded
  // boxes) read as continuous form rather than faceted polygons.
  const silhouetteMatRef = useRef(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(character.bodyColor),
      roughness: 0.75,
      metalness: 0.05,
      flatShading: false,
      envMapIntensity: 0.4,
      emissive: new THREE.Color(character.accentColor),
      emissiveIntensity: 0.08,
      side: THREE.DoubleSide,
    })
  );
  // Accent strips use additive blending and live inside the body so they
  // read as internal energy rather than a surface decal.
  const accentMatRef = useRef(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(character.accentColor),
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );

  // --- Glow halo texture (radial gradient, white; tinted via material.color).
  // Generated once and reused for every fighter.
  const glowTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 128, 0, 64, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,0.4)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  // --- Soft contact shadow texture (radial gradient, oval, transparent edges).
  const shadowTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 32, 0, 64, 32, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.6)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  // Per-character material for the inner glow plane; tint the shared
  // white texture with the character's accent color.
  const glowMatRef = useRef(
    new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: new THREE.Color(character.accentColor),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
  );
  // Per-character material for the soft contact shadow; use the soft
  // gradient texture with a near-black tint and reduced overall opacity.
  const softShadowMatRef = useRef(
    new THREE.MeshBasicMaterial({
      map: shadowTexture,
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  );

  // Keep materials in sync if the character config ever changes.
  useEffect(() => {
    silhouetteMatRef.current.color.set(character.bodyColor);
    silhouetteMatRef.current.emissive.set(character.accentColor);
    accentMatRef.current.color.set(character.accentColor);
    glowMatRef.current.color.set(character.accentColor);
  }, [character.bodyColor, character.accentColor]);

  // --- Per-character idle parameters ---------------------------------------
  // Pull the idle-pose stance offsets and breathing/sway amplitudes from
  // the silhouette config. Falls back to the legacy Ronin-style numbers
  // when the character has no silhouette (or no idleAnim block) so older
  // configs keep rendering correctly.
  const idleParams = useMemo(() => {
    const s = character.silhouette || {};
    const sm = s.stanceModifier || {};
    const ia = s.idleAnim || {};
    return {
      stance: {
        torsoTilt: sm.torsoTilt ?? 0.0,
        armForward: sm.armForward ?? 0.0,
        armSpread: sm.armSpread ?? 0.4,
        legSpread: sm.legSpread ?? 0.15,
        kneeBend: sm.kneeBend ?? 0.15,
        headTilt: sm.headTilt ?? 0.0,
      },
      anim: {
        breathAmp: ia.breathAmp ?? 0.045,
        breathRate: ia.breathRate ?? 1.9,
        torsoSwayAmp: ia.torsoSwayAmp ?? 0.0525,
        torsoSwayRate: ia.torsoSwayRate ?? 1.7,
        torsoRollAmp: ia.torsoRollAmp ?? 0.033,
        torsoRollRate: ia.torsoRollRate ?? 2.1,
        headSwayAmp: ia.headSwayAmp ?? 0.0375,
        headSwayRate: ia.headSwayRate ?? 2.0,
        headScanAmp: ia.headScanAmp ?? 0.0,
        headScanRate: ia.headScanRate ?? 0.0,
        weightShiftAmp: ia.weightShiftAmp ?? 0.03,
        weightShiftRate: ia.weightShiftRate ?? 3.2,
        chestExpand: ia.chestExpand ?? 0.01,
      },
    };
  }, [character]);

  // --- Per-frame update ----------------------------------------------------
  useFrame((state, delta) => {
    if (!groupRef.current || !charRef.current) return;

    const s = stateRef.current;
    const time = state.clock.elapsedTime;
    const dt = Math.min(delta || 0.016, 0.05);

    // Root placement.
    groupRef.current.position.set(s.position[0], s.position[1] || 0, s.position[2] || 0);

    // Publish position to the shared fighter registry so environment
    // systems (e.g. RepellingParticles) can react without needing direct
    // refs through arena component props.
    registerFighterPosition(
      isPlayer ? 0 : 1,
      groupRef.current.position.x,
      groupRef.current.position.y,
      groupRef.current.position.z
    );

    // Horizontal flip based on facing. Positive facing => scale.x positive.
    const dir = s.facing > 0 ? 1 : -1;
    const bs = character.bodyScale;
    charRef.current.scale.x += (dir * bs - charRef.current.scale.x) * 0.15;
    charRef.current.scale.y += (bs - charRef.current.scale.y) * 0.15;
    charRef.current.scale.z += (bs - charRef.current.scale.z) * 0.15;

    // Resolve target pose and lazily clone on first frame. The idle pose
    // (and therefore the base for all `...idle` spreads) is parameterized
    // by the character's silhouette.stanceModifier + silhouette.idleAnim.
    const targetPose = getPose(s.anim, s.animProgress || 0, time, idleParams);
    if (!currentPoseRef.current) {
      currentPoseRef.current = clonePose(targetPose);
    }

    // Weight-driven lerp: heavier fighters (weight > 1) lerp slower, which
    // gives them a more deliberate, weighty transition between poses.
    const weight = (character.physics && character.physics.weight) || 1.0;
    const baseRate = 12.0;
    const rate = baseRate / Math.max(0.05, weight);
    const lerpT = 1 - Math.exp(-rate * dt);
    lerpPose(currentPoseRef.current, targetPose, lerpT);
    const cp = currentPoseRef.current;

    // Procedural lean: torso tilts back when moving forward, forward when
    // retreating. Smoothly lerps so it picks up the velocity-based model
    // from the game loop.
    const forwardVel = (s.velX || 0) * (s.facing || 1);
    const targetLean = -forwardVel * 0.09;
    leanRef.current += (targetLean - leanRef.current) * 8.0 * dt;

    // Decay impact tilts (~0.15s). These are set by Game.jsx on a landed hit
    // and we add them to the torso's X rotation to sell weight transfer.
    if (s.attackerPushbackTilt > 0) {
      s.attackerPushbackTilt = Math.max(0, s.attackerPushbackTilt - 0.2 * dt / 0.15);
    }
    if (s.knockbackTilt > 0) {
      s.knockbackTilt = Math.max(0, s.knockbackTilt - 0.25 * dt / 0.15);
    }

    // Apply hip height relative to the fighter's configured stance offset.
    if (hipRef.current) {
      hipRef.current.position.y = character.stanceOffset + (cp.hipY - 1.0);
    }

    const applyRot = (ref, rot) => {
      if (ref.current) {
        ref.current.rotation.x = rot[0];
        ref.current.rotation.y = rot[1];
        ref.current.rotation.z = rot[2];
      }
    };

    // Torso receives the procedural lean and the impact tilts in addition
    // to the lerped pose. The lean comes from velocity; tilts come from hits.
    // While idle, an additional slow "weight shift" sway on the Z axis sells
    // the fighter unconsciously redistributing their balance from foot to
    // foot. The amplitude and period come from silhouette.idleAnim so each
    // character breathes at their own tempo and depth.
    const torsoTilt =
      (s.attackerPushbackTilt || 0) -
      (s.knockbackTilt || 0) +
      leanRef.current;
    const idleWeight = s.anim === 'idle' ? 1 : 0;
    const ia = idleParams.anim;
    const weightShiftZ =
      Math.sin(time * (Math.PI * 2 / ia.weightShiftRate)) * ia.weightShiftAmp * idleWeight;
    applyRot(torsoRef, [
      cp.torso[0] + torsoTilt,
      cp.torso[1],
      cp.torso[2] + weightShiftZ,
    ]);

    // Breathing: subtle vertical expansion of the upper body. The peak
    // amplitude is chestExpand (e.g. 0.01 = 1% scale, 0.025 = 2.5% for the
    // Champion) and the cycle period is breathRate seconds. We taper the
    // effect away from idle so attack/hit poses keep their authored
    // silhouette unchanged.
    if (torsoRef.current) {
      const breath = 1 + ia.chestExpand * (1 + Math.sin(time * (Math.PI * 2 / ia.breathRate))) * idleWeight;
      torsoRef.current.scale.y = breath;
    }
    applyRot(headRef, cp.head);
    applyRot(armLRef, cp.armL);
    applyRot(foreLRef, cp.foreL);
    applyRot(armRRef, cp.armR);
    applyRot(foreRRef, cp.foreR);
    applyRot(legLRef, cp.legL);
    applyRot(calfLRef, cp.calfL);
    applyRot(legRRef, cp.legR);
    applyRot(calfRRef, cp.calfR);

    // Hit flash: swap silhouette to the accent color for the hit window
    // and boost the inner emissive intensity so the shadow energy flares.
    if (s.isHit) {
      silhouetteMatRef.current.color.set(character.accentColor);
      silhouetteMatRef.current.emissiveIntensity = 0.35;
      accentMatRef.current.opacity = 1.0;
    } else {
      silhouetteMatRef.current.color.set(character.bodyColor);
      silhouetteMatRef.current.emissiveIntensity = 0.08;
      accentMatRef.current.opacity = 0.5;
    }

    // ----- Procedural VFX events -----------------------------------------

    // Walk foot-down detection: detect zero-crossings of the stride sine
    // and fire dust on each foot plant.
    if (s.anim === 'walk') {
      const c = Math.sin(time * 10);
      const prevC = prevStrideRef.current;
      const fx = groupRef.current.position.x;
      const fz = groupRef.current.position.z;
      if (prevC > 0 && c <= 0) {
        // Sine crossed positive -> non-positive: left foot plant.
        onFootstep?.([fx - 0.18 * dir, 0.05, fz], { intensity: 1.0, type: 'walk' });
      } else if (prevC < 0 && c >= 0) {
        // Sine crossed negative -> non-negative: right foot plant.
        onFootstep?.([fx + 0.18 * dir, 0.05, fz], { intensity: 1.0, type: 'walk' });
      }
      prevStrideRef.current = c;
    } else {
      prevStrideRef.current = 0;
    }

    // Backstep slide dust: throttled continuous emission while the fighter
    // is in the post-i-frame phase of the dodge (active + recovery).
    if (
      s.anim === 'backstep' &&
      s.stateTimer > 0 &&
      s.stateTimer < BACKSTEP_TOTAL - BACKSTEP_IFRAME_DURATION
    ) {
      backstepDustTimerRef.current += dt;
      if (backstepDustTimerRef.current >= 0.06) {
        backstepDustTimerRef.current = 0;
        const fx = groupRef.current.position.x;
        const fz = groupRef.current.position.z;
        onFootstep?.([fx, 0.05, fz], { intensity: 0.6, type: 'slide' });
      }
    } else {
      backstepDustTimerRef.current = 0;
    }

    // Backstep landing event: stateTimer crosses from active into recovery.
    // This is the moment the backstepper plants and is vulnerable again.
    const prevTimer = prevBackstepStateTimerRef.current;
    if (
      s.anim === 'backstep' &&
      prevTimer >= BACKSTEP_RECOVERY_START &&
      s.stateTimer < BACKSTEP_RECOVERY_START
    ) {
      onBackstepLanding?.([
        groupRef.current.position.x,
        0.05,
        groupRef.current.position.z,
      ]);
    }
    prevBackstepStateTimerRef.current = s.stateTimer || 0;

    // Knockdown / fall landing dust: emit once when the animation crosses
    // progress 0.7, the moment the body hits the ground.
    if (s.anim === 'knockdown' || s.anim === 'fall') {
      const prog = s.animProgress || 0;
      const prevProg = prevAnimProgressRef.current;
      if (prevProg < 0.7 && prog >= 0.7) {
        const fx = groupRef.current.position.x;
        const fz = groupRef.current.position.z;
        onFootstep?.([fx, 0.05, fz], { intensity: 1.4, type: 'landing' });
      }
      prevAnimProgressRef.current = prog;
    } else {
      prevAnimProgressRef.current = 0;
    }
  });

  // --- Silhouette config (preferred over legacy torsoScale/limbScale/etc.) -
  // If the character defines a `silhouette` object we use those fields to
  // drive the unique body shape. Otherwise we fall back to the legacy scales
  // so older configs keep rendering correctly.
  const silhouette = character.silhouette || {};
  const shoulderWidth = silhouette.shoulderWidth ?? 1.0;
  const waistNarrow = silhouette.waistNarrow ?? 0.0;
  const hipWidth = silhouette.hipWidth ?? 1.0;
  const armLengthMul = silhouette.armLength ?? 1.0;
  const armThicknessMul = silhouette.armThickness ?? 1.0;
  const legThicknessMul = silhouette.legThickness ?? 1.0;
  const legStyle = silhouette.legStyle || 'straight';

  // --- Proportions derived from the character config -----------------------
  // The silhouette is composed of composite shapes for clear anatomical
  // reading in side view: tapered limbs (cylinders with different top/bottom
  // radii), a chest+waist torso with shoulder mass, a defined neck, and a
  // larger head with chin suggestion. All multipliers from
  // character.silhouette are preserved so character differentiation still
  // works.
  const { torsoScale, headScale, limbScale, handScale } = character;

  // Per-character body proportions (silhouette.proportions). These are the
  // multipliers that make the four fighters read as fundamentally different
  // body types: a stocky monk vs. a tall slim assassin vs. a massive
  // champion. Default to 1.0 (no change) when not configured.
  const proportions = silhouette.proportions || {};
  const pTorsoW = proportions.torsoW ?? 1.0;
  const pTorsoH = proportions.torsoH ?? 1.0;
  const pArmW = proportions.armW ?? 1.0;
  const pArmH = proportions.armH ?? 1.0;
  const pLegW = proportions.legW ?? 1.0;
  const pLegH = proportions.legH ?? 1.0;
  const pHeadW = proportions.headW ?? 1.0;
  const pHeadH = proportions.headH ?? 1.0;
  const pHeadD = proportions.headD ?? 1.0;

  // --- Torso anatomy: chest (upper 60%) + waist (lower 40%) + shoulder mass.
  // shoulderWidth drives the chest width; waistNarrow makes the waist narrower.
  const chestW = 0.50 * torsoScale * shoulderWidth * pTorsoW;
  const chestH = 0.45 * torsoScale * pTorsoH;
  const waistW = chestW * (1.0 - waistNarrow * 0.18);
  const waistH = 0.30 * torsoScale * pTorsoH;
  const torsoD = 0.20 * torsoScale * pTorsoW; // 0.18-0.22 for 2.5D volume

  // Legacy torsoW/torsoH used by character accessories (sash, katana sheath,
  // shoulder pads). Average width and total height of the composite torso.
  const torsoW = (chestW + waistW) / 2;
  const torsoH = chestH + waistH;

  // Shoulder mass: subtle boxes on each side of the upper chest, blending
  // into the arms. Distinct from silhouette.hasShoulderPads (a character
  // accessory that adds bulky armor on top of the shoulder mass).
  const shoulderMassW = 0.08 * torsoScale;
  const shoulderMassH = 0.12 * torsoScale;
  const shoulderMassD = torsoD;

  // Leg style adjusts the relative width of the thigh (leg) vs the calf
  // so silhouettes like "hakama" flare at the top and "armored" stay bulky.
  const legStyleMult = (() => {
    switch (legStyle) {
      case 'hakama':
        return { thigh: 1.25, calf: 0.85 };
      case 'baggy':
        return { thigh: 1.3, calf: 0.9 };
      case 'armored':
        return { thigh: 1.2, calf: 1.15 };
      case 'straight':
      default:
        return { thigh: 1.0, calf: 1.0 };
    }
  })();

  // --- Arms: tapered cylinders.
  // Upper arm: wider at shoulder (1.2x), narrower at elbow (0.85x).
  // Forearm: narrower at elbow (0.9x), slightly wider at wrist (1.0x).
  const armW = 0.11 * limbScale * armThicknessMul * pArmW;
  const armH = 0.34 * limbScale * armLengthMul * pArmH;
  // CapsuleGeometry is uniform-radius, so we use the average of the old
  // top/bottom cylinder radii. Total capsule height = length + 2*radius,
  // so length = armH - 2*radius so the limb still spans the same distance.
  const upperArmR = armW * 0.50;
  const upperArmLen = Math.max(0.02, armH - 2 * upperArmR);

  const foreW = 0.09 * limbScale * armThicknessMul * pArmW;
  const foreH = 0.3 * limbScale * armLengthMul * pArmH;
  const foreR = foreW * 0.45;
  const foreLen = Math.max(0.02, foreH - 2 * foreR);

  // Hand: enlarged rounded box for impact readability (the rounded edges
  // read as a fist from the side while keeping the silhouette clean).
  const handR = 0.08 * handScale;
  const handW = handR * 1.75;
  const handH = handR * 1.5;
  const handD = handR * 1.15;

  // --- Legs: tapered cylinders.
  // Thigh: wider at hip (1.3x), narrower at knee (0.85x).
  // Calf: wider at knee (0.9x), narrower at ankle (0.7x).
  const legW = 0.13 * limbScale * legThicknessMul * hipWidth * legStyleMult.thigh * pLegW;
  const legH = 0.42 * limbScale * pLegH;
  // Thigh uses a wider capsule (closer to the old top radius) so the upper
  // leg reads as muscular. Calf uses a smaller radius (closer to the old
  // bottom radius) to suggest the natural ankle taper.
  const thighR = legW * 0.55;
  const thighLen = Math.max(0.02, legH - 2 * thighR);

  const calfW = 0.11 * limbScale * legThicknessMul * legStyleMult.calf * pLegW;
  const calfH = 0.42 * limbScale * pLegH;
  const calfR = calfW * 0.40; // slightly narrower for ankle taper
  const calfLen = Math.max(0.02, calfH - 2 * calfR);

  // --- Joint detail radii (small spheres placed at the elbow / knee /
  // ankle to suggest bone landmarks without huge bulges).
  const elbowR = Math.max(upperArmR, foreR) * 1.05;
  const kneeR = Math.max(thighR, calfR) * 1.05;
  const ankleR = calfR * 0.85;

  // --- Foot: wide box for grounding. Boot fighters get extra width/depth.
  const bootMul = silhouette.hasBoots ? 1.4 : 1.0;
  const footW = 0.14 * limbScale * bootMul; // ~1.4x ankle width
  const footH = silhouette.hasBoots ? 0.09 : 0.06;
  const footD = 0.24 * limbScale * bootMul;

  // Wrapped hands: thicker accent strips on the forearms. The accent strips
  // for the arms/forearms are scaled up below when this is true.
  const wrapMul = silhouette.hasWrappedHands ? 1.6 : 1.0;

  // Gauntlet thickness factor used for the extra forearm geometry.
  const gauntletMul = silhouette.hasGauntlets ? 1.2 : 1.0;

  // Head shape tweaks the base head box proportions so each character has
  // a distinct skull silhouette in addition to the head accessories.
  const headShape = silhouette.headShape || 'round';
  const headShapeMult = (() => {
    switch (headShape) {
      case 'square':
        return { w: 1.15, h: 0.92, d: 1.1 };
      case 'angular':
        return { w: 0.9, h: 1.1, d: 0.95 };
      case 'hooded':
        return { w: 1.0, h: 1.0, d: 1.0 };
      case 'round':
      default:
        return { w: 1.0, h: 1.0, d: 1.0 };
    }
  })();

  const headW = 0.32 * headScale * headShapeMult.w * pHeadW;
  const headH = 0.36 * headScale * headShapeMult.h * pHeadH;
  const headD = 0.18 * headScale * headShapeMult.d * pHeadD;

  // Chin: small box at the bottom-front of the head.
  const chinW = 0.20 * headScale * pHeadW;
  const chinH = 0.09 * headScale * pHeadH;
  const chinD = 0.16 * headScale * pHeadD;

  // Neck: short capsule between head and torso.
  const neckH = 0.08;
  const neckR = 0.09;

  // --- Shared geometries (created once, reused) ---------------------------
  // All body primitives live in this single useMemo so they're allocated
  // once per fighter and disposed on unmount. Limb pieces use
  // CapsuleGeometry for smooth, pill-shaped forms; torso / head / feet /
  // hands use RoundedBoxGeometry for soft edges; joint details use small
  // spheres. Segments kept moderate to balance silhouette quality with
  // per-instance vertex cost.
  const geoms = useMemo(
    () => ({
      // Limbs — capsule primitives (radius, length, capSegs, radialSegs)
      upperArm: new THREE.CapsuleGeometry(upperArmR, upperArmLen, 4, 10),
      forearm: new THREE.CapsuleGeometry(foreR, foreLen, 4, 10),
      thigh: new THREE.CapsuleGeometry(thighR, thighLen, 4, 12),
      calf: new THREE.CapsuleGeometry(calfR, calfLen, 4, 10),
      neck: new THREE.CapsuleGeometry(neckR, neckH * 0.5, 4, 10),

      // Torso — rounded boxes for chest, waist, and shoulder mass
      chest: new RoundedBoxGeometry(chestW, chestH, torsoD, 3, 0.045),
      waist: new RoundedBoxGeometry(waistW, waistH, torsoD * 0.92, 3, 0.04),
      shoulderMass: new RoundedBoxGeometry(
        shoulderMassW, shoulderMassH, shoulderMassD, 3, 0.025,
      ),

      // Collarbones — thin rounded boxes, scaled to wrap from the top of
      // the chest out to the shoulder mass.
      collarbone: new RoundedBoxGeometry(0.20, 0.025, 0.05, 2, 0.012),

      // Head — rounded box; segments bumped to 5 so the curve reads
      // smoothly even with the angular / square head shapes.
      head: new RoundedBoxGeometry(headW, headH, headD, 5, 0.05),
      chin: new RoundedBoxGeometry(chinW, chinH, chinD, 3, 0.022),

      // Hand — rounded box fist
      hand: new RoundedBoxGeometry(handW, handH, handD, 3, 0.025),

      // Wrist line — thin rounded ring at the wrist joint
      wristLine: new RoundedBoxGeometry(foreR * 2.2, 0.018, foreR * 2.2, 2, 0.008),

      // Joint landmarks — small spheres at elbows and knees
      elbow: new THREE.SphereGeometry(elbowR, 10, 8),
      knee: new THREE.SphereGeometry(kneeR, 10, 8),
      ankle: new THREE.SphereGeometry(ankleR, 8, 6),

      // Foot — wide rounded box for grounding
      foot: new RoundedBoxGeometry(footW, footH, footD, 3, 0.018),

      // Boot shaft — chunky boot geometry wrapping the ankle
      bootShaft: new RoundedBoxGeometry(
        calfW * 1.18, footH * 1.6, footD * 0.85, 3, 0.02,
      ),

      // Shoulder pads / sash / katana sheath / hood / scarf / topknot /
      // mohawk / headband / prayer beads / twin daggers / pauldron.
      // These are silhouette accessories, not body primitives. They use
      // RoundedBoxGeometry / CapsuleGeometry so they pick up the same soft
      // edge language as the rest of the body.
      shoulderPad: new RoundedBoxGeometry(0.18, 0.20, 0.22, 3, 0.04),
      sash: new RoundedBoxGeometry(torsoW * 1.35, 0.10, 0.035, 3, 0.025),
      // Katana sheath: long thin capsule. Sized from the torso height so
      // it always reaches from waist to knee regardless of proportions.
      sheath: new THREE.CapsuleGeometry(
        0.045, Math.max(0.05, torsoH * 1.55), 4, 10,
      ),
      // Topknot: tall narrow rounded box on the crown. Ronin signature.
      topknot: new RoundedBoxGeometry(0.09, 0.30, 0.09, 3, 0.025),
      // Headband: thin angular band wrapping the forehead.
      headband: new RoundedBoxGeometry(headW * 1.10, 0.05, headD * 1.05, 2, 0.012),
      // Hood: large drape behind the head, taller/wider than the head.
      hoodDrape: new RoundedBoxGeometry(headW * 1.55, headH * 1.45, headD * 1.2, 4, 0.05),
      // Hood tip: tall narrow rounded box, biased backward to give the
      // hood a sharp pointed silhouette.
      hoodTip: new RoundedBoxGeometry(0.10, 0.36, 0.12, 3, 0.03),
      // Mohawk: tall narrow ridge running from forehead to back of head.
      mohawk: new RoundedBoxGeometry(0.08, 0.20, headD * 1.55, 3, 0.025),
      // Scarf: long thin capsule trailing from the neck. Capsule gives a
      // soft cloth-like silhouette as it tapers at both ends.
      scarf: new THREE.CapsuleGeometry(0.05, Math.max(0.05, headH * 1.1), 4, 10),
      // Prayer beads: a single small sphere reused for each bead loop.
      prayerBead: new THREE.SphereGeometry(0.025, 10, 8),
      // Twin daggers: thin sheathed blades on each thigh.
      dagger: new RoundedBoxGeometry(0.04, 0.26, 0.05, 2, 0.012),
      // Pauldron: a large rounded box on the lead shoulder. Champion.
      pauldron: new RoundedBoxGeometry(0.20, 0.22, 0.26, 4, 0.045),
      // Gauntlet: chunky solid forearm armor. Sits over the forearm.
      gauntlet: new RoundedBoxGeometry(
        Math.max(0.08, foreW * 1.35 * gauntletMul),
        foreH * 0.75,
        Math.max(0.08, foreW * 1.25 * gauntletMul),
        3, 0.03,
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      armH, upperArmR, upperArmLen,
      foreH, foreR, foreLen,
      legH, thighR, thighLen,
      calfH, calfR, calfLen,
      neckH, neckR,
      chestW, chestH, torsoD,
      waistW, waistH,
      shoulderMassW, shoulderMassH, shoulderMassD,
      headW, headH, headD,
      chinW, chinH, chinD,
      handW, handH, handD,
      elbowR, kneeR, ankleR,
      footW, footH, footD,
      calfW, torsoH,
    ],
  );

  // Dispose geometries on unmount or when they change.
  useEffect(
    () => () => {
      Object.values(geoms).forEach((g) => g.dispose());
    },
    [geoms],
  );

  const sm = silhouetteMatRef.current;
  const am = accentMatRef.current;

  // --- Helpers for accent lines -------------------------------------------
  const accent = (w, h, d, pos, rot) => (
    <mesh position={pos} rotation={rot || [0, 0, 0]} material={am}>
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );

  // --- Body part builders --------------------------------------------------
  // Defined as functions inside the component so they share the component's
  // closure (refs, materials, dimensions, accent helper, silhouette config).

  // Torso: chest (upper 60%) + waist (lower 40%) + shoulder mass on each
  // side of the upper chest, plus collarbones at the top of the chest and
  // any character-specific accessories (shoulder pads, sash, katana sheath)
  // that attach to the torso.
  const buildTorso = () => {
    const chestCenterY = waistH / 2;
    const waistCenterY = -chestH / 2;
    const shoulderMassY = chestCenterY + chestH / 2 - shoulderMassH * 0.4;
    // Collarbone row sits just under the shoulder mass, at the top of the
    // chest. Two thin rounded boxes angled outward.
    const collarY = chestCenterY + chestH / 2 - 0.04;
    return (
      <group>
        {/* Chest (upper 60% of torso) — rounded box */}
        <mesh
          material={sm}
          castShadow
          position={[0, chestCenterY, 0]}
          geometry={geoms.chest}
        />
        {/* Waist (lower 40% of torso) — rounded box, slightly narrower */}
        <mesh
          material={sm}
          castShadow
          position={[0, waistCenterY, 0]}
          geometry={geoms.waist}
        />
        {/* Shoulder mass on each side of the upper chest — rounded box */}
        <mesh
          material={sm}
          castShadow
          position={[-(chestW / 2 + shoulderMassW * 0.25), shoulderMassY, 0]}
          geometry={geoms.shoulderMass}
        />
        <mesh
          material={sm}
          castShadow
          position={[(chestW / 2 + shoulderMassW * 0.25), shoulderMassY, 0]}
          geometry={geoms.shoulderMass}
        />
        {/* Collarbones: two thin angled rounded boxes meeting at the
            sternum and reaching out to the shoulder mass. Sits on the
            front face of the chest. */}
        <mesh
          material={sm}
          castShadow
          position={[-(chestW * 0.20), collarY, torsoD / 2 - 0.015]}
          rotation={[0, 0, 0.42]}
          geometry={geoms.collarbone}
        />
        <mesh
          material={sm}
          castShadow
          position={[(chestW * 0.20), collarY, torsoD / 2 - 0.015]}
          rotation={[0, 0, -0.42]}
          geometry={geoms.collarbone}
        />

        {/* Torso sash / center accent (internal energy) — runs down the
            CENTER of the chest, reads as a glow through the silhouette. */}
        {accent(0.04, torsoH * 0.75, 0.012, [0, 0, 0], [0, 0, 0.08])}

        {/* --- Silhouette torso accessories (silhouette material) ---- */}
        {/* Shoulder pads: bulky geometry on each shoulder for stocky
            fighters (e.g. Pit Champion). Sits on top of the shoulder mass. */}
        {silhouette.hasShoulderPads && (
          <>
            <mesh
              material={sm}
              castShadow
              position={[-(torsoW / 2 + 0.10), torsoH / 2 - 0.10, 0]}
              geometry={geoms.shoulderPad}
            />
            <mesh
              material={sm}
              castShadow
              position={[torsoW / 2 + 0.10, torsoH / 2 - 0.10, 0]}
              geometry={geoms.shoulderPad}
            />
          </>
        )}

        {/* Pauldron: a LARGE single pauldron on the lead (right) shoulder
            for the Pit Champion. Extends well beyond the shoulder line. */}
        {silhouette.hasPauldron && (
          <mesh
            material={sm}
            castShadow
            position={[torsoW / 2 + 0.14, torsoH / 2 - 0.08, 0.02]}
            rotation={[0, 0, -0.10]}
            geometry={geoms.pauldron}
          />
        )}

        {/* Sash: a thick diagonal rope band across the torso for the Iron
            Monk. Sits on the front face of the chest and slants from the
            right shoulder to the left hip. */}
        {silhouette.hasSash && (
          <mesh
            material={sm}
            castShadow
            position={[0, torsoH * 0.10, torsoD / 2 + 0.02]}
            rotation={[0, 0, 0.55]}
            geometry={geoms.sash}
          />
        )}

        {/* Katana sheath: long thin angled capsule on the left hip for the
            Ronin. Extends from the waist down to mid-thigh at ~15°. */}
        {silhouette.hasKatanaSheath && (
          <mesh
            material={sm}
            castShadow
            position={[-(torsoW / 2 + 0.05), -torsoH * 0.18, 0.05]}
            rotation={[0, 0, 0.26]}
            geometry={geoms.sheath}
          />
        )}
      </group>
    );
  };

  // Head: head box + neck capsule + chin suggestion + eye slit accent,
  // plus any character-specific head accessories (topknot, hood, mohawk,
  // trailing scarf). The head group pivot is at the base of the head
  // (top of the neck), so head rotations tilt the head + neck together
  // around the neck joint.
  const buildHead = () => {
    const headPivotY = torsoH / 2 + neckH;
    return (
      <group ref={headRef} position={[0, headPivotY, 0]}>
        {/* Neck: short capsule hanging down from the head pivot */}
        <mesh
          material={sm}
          castShadow
          position={[0, -neckH / 2, 0]}
          geometry={geoms.neck}
        />
        {/* Head box, centered above the pivot — rounded box */}
        <mesh
          material={sm}
          castShadow
          position={[0, headH / 2, 0]}
          geometry={geoms.head}
        />
        {/* Chin: small rounded box at the bottom-front of the head */}
        <mesh
          material={sm}
          castShadow
          position={[0, chinH / 2, headD * 0.15]}
          geometry={geoms.chin}
        />
        {/* Eye slit / headband (centered on the head, internal glow) */}
        {accent(headW * 0.75, 0.035, 0.012, [0, headH * 0.55, 0])}

        {/* --- Silhouette head accessories (all use the body material) -
             These are part of the dark silhouette, not glowing accents,
             so they read as the character's distinct head shape. */}
        {/* Topknot: a tall narrow rounded box on the crown (Ronin). */}
        {silhouette.hasTopknot && (
          <mesh
            material={sm}
            castShadow
            position={[0, headH / 2 + 0.16, -0.04]}
            geometry={geoms.topknot}
          />
        )}
        {/* Headband: a thin angular band wrapping the forehead (Ronin). */}
        {silhouette.hasHeadband && (
          <mesh
            material={sm}
            castShadow
            position={[0, headH * 0.62, 0]}
            geometry={geoms.headband}
          />
        )}
        {silhouette.hasHood && (
          <>
            {/* Main hood drape: a LARGE rounded box wrapping the head,
                extending above and behind. */}
            <mesh
              material={sm}
              castShadow
              position={[0, headH / 2 + 0.04, -0.14]}
              geometry={geoms.hoodDrape}
            />
            {/* Pointed tip: a tall narrow rounded box, biased upward and
                backward to give the hood a sharp pointed silhouette. */}
            <mesh
              material={sm}
              castShadow
              position={[0, headH / 2 + 0.36, -0.20]}
              geometry={geoms.hoodTip}
            />
          </>
        )}
        {/* Mohawk: a tall narrow ridge running from forehead to back of
            head (Champion). */}
        {silhouette.hasMohawk && (
          <mesh
            material={sm}
            castShadow
            position={[0, headH / 2 + 0.06, -0.02]}
            geometry={geoms.mohawk}
          />
        )}
        {/* Trailing scarf: a thin capsule hanging from the back of the
            head / neck, extending downward (Assassin). Lives inside the
            head group so it follows head rotation. */}
        {silhouette.hasScarf && (
          <mesh
            material={sm}
            castShadow
            position={[0, -headH / 2 - 0.28, -0.10]}
            rotation={[0, 0, 0.10]}
            geometry={geoms.scarf}
          />
        )}
      </group>
    );
  };

  // Arm: capsule upper arm + capsule forearm + elbow joint sphere +
  // wrist line + rounded-box hand, plus character-specific forearm
  // accessories (gauntlets, wrapped-hand accents). isPlayer slightly
  // enlarges the hand for the player to improve impact readability of
  // their own attacks.
  const buildArm = (side) => {
    const isLeft = side === 'L';
    const xSign = isLeft ? -1 : 1;
    const armRef = isLeft ? armLRef : armRRef;
    const foreRef = isLeft ? foreLRef : foreRRef;
    // Player gets a ~10% larger hand for clearer impact silhouettes.
    const handScale = isPlayer ? 1.1 : 1.0;
    // Shoulder pivot: at the top of the chest, just outside the chest edge.
    const shoulderX = xSign * (chestW / 2 + upperArmR * 0.5);
    const shoulderY = chestH / 2 - 0.04;
    return (
      <group position={[shoulderX, shoulderY, 0]}>
        <group ref={armRef}>
          {/* Upper arm: capsule, smooth pill shape */}
          <mesh
            material={sm}
            castShadow
            position={[0, -armH / 2, 0]}
            geometry={geoms.upperArm}
          />
          {/* Upper arm accent strip — runs down the CENTER of the limb
              so it reads as internal energy, not a surface stripe. */}
          {accent(
            0.022 * wrapMul,
            armH * 0.7,
            0.012,
            [0, -armH * 0.5, 0],
          )}
          <group position={[0, -armH, 0]} ref={foreRef}>
            {/* Forearm: capsule, slightly narrower than the upper arm */}
            <mesh
              material={sm}
              castShadow
              position={[0, -foreH / 2, 0]}
              geometry={geoms.forearm}
            />
            {/* Forearm accent strip — center of the limb */}
            {accent(
              0.018 * wrapMul,
              foreH * 0.7,
              0.012,
              [0, -foreH * 0.5, 0],
            )}
            {/* Elbow joint sphere — small bone landmark at the bottom of
                the upper arm / top of the forearm. Sized just larger than
                the capsule radii to suggest a soft joint bulge. */}
            <mesh
              material={sm}
              castShadow
              position={[0, 0, 0]}
              geometry={geoms.elbow}
            />
            {/* Gauntlets: bulky solid forearm armor (silhouette material).
                This is in addition to the regular forearm mesh. */}
            {silhouette.hasGauntlets && (
              <mesh
                material={sm}
                castShadow
                position={[0, -foreH * 0.4, 0]}
                geometry={geoms.gauntlet}
              />
            )}
            {/* Prayer beads: a loop of small spheres around the wrist of
                the lead (right) arm (Monk). Lives at the bottom of the
                forearm just above the wrist line. */}
            {silhouette.hasPrayerBeads && !isLeft && (() => {
              const beads = [];
              const ringR = foreR * 1.6;
              const count = 14;
              for (let i = 0; i < count; i++) {
                const a = (i / count) * Math.PI * 2;
                beads.push(
                  <mesh
                    key={`bead-${i}`}
                    material={sm}
                    castShadow
                    position={[
                      Math.cos(a) * ringR,
                      -foreH + 0.04,
                      Math.sin(a) * ringR,
                    ]}
                    geometry={geoms.prayerBead}
                  />,
                );
              }
              return beads;
            })()}
            {/* Wrist line: a thin rounded band where the forearm meets
                the hand. Sits at the bottom of the forearm. */}
            <mesh
              material={sm}
              castShadow
              position={[0, -foreH + 0.005, 0]}
              geometry={geoms.wristLine}
            />
            {/* Hand: enlarged rounded box (fist) for impact readability.
                Player gets an additional 10% boost for clearer own-attack
                silhouettes — applied via the group scale, not the geom. */}
            <group
              position={[0, -foreH - handH * 0.5 * handScale, 0]}
              scale={handScale}
            >
              <mesh
                material={sm}
                castShadow
                geometry={geoms.hand}
              />
              {/* Knuckle accent — small forward-facing strip on the fist */}
              {accent(
                handW * 0.7, 0.018, 0.012,
                [0, 0, handD / 2 + 0.005],
              )}
            </group>
          </group>
        </group>
      </group>
    );
  };

  // Leg: capsule thigh + capsule calf + knee / ankle joint spheres +
  // wide rounded-box foot, plus character-specific footwear accessories
  // (boot shaft, twin daggers on the thighs).
  const buildLeg = (side) => {
    const isLeft = side === 'L';
    const xSign = isLeft ? -1 : 1;
    const legRef = isLeft ? legLRef : legRRef;
    const calfRef = isLeft ? calfLRef : calfRRef;
    // Hip attachment: at the bottom of the waist, on each side.
    const hipX = xSign * (waistW * 0.25);
    const hipY = -torsoH / 2 + 0.02;
    return (
      <group position={[hipX, hipY, 0]}>
        <group ref={legRef}>
          {/* Thigh: capsule, wider to suggest a muscular upper leg */}
          <mesh
            material={sm}
            castShadow
            position={[0, -legH / 2, 0]}
            geometry={geoms.thigh}
          />
          {/* Thigh accent strip — center of the limb */}
          {accent(
            0.022,
            legH * 0.7,
            0.012,
            [0, -legH * 0.5, 0],
          )}
          {/* Twin daggers: a sheathed blade strapped to the outer side
              of each thigh (Assassin). Angled to point down-and-inward
              so the tips converge below the knee. */}
          {silhouette.hasTwinDaggers && (
            <mesh
              material={sm}
              castShadow
              position={[xSign * (legW * 0.7), -legH * 0.45, thighR * 0.5]}
              rotation={[0, 0, xSign * 0.18]}
              geometry={geoms.dagger}
            />
          )}
          <group position={[0, -legH, 0]} ref={calfRef}>
            {/* Calf: capsule, narrower to suggest the natural taper to
                the ankle. */}
            <mesh
              material={sm}
              castShadow
              position={[0, -calfH / 2, 0]}
              geometry={geoms.calf}
            />
            {/* Calf accent strip — center of the limb */}
            {accent(
              0.018,
              calfH * 0.7,
              0.012,
              [0, -calfH * 0.5, 0],
            )}
            {/* Knee joint sphere — small bone landmark at the bottom of
                the thigh / top of the calf. */}
            <mesh
              material={sm}
              castShadow
              position={[0, 0, 0]}
              geometry={geoms.knee}
            />
            {/* Ankle taper: a smaller sphere at the bottom of the calf
                where it meets the foot, sells the leg→foot transition. */}
            <mesh
              material={sm}
              castShadow
              position={[0, -calfH, 0]}
              geometry={geoms.ankle}
            />
            {/* Foot: wide rounded box for grounding */}
            <mesh
              material={sm}
              castShadow
              position={[0, -calfH - footH / 2, footD * 0.12]}
              geometry={geoms.foot}
            />
            {/* Foot accent — runs across the top of the foot */}
            {accent(footW * 0.8, 0.02, 0.012, [0, -calfH - footH * 0.1, footD / 2 + 0.01])}
            {/* Boot shaft: an extra silhouette box wrapping the ankle
                for fighters with hasBoots, giving a chunky boot look. */}
            {silhouette.hasBoots && (
              <mesh
                material={sm}
                castShadow
                position={[0, -calfH + footH * 0.7, 0]}
                geometry={geoms.bootShaft}
              />
            )}
          </group>
        </group>
      </group>
    );
  };

  return (
    <group ref={groupRef}>
      {/* Inner group is flipped horizontally to face the opponent. */}
      <group ref={charRef}>
        <group ref={hipRef} position={[0, character.stanceOffset, 0]}>
          <group ref={torsoRef}>
            {buildTorso()}
            {buildHead()}
            {buildArm('L')}
            {buildArm('R')}
          </group>
          {buildLeg('L')}
          {buildLeg('R')}
        </group>
      </group>

      {/* Inner glow halo (shadow energy), rendered first so the body sits
          on top of it. Sits at z = -0.2 relative to the fighter group. */}
      <mesh
        position={[0, character.stanceOffset + 0.1, -0.2]}
        material={glowMatRef.current}
        renderOrder={-1}
      >
        <planeGeometry args={[1.2, 2.0]} />
      </mesh>

      {/* Soft contact shadow: flat on the ground, under the feet. Slightly
          larger to match the more detailed geometry. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.01, 0]}
        scale={[character.bodyScale, character.bodyScale, character.bodyScale]}
        material={softShadowMatRef.current}
      >
        <circleGeometry args={[0.65, 32]} />
      </mesh>

      {/* Small accent rim light near the chest/head. */}
      <pointLight
        position={[0, 1.15, 0.35]}
        color={character.accentColor}
        intensity={0.2}
        distance={3}
        decay={2}
      />

      {/* Under-light: small accent glow under the fighter, gives a
          "rising from the ground" feel. */}
      <pointLight
        position={[0, 0.1, 0]}
        color={character.accentColor}
        intensity={0.15}
        distance={2}
        decay={2}
      />
    </group>
  );
}
