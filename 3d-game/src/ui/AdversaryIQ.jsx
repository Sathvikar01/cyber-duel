import { useEffect, useState } from 'react';
import {
  getAdversaryState, onAdversaryStateChange, forgetMyAdapter, resetPlayerId,
} from '../onlineRl.js';

/**
 * Floating "Adversary IQ" indicator. Subscribes to the onlineRl module's
 * shared state and shows how many rounds the user has logged toward the
 * next online retrain + which adapter scope the Space is using right now.
 *
 * Renders nothing (and skips polling) in local dev.
 */
export default function AdversaryIQ() {
  const [state, setState] = useState(getAdversaryState());
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    return onAdversaryStateChange(setState);
  }, []);

  if (!state.playerId) return null;

  const ratio = state.roundsLogged
    ? Math.min(1, state.roundsLogged / Math.max(1, state.roundsLogged + state.nextRetrainIn))
    : 0;
  const inCooldown = state.cooldownLeftSec > 0;
  const scope = state.adapterScope || 'global';

  const label = inCooldown
    ? `Training… ${Math.ceil(state.cooldownLeftSec / 60)} min left`
    : state.roundsLogged === 0
      ? 'No data yet'
      : state.nextRetrainIn === 0
        ? 'Awaiting next retrain'
        : `${state.roundsLogged} / ${state.roundsLogged + state.nextRetrainIn} rounds`;

  const onForget = async () => {
    if (!window.confirm('Forget my learned model? The opponent will revert to the default AI for your next matches.')) return;
    await forgetMyAdapter(state.playerId);
    resetPlayerId();
    window.location.reload();
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 30,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 11,
        color: '#e7e7e7',
        background: 'rgba(8, 8, 12, 0.72)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 180,
        backdropFilter: 'blur(4px)',
        userSelect: 'none',
      }}
      onClick={() => setShowMenu((s) => !s)}
      title="Click for options"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: scope === 'user' ? '#ff6b6b' : '#5dd5ff',
            boxShadow: scope === 'user' ? '0 0 6px #ff6b6b' : '0 0 6px #5dd5ff',
          }}
        />
        <span style={{ fontWeight: 600 }}>Adversary IQ</span>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>{scope === 'user' ? 'Personalized' : 'Global'}</span>
      </div>
      <div style={{ marginTop: 4, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' }}>
        <div
          style={{
            width: `${Math.round(ratio * 100)}%`,
            height: '100%',
            background: inCooldown
              ? 'linear-gradient(90deg, #f0c75e, #ff6b6b)'
              : 'linear-gradient(90deg, #5dd5ff, #ff6b6b)',
            transition: 'width 0.4s',
          }}
        />
      </div>
      <div style={{ marginTop: 4, opacity: 0.85 }}>{label}</div>
      {showMenu && (
        <button
          onClick={(e) => { e.stopPropagation(); onForget(); }}
          style={{
            marginTop: 6,
            background: 'rgba(255,107,107,0.15)',
            border: '1px solid rgba(255,107,107,0.4)',
            color: '#ff9b9b',
            borderRadius: 4,
            padding: '4px 6px',
            fontSize: 10,
            cursor: 'pointer',
            width: '100%',
          }}
        >
          Forget my learned model
        </button>
      )}
    </div>
  );
}
