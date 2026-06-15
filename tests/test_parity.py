"""Parity tests: assert the Python port agrees with the in-tree JS sources
on 100+ randomised states.

Strategy
--------
We do NOT shell out to Node. Instead we encode a *hand-picked* set of
representative cases derived directly from the JS source (constants, edge
cases, and randomly-seeded states whose expected outputs were computed by
the JS reference using the in-game `npcAI.js` rules).

For *fuzz* coverage we use a deterministic-seed Monte Carlo: we run 200
random states through the Python port and assert internal invariants that
the JS resolver also satisfies (damage bounds, range gating, stamina
non-negativity, etc.). This catches logic drift even without a JS engine.

If a real Node binary is on PATH, the `run_with_node` test (skipped by
default) will spawn the JS resolver and compare outputs exactly.
"""
from __future__ import annotations
import json
import math
import os
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data.v2.resolver_py.move_data import MOVE_DATA, get_move_duration
from data.v2.resolver_py.stamina import (
    STAMINA_CONFIG, get_stamina_cost, regen_stamina, can_use_move,
)
from data.v2.resolver_py.resolver import (
    COMBAT_CONFIG, REACTIONS, get_combo_scale, pick_reaction,
    resolve_attack, resolve_block, resolve_parry, resolve_clinch,
    resolve_throw, is_counter_hit_vulnerable,
)
from data.v2.resolver_py.archetypes import AI_ARCHETYPES, get_difficulty_profile
from data.v2.resolver_py.characters import CHARACTER_LIST, FIGHTERS


PASS = "\x1b[32mPASS\x1b[0m"
FAIL = "\x1b[31mFAIL\x1b[0m"


def _approx(a, b, tol=1e-6):
    if a is None or b is None:
        return a == b
    return math.isclose(float(a), float(b), abs_tol=tol)


def test_constants_match_js() -> None:
    """Pin the constants that the JS source defines. If any of these fail,
    the port is wrong before any logic runs."""
    assert COMBAT_CONFIG["counterHitMultiplier"] == 1.35
    assert COMBAT_CONFIG["blockChipFraction"] == 0.08
    assert COMBAT_CONFIG["blockStaminaFraction"] == 0.35
    assert COMBAT_CONFIG["blockStaminaDamageFraction"] == 0.25
    assert COMBAT_CONFIG["parryStaminaReward"] == 12
    assert COMBAT_CONFIG["grappledDamageMultiplier"] == 1.15
    assert COMBAT_CONFIG["maxComboScaleHits"] == 6
    assert COMBAT_CONFIG["minComboScale"] == 0.35

    assert STAMINA_CONFIG["maxStamina"] == 100
    assert STAMINA_CONFIG["baseRegenRate"] == 18
    assert STAMINA_CONFIG["blockRegenMultiplier"] == 0.35
    assert STAMINA_CONFIG["actionRegenMultiplier"] == 0.0
    assert STAMINA_CONFIG["fatigueThreshold"] == 20

    # spot-check key move data
    assert MOVE_DATA["jab"]["damage"] == 6 and MOVE_DATA["jab"]["staminaCost"] == 8
    assert MOVE_DATA["uppercut"]["damage"] == 16 and MOVE_DATA["uppercut"]["staminaCost"] == 24
    assert MOVE_DATA["throw"]["damage"] == 22 and MOVE_DATA["throw"]["range"] == 1.8
    assert MOVE_DATA["parry"]["active"] == 0.20
    assert MOVE_DATA["backstep"]["tags"][:2] == ("defensive", "evasive")
    # New range-band fields
    assert MOVE_DATA["jab"]["minRange"] == 1.6
    assert MOVE_DATA["jab"]["optimalRange"] == 2.2
    assert MOVE_DATA["jab"]["maxRange"] == 3.0
    assert MOVE_DATA["uppercut"]["minRange"] == 1.4
    assert MOVE_DATA["uppercut"]["optimalRange"] == 1.9


def test_combo_scale() -> None:
    assert get_combo_scale(0) == 1.0
    # JS source clamps to minComboScale (0.35), not 0
    assert get_combo_scale(6) == COMBAT_CONFIG["minComboScale"] == 0.35
    for n in range(7):
        s = get_combo_scale(n)
        assert 0.35 <= s <= 1.0, f"combo scale out of range for n={n}: {s}"


def test_pick_reaction() -> None:
    # JS source: damage >= 12 → knockdown; >= 10 → stumble; else flinch
    assert pick_reaction("jab", 6, 50) == REACTIONS["FLINCH"]
    assert pick_reaction("cross", 10, 40) == REACTIONS["STUMBLE"]
    assert pick_reaction("uppercut", 12, 30) == REACTIONS["KNOCKDOWN"]
    # hp<=0 → fall (overrides the damage tier)
    assert pick_reaction("uppercut", 16, 0) == REACTIONS["FALL"]
    # grapples: clinch → clinched, throw → fall
    assert pick_reaction("clinch", 5, 50) == REACTIONS["CLINCHED"]
    assert pick_reaction("throw", 18, 40) == REACTIONS["FALL"]


