"""Mirror of 3d-game/src/combat/combatResolver.js — pure resolution functions.

The Python port preserves the JS control flow exactly. Inputs/outputs are
plain dicts/floats/strs; no class hierarchy.
"""
from __future__ import annotations
from typing import Any, Dict
from .move_data import MOVE_DATA, GRAPPLE_MOVES, DEFENSIVE_MOVES
from .stamina import get_stamina_cost

COMBAT_CONFIG: Dict[str, Any] = {
    "maxComboScaleHits": 6,
    "minComboScale": 0.35,
    "counterHitMultiplier": 1.35,
    "blockChipFraction": 0.08,
    "blockStaminaFraction": 0.35,
    "blockStaminaDamageFraction": 0.25,
    "parryStaminaReward": 12,
    "grappledDamageMultiplier": 1.15,
}

REACTIONS: Dict[str, str] = {
    "NONE": "none", "FLINCH": "flinch", "STUMBLE": "stumble",
    "KNOCKDOWN": "knockdown", "FALL": "fall", "CLINCHED": "clinched",
}


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def get_combo_scale(hit_count: int) -> float:
    n = max(0, int(hit_count))
    if n == 0:
        return 1.0
    decay = 1 - n / COMBAT_CONFIG["maxComboScaleHits"]
    return _clamp(decay, COMBAT_CONFIG["minComboScale"], 1.0)


def is_counter_hit_vulnerable(defender: Dict[str, Any], defender_move: str) -> bool:
    if not defender or not defender.get("isAttacking"):
        return False
    data = MOVE_DATA.get(defender_move)
    if not data:
        return False
    total = data["startup"] + data["active"] + data["recovery"]
    if total <= 0:
        return False
    progress = defender.get("animProgress", 0) or 0
    t = progress * total
    return t < data["startup"] or t > data["startup"] + data["active"] + data["recovery"] * 0.4


def pick_reaction(move: str, damage: int, hp_left: int) -> str:
    if hp_left <= 0:
        return REACTIONS["FALL"]
    data = MOVE_DATA.get(move) or {}
    hr = data.get("hitReaction")
    if hr == "clinched":
        return REACTIONS["CLINCHED"]
    if hr == "fall":
        return REACTIONS["FALL"]
    if damage >= 12:
        return REACTIONS["KNOCKDOWN"]
    if damage >= 10:
        return REACTIONS["STUMBLE"]
    return REACTIONS["FLINCH"]


def resolve_block(attack: Dict[str, Any], defender: Dict[str, Any]) -> Dict[str, Any]:
    data = MOVE_DATA.get(attack.get("move", ""))
    if not data:
        return {"hit": False, "reason": "unknown_move"}
    raw = data["damage"]
    chip = max(1, int(raw * COMBAT_CONFIG["blockChipFraction"]))
    stamina_cost = int(get_stamina_cost(attack["move"]) * COMBAT_CONFIG["blockStaminaFraction"])
    stamina_damage = int(raw * COMBAT_CONFIG["blockStaminaDamageFraction"])
    hp_left = max(0, (defender.get("hp", 0) or 0) - chip)
    stamina_left = max(0, (defender.get("stamina", 0) or 0) - stamina_cost - stamina_damage)
    return {
        "hit": False, "blocked": True, "chip": chip,
        "staminaCost": stamina_cost, "staminaDamage": stamina_damage,
        "hpLeft": hp_left, "staminaLeft": stamina_left,
        "reaction": REACTIONS["NONE"],
        "knockback": data["knockback"] * 0.25,
        "reason": "blocked",
    }


