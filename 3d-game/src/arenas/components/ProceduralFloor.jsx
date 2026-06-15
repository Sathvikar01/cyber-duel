import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';

/**
 * ProceduralFloor
 *
 * Two stacked meshes sharing the same world-space XZ footprint:
 *  1. A reflective base mesh using `MeshReflectorMaterial` (drei). This is
 *     where the arena's accent lights and fighter rim lights are mirrored.
 *  2. A procedural pattern overlay rendered with a `MeshStandardMaterial`
 *     whose `onBeforeCompile` shader draws cracks/veins/accent glow. The
 *     overlay is mostly transparent so the reflection shows through, with
 *     cracks/veins pushed to full opacity.
 *
 * The overlay is lifted 0.01 units above the reflector to avoid z-fighting
 * and writes no depth so transparency sorts cleanly against the scene.
 *
 * Props:
 *  - floor: {
 *      size:        [w, h]              // plane size (default 60x60)
 *      baseColor:   '#rrggbb'           // ground base color
 *      crackColor:  '#rrggbb'           // crack / vein color
 *      accentColor: '#rrggbb'           // accent / glow color
 *      pattern:     'crackedStone' | 'wetPath' | 'crackedMarble' | 'blackIce'
 *      roughness:   0..1
 *      metalness:   0..1 (default 0)
 *      reflection:  {                    // MeshReflectorMaterial tuning
 *        blur: [number, number],
 *        resolution?: number,
 *        mixBlur?: number,
 *        mixStrength?: number,
 *        mirror?: number,
 *        depthScale?: number,
 *        minDepthThreshold?: number,
 *        maxDepthThreshold?: number,
 *        baseAlpha?: number,             // overlay alpha on non-pattern pixels
 *      }
 *    }
 */
const PATTERN_GLSL = /* glsl */ `
  float pfHash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 pfHash22(vec2 p) {
    return vec2(pfHash21(p), pfHash21(p + 17.17));
  }

  // Each pattern returns vec4(color, intensity). intensity in [0,1] is the
  // amount of pattern modification at this pixel (0 = pure base color, 1 =
  // full crack/accent). The fragment shader uses it to mix the overlay
  // alpha between uBaseAlpha (base areas) and 1.0 (crack/accent areas).

  // Cracked obsidian-style stone: brick-like tiles with thin dark cracks and
  // a sparse glowing accent (lava seams, runic glow).
  vec4 patternCrackedStone(vec2 wp, vec3 base, vec3 crack, vec3 accent) {
    vec2 cell = floor(wp * 0.45);
    vec2 jitter = (pfHash22(cell) - 0.5) * 0.6;
    vec2 local = fract(wp * 0.45) - 0.5 + jitter * 0.3;
    float brick = max(
      smoothstep(0.48, 0.5, abs(local.x)),
      smoothstep(0.46, 0.48, abs(local.y))
    );
    // Sparse sub-cracks
    float subSeed = pfHash21(floor(wp * 1.6));
    float subCrack = step(0.965, subSeed) * 0.5;
    // Accent glow in occasional tiles
    float accentMask = step(0.78, pfHash21(cell + 9.0)) * 0.45;
    vec3 col = base;
    col = mix(col, crack, brick);
    col = mix(col, crack, subCrack);
    col = mix(col, accent, accentMask);
    float intensity = clamp(brick + subCrack + accentMask, 0.0, 1.0);
    return vec4(col, intensity);
  }

  // Wet dirt / moss path: irregular puddles, lighter moss patches and faint
  // reflective streaks. Used by the bamboo grove floor.
  vec4 patternWetPath(vec2 wp, vec3 base, vec3 crack, vec3 accent) {
    float n1 = pfHash21(floor(wp * 0.9));
    float n2 = pfHash21(floor(wp * 0.9) + 3.0);
    vec2 cell = floor(wp * 0.9) + 0.5;
    float r = length(wp * 0.9 - cell);
    float puddle = (1.0 - smoothstep(0.18, 0.45, r)) * step(0.45, n1);
    // Subtle moss tufts
    float moss = step(0.7, pfHash21(floor(wp * 2.4) + 11.0)) * 0.35;
    // Streaky reflections inside puddles
    float streak = sin(wp.x * 1.7 + n2 * 6.28) * 0.5 + 0.5;
    streak = smoothstep(0.5, 0.95, streak);
    vec3 col = base;
    col = mix(col, crack, moss);
    col = mix(col, accent, puddle * 0.55);
    col = mix(col, accent * 1.2, puddle * streak * 0.35);
    float intensity = clamp(moss + puddle * 0.55 + puddle * streak * 0.35, 0.0, 1.0);
    return vec4(col, intensity);
  }

  // Cracked marble: warm sandy stone with veining, big dark cracks, gold flecks.
  vec4 patternCrackedMarble(vec2 wp, vec3 base, vec3 crack, vec3 accent) {
    float vein = sin(wp.x * 0.25 + sin(wp.y * 0.18) * 3.0) * 0.5 + 0.5;
    float vein2 = sin(wp.y * 0.4 + cos(wp.x * 0.22) * 2.0) * 0.5 + 0.5;
    float veins = smoothstep(0.55, 0.7, vein) * 0.4 + smoothstep(0.6, 0.85, vein2) * 0.25;
    // Big cracks
    vec2 g = abs(fract(wp * 0.18 + 0.5) - 0.5);
    float crackDist = min(g.x, g.y);
    float bigCrack = 1.0 - smoothstep(0.0, 0.025, crackDist);
    // Gold flecks
    float fleck = step(0.985, pfHash21(floor(wp * 3.0) + 5.0));
    vec3 col = base;
    col = mix(col, crack, clamp(veins, 0.0, 1.0) * 0.35);
    col = mix(col, crack, bigCrack * 0.6);
    col = mix(col, accent, fleck * 0.5);
    float intensity = clamp(veins * 0.35 + bigCrack * 0.6 + fleck * 0.5, 0.0, 1.0);
    return vec4(col, intensity);
  }

  // Black ice: smooth glassy surface with hex-ish crack lattice. Intensity
  // is 0 across the smooth body (so the reflection dominates) and 1 on
  // the crack lines / sub-cracks.
  vec4 patternBlackIce(vec2 wp, vec3 base, vec3 crack, vec3 accent) {
    // Hex-ish crack lattice.
    vec2 hp = wp * 0.55;
    vec2 s = vec2(1.0, 1.732);
    vec2 a = mod(hp, s) - s * 0.5;
    vec2 b = mod(hp - s * 0.5, s) - s * 0.5;
    float da = min(min(abs(a.x), abs(a.y)), length(a) * 0.7);
    float db = min(min(abs(b.x), abs(b.y)), length(b) * 0.7);
    float crackMask = 1.0 - smoothstep(0.0, 0.03, min(da, db));
    // Sub cracks
    float sub = step(0.97, pfHash21(floor(wp * 1.4) + 2.0)) * 0.5;
    crackMask = max(crackMask, sub);
    // Slow shimmer band
    float shimmer = sin(wp.x * 0.6 + wp.y * 0.35) * 0.5 + 0.5;
    vec3 col = base + accent * 0.18 * shimmer;
    col = mix(col, crack, clamp(crackMask, 0.0, 1.0));
    float intensity = clamp(crackMask, 0.0, 1.0);
    return vec4(col, intensity);
  }
`;

