"""Procedural dataset generator for the Gemma-3-270M-IT combat advisor.

No external LLM. Uses the Python port of the in-game combat resolver to:

  1. Sample (character_pair, distance, stamina, round, last-5-moves) states.
  2. For each state, evaluate *every* legal NPC counter_move.
  3. Score each counter via a fast, deterministic, attribute-aware reward
     function (see `score_counter`).
  4. Pick the best and second-best as (chosen, rejected) for DPO/GRPO.
  5. Write attribute-aware templated reasoning that names the player/NPC
     stats and the move-pattern trigger. The reasoning quality is good
     enough to teach Gemma 3 270M the conditioning; GRPO sharpens it.

Output schema (one JSON object per line in JSONL):
  {
    "prompt":   "...",    # user message (Gemma chat template applied at train time)
    "chosen":   "...",    # full assistant turn ending with `counter_move: <move>`
    "rejected": "...",    # second-best full assistant turn
    "state":    {...},    # for analysis / DPO pairing
    "scores":   {...},    # per-counter reward dictionary
  }
"""
from __future__ import annotations
import argparse
import hashlib
import itertools
import json
import math
import random
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from data.v2.resolver_py import (
    CHARACTER_LIST, FIGHTERS, MOVE_DATA, GEMMA_MOVES,
    resolve_attack, resolve_clinch, resolve_throw, resolve_gemma_move,
    get_stamina_cost, get_move_duration,
)

PLAYER_MOVES = ("jab", "cross", "low_kick", "roundhouse", "uppercut")
GEMMA_DEFENSIVE = ("parry", "backstep")
GEMMA_GRAPPLE = ("clinch", "throw")
LEGAL_COUNTERS = list(GEMMA_MOVES)

# 5 move-pattern archetypes. Each is a generator of 5-grams.
PATTERN_GENERATORS: Dict[str, Any] = {
    "aggressive_rushdown": lambda r: [r.choice(PLAYER_MOVES) for _ in range(5)],
    "low_kick_spam":       lambda r: _interleave(r, "low_kick", r.choice(("jab", "cross"))),
    "poke_and_reset":      lambda r: ["jab", "cross", "jab", "cross", r.choice(("low_kick", "roundhouse"))],
    "high_low_mixup":      lambda r: [r.choice(("jab", "low_kick", "cross", "uppercut")) for _ in range(5)],
    "roundhouse_spam":     lambda r: ["roundhouse"] * 5,
    "punish_heavy":        lambda r: ["uppercut", "roundhouse", "uppercut", "roundhouse", r.choice(PLAYER_MOVES)],
    "evasive_jab":         lambda r: ["jab", r.choice(("backstep",)), "jab", r.choice(("backstep",)), "jab"],
    "block_and_grab":      lambda r: ["cross", "jab", "cross", "jab", "low_kick"],
}


def _interleave(rng: random.Random, target: str, other_pool: Tuple[str, ...]) -> List[str]:
    seq = []
    for i in range(5):
        if i % 2 == 0:
            seq.append(target)
        else:
            seq.append(rng.choice(other_pool))
    return seq


# ---------------------------------------------------------------------------
# State sampling
# ---------------------------------------------------------------------------

@dataclass
class State:
    player_char_id: str
    npc_char_id: str
    player_speed: int
    player_power: int
    player_range: int
    player_weight: float
    player_stance: str
    npc_speed: int
    npc_power: int
    npc_range: int
    npc_weight: float
    npc_stance: str
    distance_bucket: str  # close / mid / far
    distance: float       # actual meters
    player_stamina: int
    npc_stamina: int
    round: int
    last5: Tuple[str, ...]
    pattern: str

    def key(self) -> str:
        h = hashlib.md5()
        h.update(repr((self.player_char_id, self.npc_char_id, self.distance_bucket,
                       self.player_stamina, self.npc_stamina, self.round, self.last5)).encode())
        return h.hexdigest()


def _fighter_stats(char_id: str) -> Tuple[int, int, int, float, str]:
    f = FIGHTERS[char_id]
    s = f["stats"]
    return s["speed"], s["power"], s["range"], f["physics"]["weight"], f["stance"]


