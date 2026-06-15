"""Mirror of 3d-game/src/combat/aiArchetypes.js — used by the rollout simulator
to mix NPC behaviours when collecting GRPO data.
"""
from __future__ import annotations
from typing import Any, Dict, Union

AI_ARCHETYPES: Dict[str, Dict[str, Any]] = {
    "balanced": {
        "id": "balanced", "rangePreference": "mid",
        "aggression": 0.60, "patience": 0.55,
        "parryAffinity": 0.55, "evadeAffinity": 0.45,
        "blockAffinity": 0.55, "grappleAffinity": 0.30,
        "feintAffinity": 0.30, "comboAffinity": 0.50,
        "reactionDelayBase": 0.18, "riskTolerance": 0.50,
        "movementStyle": "circling",
        "signatureMoves": ("cross", "low_kick", "roundhouse"),
    },
    "heavy": {
        "id": "heavy", "rangePreference": "mid",
        "aggression": 0.80, "patience": 0.35,
        "parryAffinity": 0.30, "evadeAffinity": 0.20,
        "blockAffinity": 0.50, "grappleAffinity": 0.40,
        "feintAffinity": 0.20, "comboAffinity": 0.60,
        "reactionDelayBase": 0.22, "riskTolerance": 0.70,
        "movementStyle": "direct",
        "signatureMoves": ("uppercut", "roundhouse", "cross"),
    },
    "fast": {
        "id": "fast", "rangePreference": "close",
        "aggression": 0.85, "patience": 0.30,
        "parryAffinity": 0.45, "evadeAffinity": 0.55,
        "blockAffinity": 0.30, "grappleAffinity": 0.20,
        "feintAffinity": 0.50, "comboAffinity": 0.70,
        "reactionDelayBase": 0.14, "riskTolerance": 0.60,
        "movementStyle": "jittery",
        "signatureMoves": ("jab", "cross", "low_kick"),
    },
    "agile": {
        "id": "agile", "rangePreference": "mid",
        "aggression": 0.65, "patience": 0.60,
        "parryAffinity": 0.50, "evadeAffinity": 0.85,
        "blockAffinity": 0.25, "grappleAffinity": 0.15,
        "feintAffinity": 0.55, "comboAffinity": 0.65,
        "reactionDelayBase": 0.12, "riskTolerance": 0.55,
        "movementStyle": "circling",
        "signatureMoves": ("jab", "low_kick", "cross"),
    },
    "grappler": {
        "id": "grappler", "rangePreference": "close",
        "aggression": 0.70, "patience": 0.50,
        "parryAffinity": 0.40, "evadeAffinity": 0.30,
        "blockAffinity": 0.70, "grappleAffinity": 0.90,
        "feintAffinity": 0.25, "comboAffinity": 0.55,
        "reactionDelayBase": 0.20, "riskTolerance": 0.65,
        "movementStyle": "direct",
        "signatureMoves": ("clinch", "throw", "uppercut"),
    },
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def resolve_archetype(archetype: Union[str, Dict[str, Any], None]) -> Dict[str, Any]:
    if isinstance(archetype, dict) and archetype.get("id"):
        return archetype
    if isinstance(archetype, str) and archetype in AI_ARCHETYPES:
        return AI_ARCHETYPES[archetype]
    return AI_ARCHETYPES["balanced"]


def get_difficulty_profile(archetype: Union[str, Dict[str, Any], None], round: int = 1) -> Dict[str, Any]:
    arche = resolve_archetype(archetype)
    r = max(1, min(8, int(round) or 1))
    t = min(1.0, (r - 1) / 4)
    base_reaction = _lerp(0.20, 0.08, t)
    base_parry = _lerp(0.20, 0.55, t)
    base_block = _lerp(0.30, 0.10, t)
    base_evade = _lerp(0.18, 0.50, t)
    base_aggr = _lerp(0.55, 0.85, t)
    base_acc = _lerp(0.62, 0.92, t)
    base_grap = _lerp(0.10, 0.40, t)
    base_feint = _lerp(0.05, 0.30, t)
    base_counter = _lerp(0.30, 0.70, t)
    base_combo = _lerp(0.20, 0.65, t)
    return {
        "aggression": _clamp(base_aggr * (0.7 + arche["aggression"] * 0.5), 0.30, 0.98),
        "reactionTime": _clamp(base_reaction + (arche["reactionDelayBase"] - 0.18), 0.05, 0.40),
        "parryChance": _clamp(base_parry * (0.5 + arche["parryAffinity"]), 0.05, 0.78),
        "counterChance": _clamp(base_counter * (0.6 + arche["aggression"] * 0.8), 0.20, 0.90),
        "blockChance": _clamp(base_block * (0.5 + arche["blockAffinity"]), 0.05, 0.60),
        "evadeChance": _clamp(base_evade * (0.5 + arche["evadeAffinity"]), 0.05, 0.75),
        "grappleChance": _clamp(base_grap * (0.4 + arche["grappleAffinity"] * 1.5), 0.02, 0.65),
        "feintChance": _clamp(base_feint * (0.5 + arche["feintAffinity"] * 1.5), 0.0, 0.55),
        "comboChance": _clamp(base_combo * (0.5 + arche["comboAffinity"]), 0.10, 0.85),
        "accuracy": _clamp(base_acc, 0.50, 0.96),
        "patience": arche["patience"], "riskTolerance": arche["riskTolerance"],
        "archetype": arche, "round": r,
    }