def resolve_parry(attack: Dict[str, Any], defender: Dict[str, Any]) -> Dict[str, Any]:
    p_data = MOVE_DATA["parry"]
    total = p_data["startup"] + p_data["active"] + p_data["recovery"]
    progress = defender.get("animProgress", 0) or 0
    local_time = progress * total
    in_window = local_time >= p_data["startup"] and local_time <= p_data["startup"] + p_data["active"]
    if not in_window:
        # Late/early parry becomes a normal hit. Use a distance inside
        # the move's optimal range band so the new edge-to-edge range
        # check doesn't false-reject the fallthrough hit.
        data = MOVE_DATA.get(attack.get("move", ""))
        fallthrough_distance = data.get("optimalRange", 2.0) if data else 2.0
        return resolve_attack(
            attack,
            {**defender, "anim": "idle", "isBlocking": False},
            fallthrough_distance, 0,
        )
    return {
        "hit": False, "parried": True,
        "staminaReward": COMBAT_CONFIG["parryStaminaReward"],
        "reaction": REACTIONS["NONE"],
        "counterWindow": p_data["active"] * 0.8,
        "reason": "parried",
    }


def resolve_clinch(attacker: Dict[str, Any], defender: Dict[str, Any], distance: float = 0.0) -> Dict[str, Any]:
    data = MOVE_DATA["clinch"]
    min_range = data.get("minRange", 0)
    max_range = data.get("maxRange", data["range"])
    if distance < min_range or distance > max_range:
        return {"success": False, "reason": "out_of_range"}
    # Facing check: attacker must be oriented toward the defender.
    attacker_pos = attacker.get("position") if attacker else None
    defender_pos = defender.get("position")
    attacker_facing = attacker.get("facing") if attacker else None
    if attacker_pos and defender_pos and attacker_facing is not None:
        dx = defender_pos[0] - attacker_pos[0]
        if dx != 0:
            correct_side = (1 if dx > 0 else -1) == (1 if attacker_facing > 0 else -1)
            if not correct_side:
                return {"success": False, "reason": "wrong_facing"}
    if defender.get("anim") in GRAPPLE_MOVES:
        return {"success": False, "reason": "defender_occupied"}
    if defender.get("anim") in DEFENSIVE_MOVES:
        return {"success": False, "reason": "defended"}
    damage = data["damage"]
    hp_left = max(0, (defender.get("hp", 0) or 0) - damage)
    return {
        "success": True, "damage": damage, "hpLeft": hp_left,
        "reaction": REACTIONS["CLINCHED"], "grappled": True,
        "duration": 1.2, "reason": "clinched",
    }


def resolve_throw(attacker: Dict[str, Any], defender: Dict[str, Any], distance: float = 0.0) -> Dict[str, Any]:
    data = MOVE_DATA["throw"]
    min_range = data.get("minRange", 0)
    max_range = data.get("maxRange", data["range"])
    if distance < min_range or distance > max_range:
        return {"success": False, "reason": "out_of_range"}
    # Facing check.
    attacker_pos = attacker.get("position") if attacker else None
    defender_pos = defender.get("position")
    attacker_facing = attacker.get("facing") if attacker else None
    if attacker_pos and defender_pos and attacker_facing is not None:
        dx = defender_pos[0] - attacker_pos[0]
        if dx != 0:
            correct_side = (1 if dx > 0 else -1) == (1 if attacker_facing > 0 else -1)
            if not correct_side:
                return {"success": False, "reason": "wrong_facing"}
    if defender.get("anim") == "backstep":
        return {"success": False, "reason": "evaded"}
    damage = data["damage"]
    if defender.get("anim") == "clinch":
        damage *= COMBAT_CONFIG["grappledDamageMultiplier"]
    damage = int(round(damage))
    hp_left = max(0, (defender.get("hp", 0) or 0) - damage)
    return {
        "success": True, "damage": damage, "hpLeft": hp_left,
        "reaction": REACTIONS["FALL"], "knockback": data["knockback"],
        "grappled": False, "duration": 1.4, "reason": "thrown",
    }