def _char_stats(char_id: str) -> Tuple[int, int, int, int]:
    c = next(c for c in CHARACTER_LIST if c["id"] == char_id)
    s = c["stats"]
    return s["strength"], s["speed"], s["defense"], s["shadow"]


def sample_state(rng: random.Random) -> State:
    player_char_id = rng.choice(list(FIGHTERS.keys()))
    npc_char_id = rng.choice(list(FIGHTERS.keys()))
    p_speed, p_power, p_range, p_weight, p_stance = _fighter_stats(player_char_id)
    n_speed, n_power, n_range, n_weight, n_stance = _fighter_stats(npc_char_id)
    dist_bucket = rng.choice(("close", "mid", "far"))
    distance = {"close": 1.5, "mid": 3.0, "far": 4.5}[dist_bucket]
    player_stamina = rng.choice((100, 80, 50, 30, 15))
    npc_stamina = rng.choice((100, 80, 50, 30, 15))
    round_no = rng.choice((1, 2, 3, 4, 5))
    pattern_name = rng.choice(list(PATTERN_GENERATORS.keys()))
    last5 = tuple(PATTERN_GENERATORS[pattern_name](rng))
    # If evasive_jab injected "backstep" (not a legal player move), coerce to jab.
    last5 = tuple(m if m in PLAYER_MOVES else "jab" for m in last5)
    return State(
        player_char_id=player_char_id, npc_char_id=npc_char_id,
        player_speed=p_speed, player_power=p_power, player_range=p_range,
        player_weight=p_weight, player_stance=p_stance,
        npc_speed=n_speed, npc_power=n_power, npc_range=n_range,
        npc_weight=n_weight, npc_stance=n_stance,
        distance_bucket=dist_bucket, distance=distance,
        player_stamina=player_stamina, npc_stamina=npc_stamina,
        round=round_no, last5=last5, pattern=pattern_name,
    )


# ---------------------------------------------------------------------------
# Reward function
# ---------------------------------------------------------------------------

# Distance buckets used by the resolver: a move's `range` is in meters.
# close=1.5 → most things land; mid=3.0 → mid-range moves; far=4.5 → only long moves.


def _predict_player_next(state: State, rng: random.Random) -> str:
    """Heuristic prediction of the player's next move from their 5-gram.

    Used to set up the resolver state for scoring. We pick the move the
    player is most likely to repeat, biased by their character's range
    and the current distance.
    """
    counts: Dict[str, int] = {}
    for m in state.last5:
        counts[m] = counts.get(m, 0) + 1
    top = max(counts.items(), key=lambda kv: kv[1])[0]
    # If they're spamming one move, repeat it; else random.
    if counts[top] >= 3:
        return top
    return rng.choice(PLAYER_MOVES)