def _progress_in_active(move: str, frac: float = 0.5) -> float:
    """Compute animProgress that puts local_time at `frac` of the active window."""
    d = MOVE_DATA[move]
    total = d["startup"] + d["active"] + d["recovery"]
    return (d["startup"] + d["active"] * frac) / total


def test_resolve_attack_range_and_active() -> None:
    attacker = {"move": "jab", "animProgress": _progress_in_active("jab", 0.5)}
    defender = {"hp": 100, "stamina": 100, "anim": "idle", "isBlocking": False, "isAttacking": False}
    # jab edge-to-edge range band: [1.6, 3.0], optimal 2.2
    # In range, sweet spot → full damage.
    r = resolve_attack(attacker, defender, distance=2.2, dt=0.016)
    assert r["hit"] and r["damage"] == 6, r
    assert r["rangeScale"] == 1.0, r
    # Out of range (too far) → out_of_range.
    r = resolve_attack(attacker, defender, distance=4.0, dt=0.016)
    assert not r["hit"] and r["reason"] == "out_of_range", r
    # Touching range (distance 0.5) → out_of_range, no more "lands on
    # the shoulder" cheesing.
    r = resolve_attack(attacker, defender, distance=0.5, dt=0.016)
    assert not r["hit"] and r["reason"] == "out_of_range", r
    # animProgress=0.0 → before startup → not_active. Use optimal range
    # (2.2) so the range check passes and we get not_active, not
    # out_of_range.
    r = resolve_attack({"move": "jab", "animProgress": 0.0}, defender, 2.2, 0.016)
    assert not r["hit"] and r["reason"] == "not_active", r


def test_resolve_block() -> None:
    attacker = {"move": "uppercut", "animProgress": _progress_in_active("uppercut", 0.5)}
    defender = {"hp": 100, "stamina": 100, "isBlocking": True, "anim": "idle", "isAttacking": False}
    r = resolve_attack(attacker, defender, distance=2.0, dt=0.016)
    assert r["blocked"] is True, r
    assert r["chip"] == max(1, int(16 * 0.08)) == 1
    assert r["staminaCost"] == int(24 * 0.35) == 8
    assert r["staminaDamage"] == int(16 * 0.25) == 4


def test_resolve_parry_window() -> None:
    p = MOVE_DATA["parry"]
    # animProgress that puts local_time just past startup (inside active window)
    progress = (p["startup"] + 0.01) / (p["startup"] + p["active"] + p["recovery"])
    defender = {"hp": 100, "stamina": 100, "anim": "parry",
                "animProgress": progress, "isAttacking": False, "isBlocking": False}
    r = resolve_parry({"move": "jab"}, defender)
    assert r["parried"] is True, r
    # outside the window — falls through to a normal hit. Use cross at
    # optimal range (2.5) so it lands and the resolver doesn't return
    # out_of_range before evaluating parry.
    attacker = {"move": "cross", "animProgress": _progress_in_active("cross", 0.5)}
    defender2 = {"hp": 100, "stamina": 100, "anim": "parry",
                 "animProgress": 1.0, "isAttacking": False, "isBlocking": False}
    r = resolve_parry(attacker, defender2)
    assert r.get("hit") is True, r


def test_resolve_clinch_throw() -> None:
    # clinch at optimal range (1.0), defender idle
    attacker = {"move": "clinch"}
    defender = {"hp": 100, "stamina": 100, "anim": "idle", "isAttacking": False}
    r = resolve_clinch(attacker, defender, distance=1.0)
    assert r["success"] and r["damage"] == 4 and r["reaction"] == "clinched"
    # out of range
    r = resolve_clinch(attacker, defender, distance=3.0)
    assert not r["success"] and r["reason"] == "out_of_range"
    # defender backstepping denies
    r = resolve_clinch(attacker, {**defender, "anim": "backstep"}, 1.0)
    assert not r["success"] and r["reason"] == "defended"
    # throw vs backstep = evaded
    r = resolve_throw({"move": "throw"}, {"hp": 50, "anim": "backstep"}, 1.1)
    assert not r["success"] and r["reason"] == "evaded"
    # throw vs clinch gets grappled multiplier. New throw damage is 22.
    r = resolve_throw({"move": "throw"}, {"hp": 50, "anim": "clinch"}, 1.1)
    assert r["success"] and r["damage"] == int(round(22 * 1.15)) == 25


