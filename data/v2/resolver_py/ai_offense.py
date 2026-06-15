"""Mirror of 3d-game/src/combat/aiOffense.js.

Pure-Python port of the AI offense helpers used by the training data
generator. The JS source is the authority; keep this in lock-step so
the SFT/GRPO datasets agree with the in-game resolver.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
from .move_data import PLAYER_MOVES, MOVE_DATA, is_heavy_move
from .stamina import get_stamina_cost, can_use_move


# Body half-width used to convert edge-to-edge range bands (in
# MOVE_DATA) into the center-to-center distances the AI reasons
# about. Matches Game.jsx's edgeDist() default. Two fighters at
# touching range have center-to-center = 2 * BODY_HALF_WIDTH.
BODY_HALF_WIDTH = 0.45


DEFAULT_STALE_WINDOW = 4
DEFAULT_STALE_PENALTY = 0.32


def get_stale_penalty(history, move, window_size: int = DEFAULT_STALE_WINDOW) -> float:
    if not isinstance(history, list) or len(history) == 0:
        return 0.0
    recent = history[-window_size:]
    repeats = sum(1 for m in recent if m == move)
    return min(0.85, repeats * DEFAULT_STALE_PENALTY)


def default_ranges(cfg: Optional[Dict[str, Any]] = None) -> Dict[str, float]:
    cfg = cfg or {}
    return {
        "clinch": cfg.get("clinchRange", 2.4),
        "close": cfg.get("closeRange", 4.0),
        "kick": cfg.get("kickRange", 4.6),
    }


def choose_attack(
    dist: float,
    stamina: float,
    difficulty: Dict[str, Any],
    archetype: Optional[Dict[str, Any]],
    stale_history,
    cfg: Optional[Dict[str, Any]] = None,
) -> Optional[str]:
    """Pick the highest-scoring attack from the player move list, or
    return None if NO move can reach the player at the current
    center-to-center distance. Returning None lets the orchestrator
    fall through to the movement/spacing fallback.
    """
    candidates = [m for m in PLAYER_MOVES if can_use_move(m, stamina)]
    if not candidates:
        return None

    # Hard range gate. Convert the move's edge-to-edge maxRange into
    # a center-to-center distance by adding 2 * body half-width.
    center_to_edge_offset = BODY_HALF_WIDTH * 2
    reachable = []
    for m in candidates:
        d = MOVE_DATA.get(m)
        if not d:
            continue
        if dist <= (d.get("maxRange", d.get("range", 0)) + center_to_edge_offset):
            reachable.append(m)
    if not reachable:
        return None
    usable = reachable

    ranges = default_ranges(cfg)

    scored: List[Tuple[str, float]] = []
    for move in usable:
        data = MOVE_DATA[move]
        score = 0.0

        if dist <= ranges["clinch"]:
            score += 0.18 if is_heavy_move(move) else 0.65
        elif dist <= ranges["close"]:
            if move in ("jab", "cross", "uppercut"):
                score += 1.0
            else:
                score += 0.5
        elif dist <= ranges["kick"]:
            if move in ("low_kick", "roundhouse"):
                score += 1.0
            else:
                score += 0.4
        else:
            # In-reach fallback (only reached when dist is just above
            # the kick band but still inside the move's maxRange).
            score += 0.25 if data["range"] >= dist else 0.0

        score += (data["damage"] / 20.0) * difficulty.get("aggression", 0.5) * 0.6

        cost = get_stamina_cost(move)
        score += (1 - cost / 100.0) * 0.18

        if is_heavy_move(move):
            score -= (1 - difficulty.get("accuracy", 0.5)) * 0.35

        signature = (archetype or {}).get("signatureMoves", [])
        if move in signature:
            score += 0.30
        if (archetype or {}).get("rangePreference") == "close" and dist <= ranges["close"]:
            score += 0.10
        if (archetype or {}).get("rangePreference") == "far" and dist > ranges["close"]:
            score += 0.10

        score *= 1 - get_stale_penalty(stale_history, move)
        scored.append((move, score))

    scored.sort(key=lambda x: x[1], reverse=True)
    pool = scored[:2]
    if not pool:
        return None
    import random
    return random.choice(pool)[0]