const PATTERN_INDEX = {
  crackedStone: 0,
  wetPath: 1,
  crackedMarble: 2,
  blackIce: 3,
};

const DEFAULT_REFLECTION = {
  blur: [100, 100],
  resolution: 256,
  mixBlur: 1.0,
  mixStrength: 0.6,
  mirror: 0.5,
  depthScale: 0.5,
  minDepthThreshold: 0.4,
  maxDepthThreshold: 1.4,
  baseAlpha: 0.4,
};

export default function ProceduralFloor({ floor }) {
  const {
    size = [60, 60],
    baseColor = '#222222',
    crackColor = '#000000',
    accentColor = '#ffffff',
    pattern = 'crackedStone',
    roughness = 0.9,
    metalness = 0,
    reflection,
  } = floor || {};

  const refl = useMemo(
    () => ({ ...DEFAULT_REFLECTION, ...(reflection || {}) }),
    [reflection]
  );

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness,
      metalness,
      transparent: true,
      depthWrite: false,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBaseColor = { value: new THREE.Color(baseColor) };
      shader.uniforms.uCrackColor = { value: new THREE.Color(crackColor) };
      shader.uniforms.uAccentColor = { value: new THREE.Color(accentColor) };
      shader.uniforms.uPattern = { value: PATTERN_INDEX[pattern] ?? 0 };
      shader.uniforms.uRoughness = { value: roughness };
      shader.uniforms.uBaseAlpha = { value: refl.baseAlpha };
      shader.uniforms.uFloorSize = { value: new THREE.Vector2(size[0], size[1]) };

      // World-space XZ coordinate of the fragment.
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
         varying vec2 vFloorPos;`
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 _floorWP = modelMatrix * vec4(position, 1.0);
         vFloorPos = _floorWP.xz;`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying vec2 vFloorPos;
         uniform vec3 uBaseColor;
         uniform vec3 uCrackColor;
         uniform vec3 uAccentColor;
         uniform float uPattern;
         uniform float uRoughness;
         uniform float uBaseAlpha;
         ${PATTERN_GLSL}`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec4 _floorCol;
         if (uPattern < 0.5) {
           _floorCol = patternCrackedStone(vFloorPos, uBaseColor, uCrackColor, uAccentColor);
         } else if (uPattern < 1.5) {
           _floorCol = patternWetPath(vFloorPos, uBaseColor, uCrackColor, uAccentColor);
         } else if (uPattern < 2.5) {
           _floorCol = patternCrackedMarble(vFloorPos, uBaseColor, uCrackColor, uAccentColor);
         } else {
           _floorCol = patternBlackIce(vFloorPos, uBaseColor, uCrackColor, uAccentColor);
         }
         diffuseColor.rgb = _floorCol.rgb;
         // Pixels that are pure base show the reflection through; cracks/accents
         // are fully opaque.
         diffuseColor.a = mix(uBaseAlpha, 1.0, clamp(_floorCol.a, 0.0, 1.0));`
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = uRoughness;`
      );

      mat.userData.shader = shader;
    };

    mat.customProgramCacheKey = () =>
      `procedural-floor-${pattern}-${baseColor}-${crackColor}-${accentColor}-${roughness}-${metalness}-${refl.baseAlpha}`;

    return mat;
  }, [baseColor, crackColor, accentColor, pattern, roughness, metalness, size, refl.baseAlpha]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={size} />
        <MeshReflectorMaterial
          color={baseColor}
          resolution={refl.resolution}
          blur={refl.blur}
          mixBlur={refl.mixBlur}
          mixStrength={refl.mixStrength}
          mirror={refl.mirror}
          depthScale={refl.depthScale}
          minDepthThreshold={refl.minDepthThreshold}
          maxDepthThreshold={refl.maxDepthThreshold}
          roughness={roughness}
          metalness={metalness}
        />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        position={[0, 0.01, 0]}
        material={material}
      >
        <planeGeometry args={size} />
      </mesh>
    </group>
  );
}