def resolve_attack(
    attack: Dict[str, Any], defender: Dict[str, Any],
    distance: float, dt: float, ctx: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    ctx = ctx or {}
    data = MOVE_DATA.get(attack.get("move", ""))
    if not data:
        return {"hit": False, "reason": "unknown_move"}
    # Edge-to-edge range check (minRange..maxRange with damage falloff
    # outside the optimal sweet spot). Mirrors the JS resolver.
    min_range = data.get("minRange")
    if min_range is None:
        min_range = data["range"] * 0.3
    max_range = data.get("maxRange")
    if max_range is None:
        max_range = data["range"]
    if distance < min_range or distance > max_range:
        return {"hit": False, "reason": "out_of_range"}
    # Facing check: attacker must be oriented toward the defender.
    attacker_pos = attack.get("position")
    defender_pos = defender.get("position")
    attacker_facing = attack.get("facing")
    if attacker_pos and defender_pos and attacker_facing is not None:
        dx = defender_pos[0] - attacker_pos[0]
        if dx != 0:
            correct_side = (1 if dx > 0 else -1) == (1 if attacker_facing > 0 else -1)
            if not correct_side:
                return {"hit": False, "reason": "wrong_facing"}
    # Range-scale damage falloff. Optimal +/- 0.4 = full damage;
    # outside that band = 80% damage.
    range_scale = 1.0
    optimal = data.get("optimalRange")
    if optimal is not None:
        if abs(distance - optimal) > 0.4:
            range_scale = 0.8
    total = data["startup"] + data["active"] + data["recovery"]
    progress = attack.get("animProgress", 0) or 0
    local_time = progress * total
    in_active = local_time >= data["startup"] and local_time <= data["startup"] + data["active"]
    if not in_active:
        return {"hit": False, "reason": "not_active"}
    if defender.get("isBlocking"):
        return resolve_block(attack, defender)
    if defender.get("anim") == "parry":
        return resolve_parry(attack, defender)
    if defender.get("anim") == "backstep":
        return {"hit": False, "reason": "evaded"}
    damage = float(data["damage"]) * range_scale
    counter_hit = is_counter_hit_vulnerable(defender, defender.get("anim", "idle"))
    if counter_hit:
        damage *= COMBAT_CONFIG["counterHitMultiplier"]
    combo_count = int(ctx.get("comboCount", 0) or 0)
    damage *= get_combo_scale(combo_count)
    if ctx.get("defenderIsGrappled"):
        damage *= COMBAT_CONFIG["grappledDamageMultiplier"]
    damage = int(round(damage))
    hp_left = max(0, (defender.get("hp", 0) or 0) - damage)
    reaction = pick_reaction(attack["move"], damage, hp_left)
    return {
        "hit": True, "damage": damage, "hpLeft": hp_left,
        "reaction": reaction, "knockback": data["knockback"],
        "counterHit": counter_hit, "rangeScale": range_scale, "reason": "hit",
    }


def resolve_gemma_move(
    move: str, attacker: Dict[str, Any], defender: Dict[str, Any],
    distance: float, dt: float = 0.0,
) -> Dict[str, Any]:
    if move == "parry":
        return {"hit": False, "reason": "parry_stance"}
    if move == "backstep":
        return {"hit": False, "reason": "evasive_stance"}
    if move == "clinch":
        return resolve_clinch(attacker, defender, distance)
    if move == "throw":
        return resolve_throw(attacker, defender, distance)
    return resolve_attack(
        {"move": move, "animProgress": 1.0}, defender, distance, dt,
    )


def get_reaction_duration(reaction: str, heavy: bool = False) -> float:
    if reaction == REACTIONS["FLINCH"]:
        return 0.30
    if reaction == REACTIONS["STUMBLE"]:
        return 0.55
    if reaction == REACTIONS["KNOCKDOWN"]:
        return 1.20 if heavy else 0.80
    if reaction == REACTIONS["FALL"]:
        return 1.60
    if reaction == REACTIONS["CLINCHED"]:
        return 1.40
    return 0.0
