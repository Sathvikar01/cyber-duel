import * as THREE from 'three';

const cache = new Map();

function makeCanvas(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

function makeRadial(key, size, stops) {
  if (cache.has(key)) return cache.get(key);
  const tex = makeCanvas(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  cache.set(key, tex);
  return tex;
}

function makeLeaf(key, size) {
  if (cache.has(key)) return cache.get(key);
  const tex = makeCanvas(size, (ctx, s) => {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(Math.PI / 5);
    const g = ctx.createLinearGradient(-s * 0.45, 0, s * 0.45, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.42, s * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // center vein
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillRect(-s * 0.4, -0.5, s * 0.8, 1);
    ctx.restore();
  });
  cache.set(key, tex);
  return tex;
}

function makeFlake(key, size) {
  if (cache.has(key)) return cache.get(key);
  const tex = makeCanvas(size, (ctx, s) => {
    const cx = s / 2;
    const cy = s / 2;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42);
      ctx.stroke();
    }
  });
  cache.set(key, tex);
  return tex;
}

/** Soft falloff disc - good for dust, snow, generic particles. */
export function getSoftCircle() {
  return makeRadial('softCircle', 64, [
    [0, 'rgba(255,255,255,1)'],
    [0.45, 'rgba(255,255,255,0.5)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
}

/** Brighter glow disc - good for embers / fireflies. */
export function getGlow() {
  return makeRadial('glow', 64, [
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(255,255,255,0.75)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
}

/** Leaf-shaped sprite for the bamboo grove. */
export function getLeaf() {
  return makeLeaf('leaf', 64);
}

/** Tiny 6-armed snowflake sprite for the shrine's ice crystals. */
export function getFlake() {
  return makeFlake('flake', 64);
}
