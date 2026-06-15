import { useRef, useCallback, useMemo } from 'react';
import { VfxContext, MAX_PARTICLES } from './vfxContext.js';

function cssVar(name) {
  if (typeof document === 'undefined') return '#ffffff';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#ffffff';
}

function hexToNum(hex) {
  const clean = hex.replace('#', '');
  return parseInt(clean, 16);
}

export function VfxProvider({ children }) {
  const particlesRef = useRef([]);
  const shockwavesRef = useRef([]);
  const splattersRef = useRef([]);
  const idRef = useRef(0);

  const getPlayerColor = useCallback(() => hexToNum(cssVar('--color-player')), []);
  const getEnemyColor = useCallback(() => hexToNum(cssVar('--color-enemy')), []);
  const getCritColor = useCallback(() => hexToNum(cssVar('--color-crit')), []);
  const getDustColor = useCallback(() => hexToNum(cssVar('--color-parchment-dim')), []);

  const spawnImpact = useCallback((position, opts = {}) => {
    const { count = 18, isCrit = false, isPlayer = false } = opts;
    const color = isCrit ? getCritColor() : (isPlayer ? getPlayerColor() : getEnemyColor());
    const burst = [];
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5;
      const speed = 1.5 + Math.random() * 3.5;
      burst.push({
        id: idRef.current++,
        type: 'spark',
        x: position[0],
        y: position[1] || 1.2,
        z: position[2] || 0,
        vx: Math.cos(theta) * Math.sin(phi) * speed,
        vy: Math.cos(phi) * speed + 1.5,
        vz: Math.sin(theta) * Math.sin(phi) * speed,
        life: 1.0,
        maxLife: 1.0,
        color,
        size: 0.04 + Math.random() * 0.06,
      });
    }
    particlesRef.current.push(...burst);
    if (particlesRef.current.length > MAX_PARTICLES) {
      particlesRef.current.splice(0, particlesRef.current.length - MAX_PARTICLES);
    }
  }, [getCritColor, getPlayerColor, getEnemyColor]);

  const spawnFootstep = useCallback((position) => {
    const color = getDustColor();
    const dust = [];
    for (let i = 0; i < 8; i++) {
      dust.push({
        id: idRef.current++,
        type: 'dust',
        x: position[0] + (Math.random() - 0.5) * 0.4,
        y: 0.05,
        z: (position[2] || 0) + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 1.2,
        vy: 0.3 + Math.random() * 0.5,
        vz: (Math.random() - 0.5) * 1.2,
        life: 1.0,
        maxLife: 1.0,
        color,
        size: 0.06 + Math.random() * 0.08,
      });
    }
    particlesRef.current.push(...dust);
    if (particlesRef.current.length > MAX_PARTICLES) {
      particlesRef.current.splice(0, particlesRef.current.length - MAX_PARTICLES);
    }
  }, [getDustColor]);

  const spawnShockwave = useCallback((position, opts = {}) => {
    const { color, isPlayer = false } = opts;
    shockwavesRef.current.push({
      id: idRef.current++,
      x: position[0],
      y: position[1] || 0.02,
      z: position[2] || 0,
      radius: 0.1,
      maxRadius: opts.maxRadius || 2.5,
      life: 1.0,
      color: color || (isPlayer ? getPlayerColor() : getEnemyColor()),
    });
  }, [getPlayerColor, getEnemyColor]);

  const spawnSplatter = useCallback((position, opts = {}) => {
    const { isCrit = false, isPlayer = false } = opts;
    splattersRef.current.push({
      id: idRef.current++,
      x: position[0],
      y: position[1] || 1.3,
      z: position[2] || 0,
      life: 1.0,
      maxLife: 0.35,
      scale: isCrit ? 1.4 : 1.0,
      color: isCrit ? getCritColor() : (isPlayer ? getPlayerColor() : getEnemyColor()),
    });
  }, [getCritColor, getPlayerColor, getEnemyColor]);

  const contextValue = useMemo(() => ({
    particlesRef,
    shockwavesRef,
    splattersRef,
    spawnImpact,
    spawnFootstep,
    spawnShockwave,
    spawnSplatter,
  }), [spawnImpact, spawnFootstep, spawnShockwave, spawnSplatter]);

  return (
    <VfxContext.Provider value={contextValue}>
      {children}
    </VfxContext.Provider>
  );
}
