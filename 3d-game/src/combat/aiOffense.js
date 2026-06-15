import {
  PLAYER_MOVES,
  MOVE_DATA,
  isHeavyMove,
} from './moveData.js';
import { getStaminaCost, canUseMove } from './stamina.js';

/**
 * Offensive helpers for the NPC orchestrator.
 *
 * - `chooseAttack`   : pick the best attack for current range/stamina with
 *                      archetype signature bonuses and stale-move penalty.
 * - `planCombo`      : produce 1-3 follow-up moves chained from an opener.
 * - `shouldFeint`    : true if the archetype/situation favour a feint.
 * - `generateMockCounter` : a tiny client-side policy used when the Gradio
 *                      /predict model isn't reachable.
 */

const DEFAULT_STALE_WINDOW = 4;
const DEFAULT_STALE_PENALTY = 0.32;

function getStalePenalty(history, move, windowSize = DEFAULT_STALE_WINDOW) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const recent = history.slice(-windowSize);
  const repeats = recent.filter((m) => m === move).length;
  return Math.min(0.85, repeats * DEFAULT_STALE_PENALTY);
}

function defaultRanges(cfg) {
  return {
    clinch: cfg?.clinchRange ?? 2.4,
    close: cfg?.closeRange ?? 4.0,
    kick: cfg?.kickRange ?? 4.6,
  };
}

/**
 * Pick the highest-scoring attack from the player move list.
 *
 * @param {number} dist
 * @param {number} stamina
 * @param {object} difficulty
 * @param {object} archetype resolved archetype
 * @param {string[]} staleHistory recent NPC moves
 * @param {object} [cfg]
 * @returns {string|null}
 */
export function chooseAttack(dist, stamina, difficulty, archetype, staleHistory, cfg) {
  const candidates = PLAYER_MOVES.filter((m) => canUseMove(m, stamina));
  if (candidates.length === 0) return null;

  const ranges = defaultRanges(cfg);

  const scored = candidates.map((move) => {
    const data = MOVE_DATA[move];
    let score = 0;

    if (dist <= ranges.clinch) {
      score += isHeavyMove(move) ? 0.18 : 0.65;
    } else if (dist <= ranges.close) {
      score += ['jab', 'cross', 'uppercut'].includes(move) ? 1.0 : 0.5;
    } else if (dist <= ranges.kick) {
      score += ['low_kick', 'roundhouse'].includes(move) ? 1.0 : 0.4;
    } else {
      score += data.range >= dist ? 0.25 : 0.0;
    }

    score += (data.damage / 20) * difficulty.aggression * 0.6;

    const cost = getStaminaCost(move);
    score += (1 - cost / 100) * 0.18;

    if (isHeavyMove(move)) {
      score -= (1 - difficulty.accuracy) * 0.35;
    }

    if (archetype?.signatureMoves?.includes(move)) score += 0.30;
    if (archetype?.rangePreference === 'close' && dist <= ranges.close) score += 0.10;
    if (archetype?.rangePreference === 'far' && dist > ranges.close) score += 0.10;

    score *= 1 - getStalePenalty(staleHistory, move);
    return { move, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, 2);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  return pick ? pick.move : null;
}

const COMBO_TABLE = Object.freeze({
  jab: ['cross', 'low_kick', 'uppercut'],
  cross: ['low_kick', 'uppercut', 'roundhouse'],
  low_kick: ['cross', 'roundhouse', 'uppercut'],
  roundhouse: ['cross', 'jab'],
  uppercut: ['low_kick', 'cross'],
  clinch: ['throw', 'uppercut'],
});

/**
 * Build a 1-3 move combo plan starting after `opener`.
 *
 * The plan returned does NOT include the opener itself. The orchestrator
 * queues these moves on subsequent decision cycles.
 *
 * @param {string} opener
 * @param {object} archetype resolved archetype
 * @param {number} stamina projected stamina after the opener
 * @param {object} [tendency] { aggression, pressure }
 * @returns {string[]}
 */
export function planCombo(opener, archetype, stamina, tendency = {}) {
  if (!opener) return [];
  const aff = archetype?.comboAffinity ?? 0.4;
  const aggression = tendency.aggression ?? archetype?.aggression ?? 0.5;
  const desired = Math.max(1, Math.round(1 + aff * 2 + aggression * 0.5));
  const length = Math.min(3, desired);

  const followups = COMBO_TABLE[opener] || ['jab', 'cross'];
  const plan = [];
  let projected = stamina;
  for (let i = 0; i < length - 1; i += 1) {
    const next = followups[Math.min(i, followups.length - 1)];
    if (!next) break;
    if (!canUseMove(next, projected)) break;
    plan.push(next);
    projected -= getStaminaCost(next);
  }
  return plan;
}

/**
 * Decide whether the NPC should bait the player with a feint right now.
 *
 * Feints are only worthwhile when the player is idle and inside reasonable
 * range; far-away feints aren't visible enough to matter.
 *
 * @param {object} archetype
 * @param {object} player
 * @param {number} dist
 * @returns {boolean}
 */
export function shouldFeint(archetype, player, dist) {
  if (!archetype) return false;
  if (player?.isAttacking) return false;
  if (dist > 5.5 || dist < 1.6) return false;
  const chance = (archetype.feintAffinity || 0) * 0.55;
  return Math.random() < chance;
}

/**
 * Lightweight scripted policy used when the Gradio `/predict` endpoint is
 * unavailable. It mirrors the kind of decisions a tiny neural counter-model
 * might produce: rule-of-thumb counters at appropriate ranges.
 *
 * @param {object} player snapshot
 * @param {number} dist
 * @param {number} npcStamina
 * @param {object} archetype resolved archetype
 * @param {string[]} [history] recent player moves (most recent last)
 * @returns {string|null}
 */
export function generateMockCounter(player, dist, npcStamina, archetype, history = []) {
  const playerMove = player?.anim || null;
  const lastMoves = Array.isArray(history) ? history.slice(-5) : [];
  const recentHeavy = lastMoves.some((m) => m === 'roundhouse' || m === 'uppercut');

  // Grappler closes in and tries to clinch when the player exposes themselves.
  if (dist <= 2.5) {
    if ((archetype?.grappleAffinity || 0) > 0.55 && canUseMove('clinch', npcStamina)) {
      return 'clinch';
    }
    if (canUseMove('uppercut', npcStamina) && Math.random() < 0.45) return 'uppercut';
    if (canUseMove('jab', npcStamina)) return 'jab';
  }

  if (dist <= 4.0) {
    if (playerMove === 'roundhouse' && canUseMove('cross', npcStamina)) return 'cross';
    if (playerMove === 'uppercut' && canUseMove('low_kick', npcStamina)) return 'low_kick';
    if (playerMove === 'low_kick' && canUseMove('jab', npcStamina)) return 'jab';
    if (playerMove === 'cross' && canUseMove('cross', npcStamina)) return 'cross';
    if (recentHeavy && canUseMove('jab', npcStamina)) return 'jab';
    if (canUseMove('cross', npcStamina)) return 'cross';
    return canUseMove('jab', npcStamina) ? 'jab' : null;
  }

  if (dist <= 4.8) {
    if (canUseMove('low_kick', npcStamina)) return 'low_kick';
    if (canUseMove('roundhouse', npcStamina)) return 'roundhouse';
  }

  if (canUseMove('low_kick', npcStamina)) return 'low_kick';
  if (canUseMove('jab', npcStamina)) return 'jab';
  return null;
}
