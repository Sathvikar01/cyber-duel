import { createContext, useContext } from 'react';

export const VfxContext = createContext(null);

export const MAX_PARTICLES = 200;

export function useVfx() {
  const ctx = useContext(VfxContext);
  if (!ctx) {
    throw new Error('useVfx must be used within a VfxProvider');
  }
  return ctx;
}