def _setup_defenders(state: State, predicted_player_move: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Build initial fighter dicts for the resolver."""
    player = {
        "hp": 100, "stamina": float(state.player_stamina),
        "anim": predicted_player_move, "isAttacking": True, "isBlocking": False,
        "animProgress": 0.5,  # in active
    }
    npc = {
        "hp": 100, "stamina": float(state.npc_stamina),
        "anim": "idle", "isAttacking": False, "isBlocking": False, "animProgress": 0.0,
    }
    return player, npc


def _player_state_for_predicted(predicted, anim_progress_local):
    """Build a 'player' dict whose local_time in their animation is at the
    given fractional point in [0, 1] of the move duration."""
    pred_data = MOVE_DATA[predicted]
    total = pred_data["startup"] + pred_data["active"] + pred_data["recovery"]
    progress = anim_progress_local * total / max(total, 1e-6)
    return {
        "hp": 100, "stamina": 100.0,
        "anim": predicted, "isAttacking": True, "isBlocking": False,
        "animProgress": progress,
    }


def _score_against_predicted(state, counter, predicted):
    """Average score for `counter` across the 3 phases of the player's predicted
    move: startup (counter-hit window), mid-active (parry window), and
    recovery (free punish). This rewards counters that are robust across
    the player's possible positions, not just one frame."""
    # Player NPCs for the 3 phases — for parry to be useful, the player must
    # be in startup (parry's active 0.30s catches their committed move).
    p_startup = _player_state_for_predicted(predicted, 0.0)        # windup
    p_active  = _player_state_for_predicted(predicted, 0.5)        # mid-active
    p_recover = _player_state_for_predicted(predicted, 0.85)       # recovery
    phases = [p_startup, p_active, p_recover]

    pred_data = MOVE_DATA[predicted]
    total = 0.0
    for player in phases:
        npc = {"hp": 100, "stamina": float(state.npc_stamina), "anim": "idle",
               "isAttacking": False, "isBlocking": False, "animProgress": 0.0}
        if counter in ("parry", "backstep", "clinch", "throw"):
            # For parry/backstep we need the NPC to be in that state
            npc["anim"] = counter
            npc["animProgress"] = 0.0
            # parry/backstep return stance reasons when the player is in
            # active. Force the right semantic by calling resolve_gemma_move.
            result = resolve_gemma_move(counter, npc, player, state.distance)
            if result.get("reason") == "parry_stance" or result.get("reason") == "evasive_stance":
                # The parry did not catch the player at this phase. No reward.
                continue
        else:
            npc_data = MOVE_DATA[counter]
            npc_total = get_move_duration(counter)
            attack_progress = (npc_data["startup"] + npc_data["active"] * 0.5) / npc_total
            result = resolve_attack({"move": counter, "animProgress": attack_progress},
                                    player, state.distance, 0.016)
        r = 0.02
        cost = get_stamina_cost(counter)
        if state.npc_stamina < cost:
            r -= 0.20
        if result.get("parried"):
            r += 0.25
        if result.get("reason") == "evaded":
            r += 0.20 if pred_data["range"] > 2.0 else 0.05
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
        # Stance reason (parry/backstep/clinch/throw) with no other effect
        # is a "free" choice — neutral.
        total += r
    return total / 3.0  # average over the 3 phases


def score_counter(state, counter, rng=None):
    """Expected reward for `counter` against the player's 5-gram pattern.

    We average over:
      - the 3 most-likely predicted next moves (by 5-gram frequency)
      - the 3 phases of each predicted move (startup, mid-active, recovery)
    This rewards counters that are robust across the player's possible
    next actions AND the moment in the animation we catch them in.
    """
    counts = {}
    for m in state.last5:
        counts[m] = counts.get(m, 0) + 1
    top3 = sorted(counts.items(), key=lambda kv: -kv[1])
    top3 = [m for m, _ in top3[:3]] or ["jab"]

    expected = 0.0
    weight_total = 0.0
    for m, c in counts.items():
        if m in top3:
            w = max(0.15, c / 5.0)  # freq-based weight, floored
            expected += w * _score_against_predicted(state, counter, m)
            weight_total += w
    expected /= max(weight_total, 1e-6)

    last5 = list(state.last5)

    # --- Attribute tiebreakers (stronger; each rule is decisive in its
    #     natural context so the SFT model sees all 9 moves) ---

    # Grapples win decisively at close range vs heavy/low-stamina players
    if state.distance_bucket == "close" and state.npc_stamina >= 18:
        if counter in ("clinch", "throw"):
            expected += 0.30
        if state.player_power >= 3:
            expected += 0.10
        if state.npc_stamina < 30:
            expected += 0.05
        # Tradeoff: heavy attacks are risky at close range
        if counter in ("roundhouse", "uppercut"):
            expected -= 0.10

    # Parry/backstep win when player is fast and spamming light moves
    if state.player_speed >= 4 and last5.count("jab") + last5.count("cross") >= 3:
        if counter == "parry":
            expected += 0.18
        if counter == "backstep":
            expected += 0.10
        if counter in ("uppercut", "roundhouse") and state.npc_stamina < 24:
            expected -= 0.05

    # At far range, only long attacks work
    if state.distance_bucket == "far":
        if counter in ("jab", "low_kick"):
            expected -= 0.20
        if counter in ("clinch", "throw"):
            expected -= 0.20
        if counter in ("cross", "roundhouse") and state.npc_stamina >= 12:
            expected += 0.15
        if counter == "parry":
            expected += 0.10  # parry at far range → catch their rush-in

    # NPC fatigued: only low-cost moves
    if state.npc_stamina < 25:
        if counter in ("uppercut", "roundhouse", "throw"):
            expected -= 0.25
        if counter in ("parry", "backstep", "jab"):
            expected += 0.15
        if counter in ("clinch", "low_kick"):
            expected += 0.05

    # Heavy spam patterns
    if last5.count("roundhouse") >= 4:
        if counter == "jab" and state.npc_stamina >= 8:
            expected += 0.15
        if counter == "backstep":
            expected += 0.15
        if counter == "parry":
            expected += 0.10

    if last5.count("low_kick") >= 4:
        if counter == "parry":
            expected += 0.15
        if counter == "low_kick":
            expected += 0.10  # mirror with your own low
        if counter == "jab":
            expected += 0.05

    if last5.count("jab") >= 4 and state.player_speed >= 3:
        if counter == "parry":
            expected += 0.10
        if counter in ("uppercut", "roundhouse") and state.npc_stamina >= 20:
            expected += 0.10  # punish the spam with a heavy

    # Long-range NPC always wants to keep distance
    if state.npc_range >= 4 and state.distance_bucket == "mid":
        if counter in ("cross", "roundhouse") and state.npc_stamina >= 12:
            expected += 0.08
        if counter in ("clinch", "throw"):
            expected -= 0.05

    # Mid range is the "neutral" zone — light attacks are good
    if state.distance_bucket == "mid":
        if counter in ("jab", "cross") and state.npc_stamina >= 8:
            expected += 0.05

    return expected


# ---------------------------------------------------------------------------
# Reasoning text (templated, attribute-aware)
# ---------------------------------------------------------------------------

def _player_char_name(char_id: str) -> str:
    return next((c["name"] for c in CHARACTER_LIST if c["id"] == char_id), char_id)


def _summarise_pattern(pattern: str, last5: Tuple[str, ...]) -> str:
    if pattern == "aggressive_rushdown":
        return f"constant pressure with {', '.join(last5)}"
    if pattern == "low_kick_spam":
        return "repeatedly returning to low_kick"
    if pattern == "poke_and_reset":
        return "using quick punch pokes before finishing low"
    if pattern == "high_low_mixup":
        return "mixing high punches with low kicks (high-low mixup)"
    if pattern == "roundhouse_spam":
        return "spamming roundhouse with no variation"
    if pattern == "punish_heavy":
        return "piling on heavy committed attacks"
    if pattern == "evasive_jab":
        return "poking and backing off (hit-and-run)"
    if pattern == "block_and_grab":
        return "conditioning with punches before a low grab setup"
    return ", ".join(last5)


def _counter_blurb(counter: str) -> str:
    return {
        "jab":       "a fast jab to interrupt",
        "cross":     "a cross to out-pace their rhythm",
        "low_kick":  "a low_kick to steal back initiative",
        "roundhouse":"a roundhouse to punish with a heavy",
        "uppercut":  "an uppercut to launch them out of the pattern",
        "parry":     "a parry to read their timing and punish the recovery",
        "backstep":  "a backstep to make their offense whiff and reset distance",
        "clinch":    "a clinch to close distance and start a grapple chain",
        "throw":     "a throw to cash in on close range",
    }[counter]


def generate_reasoning(state: State, counter: str) -> str:
    p_name = _player_char_name(state.player_char_id)
    n_name = _player_char_name(state.npc_char_id)
    pattern_desc = _summarise_pattern(state.pattern, state.last5)

    # Speed/weight/stance hints
    if state.player_speed >= 4:
        speed_note = f" {p_name} is fast (speed={state.player_speed}, weight={state.player_weight:.1f}) so their offense recovers quickly."
    elif state.player_speed <= 2:
        speed_note = f" {p_name} is slow (speed={state.player_speed}, weight={state.player_weight:.1f}) so committing a heavy is risky for them."
    else:
        speed_note = f" {p_name} has neutral speed (speed={state.player_speed})."

    if state.player_power >= 4:
        power_note = f" Their power is high ({state.player_power}), so a clean hit hurts."
    elif state.player_power <= 2:
        power_note = " Their power is low, so a well-timed interrupt is safe."
    else:
        power_note = ""

    if state.npc_stamina < 25:
        stamina_note = f" Your stamina is low ({state.npc_stamina}); spend it on a low-cost counter."
    elif state.player_stamina < 25:
        stamina_note = f" The player is fatigued ({state.player_stamina}); pressure with a heavy."
    else:
        stamina_note = ""

    if state.distance_bucket == "close":
        dist_note = " At close range, grappling and clinches are live."
    elif state.distance_bucket == "far":
        dist_note = f" At far range ({state.distance:.1f}m), only your long moves ({state.npc_range >= 3 and 'cross/roundhouse' or 'cross'}) connect reliably."
    else:
        dist_note = " At mid range, both poking and closing are options."

    blurb = _counter_blurb(counter)
    return (
        f"The player is {pattern_desc}.{speed_note}{power_note}{stamina_note}{dist_note} "
        f"The best response is {blurb}, which exploits this state's attributes."
    )


# ---------------------------------------------------------------------------
# Prompt construction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = (
    "You are an expert NPC AI for Duel of Albion, a 3D fighting game. "
    "Read the round, distance, both fighters' stats and stances, and the player's "
    "last 5 moves. Choose the single best counter-move from the 9 legal moves. "
    "Always end your reply with `counter_move: <move>` on its own line."
)


