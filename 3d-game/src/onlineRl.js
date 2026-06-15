/**
 * Online-RL client glue.
 *
 * Mints and persists a per-browser anonymous playerId, shapes the request
 * payload for the per-user Space adapter, and surfaces a small "Adversary
 * IQ" indicator that the HUD can subscribe to.
 */
import { FIGHTERS } from './fighters/fighterConfigs.js';

const PLAYER_ID_KEY = 'cd_online_uid_v1';
const STORAGE = (() => {
  try { return globalThis.localStorage; }
  catch { return null; }
})();

function makeUuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  // RFC4122 v4 fallback
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export function getOrCreatePlayerId() {
  if (!STORAGE) return makeUuid();
  let uid = STORAGE.getItem(PLAYER_ID_KEY);
  if (!uid || uid.length < 8 || uid.length > 64) {
    uid = makeUuid();
    STORAGE.setItem(PLAYER_ID_KEY, uid);
  }
  return uid;
}

export function resetPlayerId() {
  if (STORAGE) STORAGE.removeItem(PLAYER_ID_KEY);
}

/** Map a React `characterData` id to the model's FIGHTERS schema entry. */
export function fighterStatsForId(id) {
  const f = FIGHTERS[id] || FIGHTERS.ronin;
  return {
    name: f.id,
    speed: f.stats.speed,
    power: f.stats.power,
    range: f.stats.range,
    weight: f.physics?.weight ?? 1.0,
    stance: f.stance || 'neutral',
    stamina: 100,
    hp: 100,
  };
}

function distanceBucketFor(meters) {
  if (meters == null) return 'close';
  if (meters < 2.0) return 'close';
  if (meters < 4.0) return 'mid';
  return 'far';
}

/**
 * Build the /predict payload from the current game state.
 * @param {object} args
 * @param {string} args.sequence            "jab,cross,low_kick,roundhouse,uppercut"
 * @param {string} args.playerCharacterId   id from CHARACTER_LIST
 * @param {string} args.npcCharacterId      id from CHARACTER_LIST
 * @param {number} args.round               1, 2, 3
 * @param {number} args.distance            edge-to-edge meters
 * @param {string} [args.playerPrevMove]    the move the player just did
 *                                         (used to backfill the previous row)
 * @param {string} [args.playerId]          anonymous UUID
 * @param {number} [args.playerStamina]
 * @param {number} [args.npcStamina]
 */
export function buildPredictPayload({
  sequence, playerCharacterId, npcCharacterId, round, distance,
  playerPrevMove, playerId, playerStamina, npcStamina,
}) {
  return {
    sequence,
    player: fighterStatsForId(playerCharacterId),
    npc: fighterStatsForId(npcCharacterId),
    round: round || 1,
    distance: distanceBucketFor(distance),
    playerId: playerId || undefined,
    playerPrevMove: playerPrevMove || undefined,
  };
}

/* -------------------- Adversary IQ state -------------------- */
const ADVERSARY_LISTENERS = new Set();
let adversaryState = {
  playerId: '',
  roundsLogged: 0,
  nextRetrainIn: 25,
  cooldownLeftSec: 0,
  adapterScope: 'global',
  onlineRlEnabled: false,
};

export function getAdversaryState() {
  return adversaryState;
}

export function onAdversaryStateChange(fn) {
  ADVERSARY_LISTENERS.add(fn);
  return () => ADVERSARY_LISTENERS.delete(fn);
}

function emit() {
  for (const fn of ADVERSARY_LISTENERS) {
    try { fn(adversaryState); } catch (e) { console.error('adversary listener', e); }
  }
}

export function setAdversaryState(patch) {
  adversaryState = { ...adversaryState, ...patch };
  emit();
}

let probeTimer = null;
let cooldownTimer = null;

export function startAdversaryProbes(uid) {
  if (!uid) return;
  setAdversaryState({ playerId: uid });
  if (probeTimer) return;
  const tick = async () => {
    try {
      const res = await fetch(`/me?playerId=${encodeURIComponent(uid)}`);
      if (!res.ok) return;
      const data = await res.json();
      setAdversaryState({
        roundsLogged: data.rounds_logged ?? 0,
        nextRetrainIn: data.next_retrain_in ?? 0,
        cooldownLeftSec: data.cooldown_left_sec ?? 0,
        adapterScope: data.adapter_scope ?? 'global',
        onlineRlEnabled: !!data.online_rl_enabled,
      });
    } catch (e) { /* ignore */ }
  };
  tick();
  probeTimer = setInterval(tick, 15000);

  cooldownTimer = setInterval(() => {
    if (adversaryState.cooldownLeftSec > 0) {
      setAdversaryState({ cooldownLeftSec: Math.max(0, adversaryState.cooldownLeftSec - 1) });
    }
  }, 1000);
}

export function stopAdversaryProbes() {
  if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
  if (cooldownTimer) { clearInterval(cooldownTimer); cooldownTimer = null; }
}

/* -------------------- Forget-my-adapter -------------------- */
export async function forgetMyAdapter(uid) {
  if (!uid) return false;
  try {
    const res = await fetch('/forget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: uid }),
    });
    return res.ok;
  } catch (e) {
    console.error('forget failed', e);
    return false;
  }
}