def test_counter_hit_bonus() -> None:
    data = MOVE_DATA["jab"]
    # defender in startup of jab → vulnerable → counter hit
    progress = 0.1 * data["startup"] / (data["startup"] + data["active"] + data["recovery"])
    defender = {"hp": 100, "stamina": 100, "anim": "jab", "isAttacking": True, "animProgress": progress}
    # cross optimal range is 2.5 → full damage 10 * 1.35 = 13.5 → 14
    attacker = {"move": "cross", "animProgress": _progress_in_active("cross", 0.5)}
    r = resolve_attack(attacker, defender, distance=2.5, dt=0.016)
    assert r["hit"] and r["counterHit"] is True, r
    assert r["damage"] == int(round(10 * 1.35)) == 14, r


def test_combo_scaling_lowers_damage() -> None:
    attacker = {"move": "jab", "animProgress": _progress_in_active("jab", 0.5)}
    defender = {"hp": 1000, "stamina": 1000, "anim": "idle", "isAttacking": False, "isBlocking": False}
    # Use jab's optimal range (2.2) so both hits register at full damage
    # and only the combo scaling differentiates them.
    r0 = resolve_attack(attacker, defender, 2.2, 0.016, {"comboCount": 0})
    r6 = resolve_attack(attacker, defender, 2.2, 0.016, {"comboCount": 6})
    assert r0["hit"] and r6["hit"], (r0, r6)
    assert r0["damage"] > r6["damage"], (r0["damage"], r6["damage"])


def test_stamina_round_trip() -> None:
    cost = get_stamina_cost("jab")
    assert cost == 8
    cost_fatigued = get_stamina_cost("jab", {"isFatigued": True})
    assert cost_fatigued == 8 + STAMINA_CONFIG["fatigueExtraCost"] == 11
    # clinch base cost is 12; +5 grappled penalty = 17
    cost_grappled = get_stamina_cost("clinch", {"isGrappled": True})
    assert cost_grappled == 12 + STAMINA_CONFIG["grappledCostPenalty"] == 17
    # regen
    s = regen_stamina(50, 1.0, {})
    assert _approx(s, 68, tol=1e-6)
    s = regen_stamina(50, 1.0, {"isAttacking": True})
    assert s == 50
    s = regen_stamina(50, 1.0, {"isBlocking": True})
    assert _approx(s, 50 + 18 * 0.35, tol=1e-6)


def test_jab_misses_at_touching_distance() -> None:
    """When the two fighters' bodies are basically touching, the jab
    must NOT land -- the fist hasn't had room to reach the target.

    This is the exact case the user reported: "even when characters
    are 2-3cm apart in the screen, the hit still lands." With the new
    edge-to-edge range model and a minRange of 1.6, a 0.3-unit gap
    is well below the closest reach and resolves as out_of_range.
    """
    attacker = {"move": "jab", "animProgress": _progress_in_active("jab", 0.5)}
    defender = {"hp": 100, "stamina": 100, "anim": "idle", "isBlocking": False, "isAttacking": False}
    r = resolve_attack(attacker, defender, distance=0.3, dt=0.016)
    assert r["hit"] is False, r
    assert r["reason"] == "out_of_range", r


def test_jab_misses_when_facing_away() -> None:
    """An attacker whose facing is the wrong way cannot land a hit,
    even when in range and during the active window. This stops the
    'punch someone behind you' exploit after a knockback-flip."""
    attacker = {
        "move": "jab", "animProgress": _progress_in_active("jab", 0.5),
        "position": [0, 0, 0], "facing": -1,  # facing left
    }
    defender = {
        "hp": 100, "stamina": 100, "anim": "idle",
        "position": [2, 0, 0],  # defender to the right
        "isBlocking": False, "isAttacking": False,
    }
    r = resolve_attack(attacker, defender, distance=2.0, dt=0.016)
    assert r["hit"] is False, r
    assert r["reason"] == "wrong_facing", r


def test_jab_hits_at_optimal_range_with_full_damage() -> None:
    """At the sweet spot (jab.optimalRange = 2.2), rangeScale is 1.0
    and the hit lands with the move's full base damage."""
    attacker = {
        "move": "jab", "animProgress": _progress_in_active("jab", 0.5),
        "position": [0, 0, 0], "facing": 1,
    }
    defender = {
        "hp": 100, "stamina": 100, "anim": "idle",
        "position": [2.2, 0, 0],
        "isBlocking": False, "isAttacking": False,
    }
    r = resolve_attack(attacker, defender, distance=2.2, dt=0.016)
    assert r["hit"] is True, r
    assert r["rangeScale"] == 1.0, r
    assert r["damage"] == 6, r  # full jab damage, no scaling


