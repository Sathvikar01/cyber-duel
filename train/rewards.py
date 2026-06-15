"""Verifiable reward function for GRPO.

Inputs: a single counter_move string and a state-prompt string.
Output: a scalar reward in [-1, 1].

We re-parse the prompt to recover the state, then evaluate the counter
via the Python resolver. This is the same scoring as the SFT dataset
generator's `score_counter` but with stochastic rollouts (K=4) and
returns a single scalar.
"""
from __future__ import annotations
import re
import random
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data.v2.resolver_py import (
    CHARACTER_LIST, FIGHTERS, MOVE_DATA, get_stamina_cost, get_move_duration,
    resolve_attack, resolve_gemma_move,
)


_ROLL_DISTANCE = {"close": 1.5, "mid": 3.0, "far": 4.5}


def _parse_prompt(prompt: str) -> Optional[dict]:
    """Reverse-parse the state dict from the formatted prompt.

    Format produced by generate_data_v2.build_user_prompt:
      Round <r> | Distance: <bucket>
      Player: <id> (speed=..., power=..., range=..., weight=..., stance=..., stamina=..., hp=100)
      NPC   : <id> (speed=..., power=..., range=..., weight=..., stance=..., stamina=..., hp=100)
      Player last 5 moves: m1, m2, m3, m4, m5
    """
    out = {}
    m = re.search(r"Round\s+(\d+)\s*\|\s*Distance:\s*(\w+)", prompt)
    if not m:
        return None
    out["round"] = int(m.group(1))
    out["distance_bucket"] = m.group(2)
    out["distance"] = _ROLL_DISTANCE.get(out["distance_bucket"], 3.0)

    p = re.search(
        r"Player:\s+(\w+)\s*\(speed=(\d+),\s*power=(\d+),\s*range=(\d+),\s*"
        r"weight=([\d.]+),\s*stance=(\w+),\s*stamina=(\d+),\s*hp=100\)",
        prompt,
    )
    if p:
        out["player_char_id"] = p.group(1)
        out["player_speed"] = int(p.group(2))
        out["player_power"] = int(p.group(3))
        out["player_range"] = int(p.group(4))
        out["player_weight"] = float(p.group(5))
        out["player_stance"] = p.group(6)
        out["player_stamina"] = int(p.group(7))
    n = re.search(
        r"NPC\s*:\s*(\w+)\s*\(speed=(\d+),\s*power=(\d+),\s*range=(\d+),\s*"
        r"weight=([\d.]+),\s*stance=(\w+),\s*stamina=(\d+),\s*hp=100\)",
        prompt,
    )
    if n:
        out["npc_char_id"] = n.group(1)
        out["npc_speed"] = int(n.group(2))
        out["npc_power"] = int(n.group(3))
        out["npc_range"] = int(n.group(4))
        out["npc_weight"] = float(n.group(5))
        out["npc_stance"] = n.group(6)
        out["npc_stamina"] = int(n.group(7))
    m5 = re.search(r"Player last 5 moves:\s*([\w_,\s]+?)\s*Decide", prompt)
    if m5:
        out["last5"] = tuple(s.strip() for s in m5.group(1).split(","))
    return out


def _score_against_predicted(state, counter, predicted) -> float:
    pred_data = MOVE_DATA[predicted]
    total_p = pred_data["startup"] + pred_data["active"] + pred_data["recovery"]
    progress = (pred_data["startup"] + pred_data["active"] * 0.5) / total_p
    player = {
        "hp": 100, "stamina": float(state["player_stamina"]),
        "anim": predicted, "isAttacking": True, "isBlocking": False,
        "animProgress": progress,
    }
    npc = {
        "hp": 100, "stamina": float(state["npc_stamina"]),
        "anim": "idle", "isAttacking": False, "isBlocking": False, "animProgress": 0.0,
    }
    if counter in ("parry", "backstep", "clinch", "throw"):
        npc["anim"] = counter
        result = resolve_gemma_move(counter, npc, player, state["distance"])
    else:
        npc_data = MOVE_DATA[counter]
        npc_total = get_move_duration(counter)
        attack_progress = (npc_data["startup"] + npc_data["active"] * 0.5) / npc_total
        result = resolve_attack(
            {"move": counter, "animProgress": attack_progress},
            player, state["distance"], 0.016,
        )
    r = 0.02
    cost = get_stamina_cost(counter)
    if state["npc_stamina"] < cost:
        r -= 0.20
    if result.get("parried"):
        r += 0.25
    if result.get("reason") == "evaded":
        r += 0.15 if pred_data["range"] > 2.0 else 0.05
    if result.get("hit"):
        r += 0.30
        if result.get("counterHit"):
            r += 0.20
        if result.get("reaction") in ("stumble", "knockdown", "fall", "clinched"):
            r += 0.15
    elif result.get("reason") in ("out_of_range", "not_active"):
        r -= 0.10
    if counter in ("clinch", "throw") and result.get("success"):
        r += 0.25
    return r


def compute_reward(counter: str, prompt: str, k: int = 4) -> float:
    """GRPO reward for one completion."""
    state = _parse_prompt(prompt)
    if state is None or "last5" not in state or "npc_stamina" not in state:
        # Unparseable prompt — strong negative so the model learns format
        return -1.0

    legal = ("jab", "cross", "low_kick", "roundhouse", "uppercut",
             "parry", "backstep", "clinch", "throw")
    if counter not in legal:
        return -0.5

    counts = {}
    for m in state["last5"]:
        counts[m] = counts.get(m, 0) + 1
    top3 = sorted(counts.items(), key=lambda kv: -kv[1])
    top3 = [m for m, _ in top3[:3]] or ["jab"]

    rng = random.Random(hash(prompt) & 0xFFFFFFFF)
    total = 0.0
    for _ in range(k):
        for predicted in top3:
            total += _score_against_predicted(state, counter, predicted)
    expected = total / (k * len(top3))

    last5 = list(state["last5"])
    dist_bucket = state["distance_bucket"]

    # Apply the same attribute tiebreakers as the SFT generator so GRPO
    # converges to the same decision surface.
    if dist_bucket == "close" and state["npc_stamina"] >= 18:
        if counter in ("clinch", "throw"):
            expected += 0.20
        if counter in ("roundhouse", "uppercut"):
            expected -= 0.10
    if state.get("player_speed", 3) >= 4 and last5.count("jab") + last5.count("cross") >= 3:
        if counter == "parry":
            expected += 0.18
        if counter == "backstep":
            expected += 0.10
    if dist_bucket == "far":
        if counter in ("jab", "low_kick", "clinch", "throw"):
            expected -= 0.20
        if counter in ("cross", "roundhouse") and state["npc_stamina"] >= 12:
            expected += 0.15
    if state["npc_stamina"] < 25:
        if counter in ("uppercut", "roundhouse", "throw"):
            expected -= 0.25
        if counter in ("parry", "backstep", "jab"):
            expected += 0.15
    if last5.count("roundhouse") >= 4:
        if counter in ("jab", "backstep", "parry"):
            expected += 0.10
    if last5.count("low_kick") >= 4 and counter == "parry":
        expected += 0.15

    return max(-1.0, min(1.0, expected))