def build_user_prompt(state: State) -> str:
    return (
        f"Round {state.round} | Distance: {state.distance_bucket}\n"
        f"Player: {state.player_char_id} (speed={state.player_speed}, "
        f"power={state.player_power}, range={state.player_range}, "
        f"weight={state.player_weight:.1f}, stance={state.player_stance}, "
        f"stamina={state.player_stamina}, hp=100)\n"
        f"NPC   : {state.npc_char_id} (speed={state.npc_speed}, "
        f"power={state.npc_power}, range={state.npc_range}, "
        f"weight={state.npc_weight:.1f}, stance={state.npc_stance}, "
        f"stamina={state.npc_stamina}, hp=100)\n"
        f"Player last 5 moves: {', '.join(state.last5)}\n"
        f"Decide the best counter-move from: {', '.join(LEGAL_COUNTERS)}."
    )


def build_assistant_turn(state: State, counter: str) -> str:
    return f"{generate_reasoning(state, counter)}\ncounter_move: {counter}"


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------

def generate_dataset(
    n_states: int, seed: int = 0, max_dup_attempts: int = 4,
) -> List[Dict[str, Any]]:
    rng = random.Random(seed)
    seen_keys: set = set()
    rows: List[Dict[str, Any]] = []
    attempts = 0
    target = n_states
    while len(rows) < target and attempts < target * max_dup_attempts:
        attempts += 1
        state = sample_state(rng)
        if state.key() in seen_keys:
            continue
        seen_keys.add(state.key())

        # Score all 9 counters
        scores: Dict[str, float] = {}
        for c in LEGAL_COUNTERS:
            scores[c] = score_counter(state, c, rng)
        ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
        chosen_move, chosen_score = ranked[0]
        rejected_move, rejected_score = ranked[1]

        # ---- Hard override rules: in decisive contexts, force diversity ----
        # Close range + heavy player + enough stamina → grapple wins
        if (state.distance_bucket == "close"
                and state.npc_stamina >= 18
                and state.player_power >= 3):
            # throw wins more at very-close range, clinch slightly further out
            if state.npc_stamina >= 22 and state.distance <= 1.6:
                chosen_move = "throw"
            else:
                chosen_move = "clinch" if scores["clinch"] >= scores["throw"] else "throw"
            chosen_score = scores[chosen_move]
            rejected_move = max(
                (m for m in ("jab", "cross", "low_kick", "roundhouse", "uppercut")
                 if m != chosen_move and scores[m] >= scores[chosen_move] - 0.25),
                key=lambda m: scores[m],
                default="cross",
            )
            rejected_score = scores[rejected_move]
        # Far range → long poke wins (if stamina allows)
        elif state.distance_bucket == "far":
            if scores["cross"] >= scores["roundhouse"]:
                chosen_move = "cross"
            else:
                chosen_move = "roundhouse"
            chosen_score = scores[chosen_move]
            # Rejected is a non-viable far-range option
            rejected_move = max(("jab", "low_kick", "clinch", "throw"),
                                key=lambda m: scores[m])
            rejected_score = scores[rejected_move]
        # Player fatigued → NPC punishes with a heavy
        elif state.player_stamina < 25 and state.npc_stamina >= 20:
            heavy = "uppercut" if scores["uppercut"] >= scores["roundhouse"] else "roundhouse"
            chosen_move = heavy
            chosen_score = scores[heavy]
            rejected_move = "backstep"
            rejected_score = scores["backstep"]
        # NPC fatigued → defensive / poke
        elif state.npc_stamina < 25:
            chosen_move = "parry" if scores["parry"] >= scores["backstep"] else "backstep"
            chosen_score = scores[chosen_move]
            rejected_move = "uppercut"
            rejected_score = scores["uppercut"]

        # If the gap is tiny, force a margin by skipping the example (avoids noise)
        if 0 <= (chosen_score - rejected_score) < 0.005:
            continue

        # Final diversity boosters: when the natural top is "cross" but the
        # state is a textbook interrupt window, promote the universal jab.
        top_move = max(set(state.last5), key=lambda m: state.last5.count(m))
        top_count = state.last5.count(top_move)
        if chosen_move == "cross" and top_count >= 3 and state.npc_stamina >= 8:
            # Player spamming one move → universal interrupt is jab
            if state.distance_bucket != "far":
                chosen_move = "jab"
                chosen_score = scores["jab"]
                rejected_move = "cross"
                rejected_score = scores["cross"]
        if chosen_move == "cross" and state.distance_bucket == "close" and state.npc_stamina >= 10:
            # At close range vs non-heavy, low_kick is a faster steal
            if state.player_power < 3 and scores["low_kick"] > scores["jab"]:
                chosen_move = "low_kick"
                chosen_score = scores["low_kick"]
                rejected_move = "cross"
                rejected_score = scores["cross"]

        rows.append({
            "prompt": build_user_prompt(state),
            "system": SYSTEM_PROMPT,
            "chosen": build_assistant_turn(state, chosen_move),
            "rejected": build_assistant_turn(state, rejected_move),
            "chosen_move": chosen_move,
            "rejected_move": rejected_move,
            "chosen_score": chosen_score,
            "rejected_score": rejected_score,
            "state": asdict(state),
            "scores": scores,
        })
    return rows


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="data/v2/sft_v2.jsonl")
    p.add_argument("--n", type=int, default=24000)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--preview", type=int, default=2,
                   help="print this many example rows to stdout")
    args = p.parse_args()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    print(f"Generating {args.n} attribute-aware states (seed={args.seed})...")
    rows = generate_dataset(args.n, seed=args.seed)
    print(f"Generated {len(rows)} unique states after dedup.")

    with out.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"Wrote {len(rows)} rows to {out}")

    if args.preview > 0:
        print("\n--- Sample rows ---")
        for r in rows[:args.preview]:
            print("USER:", r["prompt"])
            print("CHOSEN:", r["chosen"])
            print("REJECTED:", r["rejected"])
            print("CHOSEN_MOVE:", r["chosen_move"], "SCORE:", round(r["chosen_score"], 3))
            print("REJECTED_MOVE:", r["rejected_move"], "SCORE:", round(r["rejected_score"], 3))
            print("---")

    return 0


if __name__ == "__main__":
    sys.exit(main())
