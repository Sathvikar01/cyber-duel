import { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  EffectComposer,
  Bloom,
  Noise,
  DepthOfField,
  Vignette,
  BrightnessContrast,
  HueSaturation,
  ChromaticAberration,
} from '@react-three/postprocessing';
import { Vector2 } from 'three';

// Aberration limits. CHROMA_MAX caps the worst-case combined offset so the
// frame never tears into rainbow soup even on a max-shake + crit pulse.
const CHROMA_MAX = 0.008;
const CHROMA_GAIN = 0.005;
const CRIT_CHROMA_GAIN = 0.012;

// Pulse decay factors run at frame rate (assumed ~60Hz). 0.9^60 ~ 0.0018
// so a vignette pulse of 0.3 fades to imperceptible in about a second.
const VIGNETTE_PULSE_DECAY = 0.9;
const CRIT_PULSE_DECAY = 0.86;

export default function ArenaPostFx({ postFx, gameRef }) {
  const chromaticRef = useRef(null);
  const vignetteRef = useRef(null);
  const hueSatRef = useRef(null);
  const brightContRef = useRef(null);

  // Smoothed low-HP factor lives in a ref so it survives between frames
  // without forcing React re-renders.
  const lowHpStateRef = useRef(0);

  // Track quality preset reactively so DoF can be mounted / dismounted
  // when the user changes the setting between matches. The value lives on
  // gameRef.current (written by App.jsx) and is polled cheaply in useFrame.
  const initialQuality =
    gameRef?.current?.qualityPreset ||
    (typeof postFx?.quality === 'string' ? postFx.quality : 'medium');
  const [quality, setQuality] = useState(initialQuality);

  const baseOffset = postFx?.chromaticAberration?.offset ?? [0.0005, 0.0005];
  const baseline = Array.isArray(baseOffset)
    ? new Vector2(baseOffset[0] ?? 0, baseOffset[1] ?? 0)
    : new Vector2(0.0005, 0.0005);

  const bloom = postFx?.bloom || {};
  const vignette = postFx?.vignette || {};
  const brightnessContrast = postFx?.brightnessContrast || {};
  const saturation = postFx?.saturation || {};
  const chromaticAberration = postFx?.chromaticAberration || {};
  const noise = postFx?.noise || {};
  const dof = postFx?.depthOfField || {};

  // Base values for the effects we lerp at runtime. Kept outside useFrame
  // so we are not allocating per-frame.
  const baseVignetteDarkness = vignette.darkness ?? 0.7;
  const baseSaturation = saturation.saturation ?? 0;
  const baseHue = saturation.hue ?? 0;
  const baseBrightness = brightnessContrast.brightness ?? 0;
  const baseContrast = brightnessContrast.contrast ?? 0;

  useFrame((_, dt) => {
    const game = gameRef?.current;
    if (!game) return;

    // Pick up quality changes written by App.jsx without burning a render
    // per frame: we only call setState when the string actually flips.
    const q = game.qualityPreset || initialQuality;
    if (q !== quality) setQuality(q);

    // Initialise pulse fields lazily so the rest of the game does not
    // need to know about them.
    if (typeof game.vignettePulse !== 'number') game.vignettePulse = 0;
    if (typeof game.critPulse !== 'number') game.critPulse = 0;

    // Decay pulses every frame.
    game.vignettePulse = Math.max(0, game.vignettePulse * VIGNETTE_PULSE_DECAY);
    game.critPulse = Math.max(0, game.critPulse * CRIT_PULSE_DECAY);

    // ----- Chromatic aberration: base + screen shake + crit pulse -----
    const chromEff = chromaticRef.current;
    if (chromEff && chromEff.offset) {
      const shake = Math.max(0, game.screenShake || 0);
      const shakeBoost = shake * CHROMA_GAIN;
      const critBoost = game.critPulse * CRIT_CHROMA_GAIN;
      const dynamic = Math.min(CHROMA_MAX, shakeBoost + critBoost);
      chromEff.offset.set(baseline.x + dynamic, baseline.y + dynamic);
    }

    // ----- Low HP colour grade: lerp toward target (~250ms response) -----
    const targetLow = Math.max(0, Math.min(1, game.lowHpFactor || 0));
    const lerpRate = Math.min(1, dt * 4);
    lowHpStateRef.current += (targetLow - lowHpStateRef.current) * lerpRate;
    const lowHp = lowHpStateRef.current;

    const hueSat = hueSatRef.current;
    if (hueSat) {
      hueSat.saturation = baseSaturation - lowHp * 0.5;
      hueSat.hue = baseHue - lowHp * 0.08;
    }

    const brightCont = brightContRef.current;
    if (brightCont) {
      brightCont.brightness = baseBrightness - lowHp * 0.06;
      brightCont.contrast = baseContrast + lowHp * 0.06;
    }

    // ----- Vignette: base + hit pulse + low-HP danger -----
    const vig = vignetteRef.current;
    if (vig) {
      const darkness = Math.min(
        1.2,
        baseVignetteDarkness + game.vignettePulse + lowHp * 0.18
      );
      vig.darkness = darkness;
    }
  });

  // DoF is the most expensive pass; skip it on low-quality and let the
  // arena override via postFx.depthOfField.enabled === false.
  const wantsDof = dof.enabled !== false && quality !== 'low';

  // Build the effects array once per (quality, wantsDof) change and reuse
  // the same element references. Some postprocessing internals serialise
  // children for bookkeeping; stable refs avoid the JSON.stringify cost
  // and the React 19 circular-element warning.
  const effects = useMemo(() => {
    if (!postFx) return null;
    const list = [
      <Bloom
        key="bloom"
        intensity={bloom.intensity ?? 1.3}
        luminanceThreshold={bloom.luminanceThreshold ?? 0.35}
        luminanceSmoothing={bloom.luminanceSmoothing ?? 0.25}
        mipmapBlur={bloom.mipmapBlur ?? true}
        radius={bloom.radius ?? 0.7}
        levels={bloom.levels ?? 7}
      />,
      <ChromaticAberration
        key="chroma"
        ref={chromaticRef}
        offset={baseline}
        radialModulation={chromaticAberration.radialModulation ?? false}
      />,
      <HueSaturation
        key="huesat"
        ref={hueSatRef}
        saturation={baseSaturation}
        hue={baseHue}
      />,
      <BrightnessContrast
        key="brightcont"
        ref={brightContRef}
        brightness={baseBrightness}
        contrast={baseContrast}
      />,
      <Noise
        key="noise"
        opacity={noise.opacity ?? 0.05}
        premultiply={noise.premultiply ?? true}
      />,
      <Vignette
        key="vignette"
        ref={vignetteRef}
        eskil={vignette.eskil ?? false}
        offset={vignette.offset ?? 0.3}
        darkness={baseVignetteDarkness}
      />,
    ];
    if (wantsDof) {
      list.splice(1, 0,
        <DepthOfField
          key="dof"
          focusDistance={dof.focusDistance ?? 0.02}
          focalLength={dof.focalLength ?? 0.05}
          bokehScale={dof.bokehScale ?? 1.5}
        />
      );
    }
    return list;
    // We intentionally only rebuild on quality or DoF toggle change.
    // The refs and base values are stable enough that the effects don't
    // need to be recreated on every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, wantsDof, postFx]);

  if (!postFx) return null;
  if (!effects) return null;

  return <EffectComposer multisampling={0}>{effects}</EffectComposer>;
}