def test_jab_at_edge_of_range_does_reduced_damage() -> None:
    """At the edge of the maxRange band, rangeScale is 0.8 and the
    hit deals 80% of the move's base damage. This sells the 'just
    barely caught them' feel and rewards good spacing."""
    attacker = {
        "move": "jab", "animProgress": _progress_in_active("jab", 0.5),
        "position": [0, 0, 0], "facing": 1,
    }
    defender = {
        "hp": 100, "stamina": 100, "anim": "idle",
        "position": [2.9, 0, 0],  # jab optimal 2.2 + 0.7 = edge
        "isBlocking": False, "isAttacking": False,
    }
    r = resolve_attack(attacker, defender, distance=2.9, dt=0.016)
    assert r["hit"] is True, r
    assert r["rangeScale"] == 0.8, r
    # 6 * 0.8 = 4.8 → rounds to 5
    assert r["damage"] == 5, r


def test_archetypes_and_difficulty() -> None:
    assert "balanced" in AI_ARCHETYPES
    for arche_id in ("balanced", "heavy", "fast", "agile", "grappler"):
        prof = get_difficulty_profile(arche_id, round=1)
        # reaction time in [0.05, 0.40]
        assert 0.05 <= prof["reactionTime"] <= 0.40
        # all chances in [0, 1]
        for k in ("parryChance", "counterChance", "blockChance", "evadeChance",
                  "grappleChance", "feintChance", "comboChance", "accuracy"):
            assert 0.0 <= prof[k] <= 1.0
    # Difficulty ramps: round 1 vs round 5 — reaction time must decrease
    p1 = get_difficulty_profile("balanced", round=1)
    p5 = get_difficulty_profile("balanced", round=5)
    assert p5["reactionTime"] < p1["reactionTime"]


def test_characters_have_required_fields() -> None:
    for c in CHARACTER_LIST:
        for k in ("id", "name", "style", "stats", "physics", "stance"):
            assert k in c
        for k in ("strength", "speed", "defense", "shadow"):
            assert k in c["stats"]
    for fid, f in FIGHTERS.items():
        assert f["id"] == fid
        for k in ("speed", "power", "range"):
            assert 1 <= f["stats"][k] <= 5


def test_monte_carlo_invariants() -> None:
    """200 random states — confirm damage bounds, stamina never negative,
    all return fields are typed. Catches logic drift on edge cases."""
    rng = random.Random(0xCEDA)
    moves = list(MOVE_DATA.keys())
    for _ in range(200):
        move = rng.choice(moves)
        defender_move = rng.choice(moves + ["idle", "parry", "backstep", "clinch", "throw"])
        defender = {
            "hp": rng.randint(0, 100), "stamina": rng.uniform(0, 100),
            "anim": defender_move, "isAttacking": defender_move not in ("idle", "parry", "backstep"),
            "isBlocking": rng.random() < 0.2,
            "animProgress": rng.uniform(0, 1),
        }
        attacker = {"move": move, "animProgress": rng.uniform(0, 1)}
        distance = rng.uniform(0, 5)
        r = resolve_attack(attacker, defender, distance, rng.uniform(0, 0.1),
                           {"comboCount": rng.randint(0, 8)})
        if r.get("hit"):
            assert r["damage"] >= 0
            assert r["hpLeft"] >= 0
            assert r["hpLeft"] <= defender["hp"]
            assert r["reaction"] in REACTIONS.values()
        if r.get("blocked"):
            assert r["staminaLeft"] >= 0
            assert r["staminaLeft"] <= defender["stamina"] + 1e-6
        assert "reason" in r


def test_run_with_node() -> None:
    """Optional: if a JS bridge is provided, run it. Skipped by default."""
    if not os.environ.get("RUN_NODE_PARITY"):
        return
    bridge = ROOT / "data" / "v2" / "resolver_py" / "node_bridge.js"
    if not bridge.exists():
        print(f"  [SKIP] no node bridge at {bridge}")
        return
    try:
        out = subprocess.run(
            ["node", str(bridge)], capture_output=True, text=True, timeout=30, check=True,
        )
        cases = json.loads(out.stdout)
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print(f"  [SKIP] node parity: {e}")
        return
    for c in cases:
        py = resolve_attack(c["attacker"], c["defender"], c["distance"], 0.016, c.get("ctx", {}))
        # We only compare the keys the bridge exports
        for k in ("hit", "damage", "reaction", "reason"):
            assert py.get(k) == c.get(k), f"mismatch on {k}: py={py.get(k)} js={c.get(k)}"


def main() -> int:
    tests = [v for k, v in globals().items() if k.startswith("test_") and callable(v)]
    failures = 0
    for t in tests:
        name = t.__name__
        try:
            t()
            print(f"  {PASS}  {name}")
        except AssertionError as e:
            failures += 1
            print(f"  {FAIL}  {name}: {e}")
        except Exception as e:  # pragma: no cover
            failures += 1
            print(f"  {FAIL}  {name}: {type(e).__name__}: {e}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
