"""Mirror of 3d-game/src/combat/stamina.js."""
from __future__ import annotations
from typing import Dict, Any
from .move_data import MOVE_DATA

STAMINA_CONFIG: Dict[str, Any] = {
    "maxStamina": 100,
    "baseRegenRate": 18,
    "blockRegenMultiplier": 0.35,
    "actionRegenMultiplier": 0.0,
    "fatigueThreshold": 20,
    "fatigueExtraCost": 3,
    "grappledCostPenalty": 5,
}


def get_stamina_cost(move: str, ctx: Dict[str, Any] | None = None) -> int:
    ctx = ctx or {}
    data = MOVE_DATA.get(move)
    if not data:
        return 0
    cost = data["staminaCost"]
    if ctx.get("isFatigued") and cost > 0:
        cost += STAMINA_CONFIG["fatigueExtraCost"]
    if ctx.get("isGrappled") and cost > 0:
        cost += STAMINA_CONFIG["grappledCostPenalty"]
    return max(0, int(cost))


def regen_stamina(current: float, dt: float, state: Dict[str, Any] | None = None) -> float:
    state = state or {}
    rate = STAMINA_CONFIG["baseRegenRate"]
    if state.get("isAttacking") or state.get("isHit") or state.get("isGrappled"):
        rate *= STAMINA_CONFIG["actionRegenMultiplier"]
    elif state.get("isBlocking"):
        rate *= STAMINA_CONFIG["blockRegenMultiplier"]
    return clamp_stamina(current + rate * dt)


def can_use_move(move: str, stamina: float, ctx: Dict[str, Any] | None = None) -> bool:
    return stamina >= get_stamina_cost(move, ctx)


def clamp_stamina(value: float) -> float:
    return max(0.0, min(float(STAMINA_CONFIG["maxStamina"]), value))


def spend_stamina(current: float, move: str, ctx: Dict[str, Any] | None = None) -> float:
    return clamp_stamina(current - get_stamina_cost(move, ctx))


def is_fatigued(stamina: float) -> bool:
    return stamina < STAMINA_CONFIG["fatigueThreshold"]
