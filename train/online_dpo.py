"""Online per-user DPO pair builder.

Reads a per-user log JSONL (one row per /predict call) and produces clean
(prompt, chosen, rejected) DPO pairs that mirror the procedural training
schema exactly.  The chosen completion is the templated assistant turn for
the move the *resolver* says beats the player's actual next move.  The
rejected completion is the templated assistant turn for whatever move the
shipped model actually picked.

Output schema (one JSON object per line):
  {
    "prompt":   "...",
    "system":   "...",
    "chosen":   "...reasoning...\ncounter_move: <move>",
    "rejected": "...reasoning...\ncounter_move: <model_move>",
    "chosen_move":  "<move>",
    "rejected_move":"<model_move>",
    "chosen_score": 0.42,
    "rejected_score":-0.18,
    "score_gap":  0.60,
    "state":     {...},
  }

We drop rows that are missing `player_next_move` (the user hadn't done
another move at log time), rows whose chosen==rejected, and rows with
|chosen_score - rejected_score| < min_score_gap.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data.v2.generate_data_v2 import (
    State, SYSTEM_PROMPT, build_user_prompt, build_assistant_turn,
)
from data.v2.resolver_py import MOVE_DATA, resolve_gemma_move, get_stamina_cost


LEGAL = ("jab", "cross", "low_kick", "roundhouse", "uppercut",
         "parry", "backstep", "clinch", "throw")


def _row_to_state(row: Dict[str, Any]) -> Optional[State]:
    """Reconstruct a State dataclass from a logged state dict."""
    s = row.get("state")
    if not s:
        return None
    try:
        last5 = tuple(s["last5"])
        if len(last5) < 5:
            return None
        return State(
            player_char_id=s["player_char_id"],
            npc_char_id=s["npc_char_id"],
            player_speed=int(s["player_speed"]),
            player_power=int(s["player_power"]),
            player_range=int(s["player_range"]),
            player_weight=float(s["player_weight"]),
            player_stance=s["player_stance"],
            npc_speed=int(s["npc_speed"]),
            npc_power=int(s["npc_power"]),
            npc_range=int(s["npc_range"]),
            npc_weight=float(s["npc_weight"]),
            npc_stance=s["npc_stance"],
            distance_bucket=s["distance_bucket"],
            distance=float(s["distance"]),
            player_stamina=int(s["player_stamina"]),
            npc_stamina=int(s["npc_stamina"]),
            round=int(s["round"]),
            last5=last5,
            pattern="observed",
        )
    except (KeyError, TypeError, ValueError):
        return None


def _score_against_observed(state: State, counter: str, observed: str) -> float:
    """Score a counter against the *observed* player move using the resolver.

    Mirrors `_score_against_predicted` from generate_data_v2.py but takes
    the observed next move instead of an iterated prediction.  No RNG -
    the move is fixed.  Uses `resolve_gemma_move` so the parry/backstep/
    clinch/throw special paths are handled the same way training sees them.
    """
    if counter not in MOVE_DATA:
        return -0.5

    counter_cost = get_stamina_cost(counter)
    if state.npc_stamina < counter_cost:
        return -0.6

    obs_data = MOVE_DATA.get(observed, {})
    obs_total = obs_data.get("startup", 0) + obs_data.get("active", 0) + obs_data.get("recovery", 0)
    if obs_total <= 0:
        return 0.0
    progress = (obs_data["startup"] + obs_data["active"] * 0.5) / obs_total

    player = {
        "hp": 100, "stamina": float(state.player_stamina),
        "anim": observed, "isAttacking": True, "isBlocking": False,
        "animProgress": progress,
    }
    npc = {
        "hp": 100, "stamina": float(state.npc_stamina),
        "anim": counter, "isAttacking": True, "isBlocking": False, "animProgress": 0.0,
    }
    if counter in ("parry", "backstep", "clinch", "throw"):
        npc["isAttacking"] = False

    result = resolve_gemma_move(counter, npc, player, state.distance, 0.016)
    r = 0.0
    if result.get("parried"):
        r += 0.25
    if result.get("reason") == "evasive_stance":
        r += 0.15
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


def _attribute_tiebreakers(state: State, counter: str) -> float:
    """Mirror the GRPO expected-reward bias so chosen moves match the
    procedural training distribution (close+grapples, far+crosses, etc.)."""
    bias = 0.0
    if state.distance_bucket == "close" and state.npc_stamina >= 18:
        if counter in ("clinch", "throw"):
            bias += 0.20
        if counter in ("roundhouse", "uppercut"):
            bias -= 0.10
    if state.player_speed >= 4 and (
        state.last5.count("jab") + state.last5.count("cross") >= 3
    ):
        if counter == "parry":
            bias += 0.18
        if counter == "backstep":
            bias += 0.10
    if state.distance_bucket == "far":
        if counter in ("jab", "low_kick", "clinch", "throw"):
            bias -= 0.20
        if counter in ("cross", "roundhouse") and state.npc_stamina >= 12:
            bias += 0.15
    if state.npc_stamina < 25:
        if counter in ("uppercut", "roundhouse", "throw"):
            bias -= 0.25
        if counter in ("parry", "backstep", "jab"):
            bias += 0.15
    if state.last5.count("roundhouse") >= 4 and counter in ("jab", "backstep", "parry"):
        bias += 0.10
    if state.last5.count("low_kick") >= 4 and counter == "parry":
        bias += 0.15
    return bias


def _score(state: State, counter: str, observed: str) -> float:
    raw = _score_against_observed(state, counter, observed)
    return max(-1.0, min(1.0, raw + _attribute_tiebreakers(state, counter)))


def _score_full(state: State, counter: str) -> float:
    """Use the same score_counter that the SFT dataset was generated with.

    This guarantees the chosen distribution is consistent with what the
    model was trained on (close->clinch, far->cross, etc.)."""
    from data.v2.generate_data_v2 import score_counter
    return float(score_counter(state, counter))


def build_pairs(
    log_rows: List[Dict[str, Any]],
    min_score_gap: float = 0.05,
    holdout_n: int = 50,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Convert a per-user log into (train_pairs, holdout_rows).

    `holdout_n` most-recent rows are returned separately so `eval_gate` can
    re-score the candidate adapter on the user's own play style.
    """
    candidates: List[Dict[str, Any]] = []
    for r in log_rows:
        if r.get("player_next_move") in (None, ""):
            continue
        if r.get("model_move") not in LEGAL:
            continue
        if r["player_next_move"] not in LEGAL:
            continue
        state = _row_to_state(r)
        if state is None:
            continue
        chosen_move = r["player_next_move"]
        rejected_move = r["model_move"]
        if chosen_move == rejected_move:
            continue
        # Pick the resolver-optimal counter to the player's actual next
        # move.  Use the full `score_counter` (the same scoring function
        # the SFT dataset was generated with) so the chosen distribution
        # stays self-consistent.
        all_moves = list(LEGAL)
        observed = r["player_next_move"]
        scored = [
            (m, _score_full(state, m))
            for m in all_moves if m != rejected_move
        ]
        scored.sort(key=lambda kv: -kv[1])
        best_move, best_score = scored[0]
        if best_move == rejected_move:
            continue
        chosen_move = best_move
        # Gap = how much better is `chosen_move` than `rejected_move`
        # under the same scoring function.  We use _score_full so the
        # filter matches the chosen-selection criterion (SFT-consistent).
        chosen_score = best_score
        rejected_score = _score_full(state, rejected_move)
        gap = chosen_score - rejected_score
        if gap < min_score_gap:
            continue
        pair = {
            "ts": r.get("ts", 0),
            "prompt": build_user_prompt(state),
            "system": SYSTEM_PROMPT,
            "chosen": build_assistant_turn(state, chosen_move),
            "rejected": build_assistant_turn(state, rejected_move),
            "chosen_move": chosen_move,
            "rejected_move": rejected_move,
            "chosen_score": chosen_score,
            "rejected_score": rejected_score,
            "score_gap": gap,
            "state": {
                "player_char_id": state.player_char_id,
                "npc_char_id": state.npc_char_id,
                "player_speed": state.player_speed,
                "player_power": state.player_power,
                "player_range": state.player_range,
                "player_weight": state.player_weight,
                "player_stance": state.player_stance,
                "npc_speed": state.npc_speed,
                "npc_power": state.npc_power,
                "npc_range": state.npc_range,
                "npc_weight": state.npc_weight,
                "npc_stance": state.npc_stance,
                "distance_bucket": state.distance_bucket,
                "distance": state.distance,
                "player_stamina": state.player_stamina,
                "npc_stamina": state.npc_stamina,
                "round": state.round,
                "last5": list(state.last5),
                "pattern": state.pattern,
            },
        }
        candidates.append(pair)

    if not candidates:
        return [], []

    # Hold out the most-recent N rows for eval, train on the rest
    candidates.sort(key=lambda p: p.get("ts", 0) if isinstance(p.get("ts", 0), (int, float)) else 0)
    if len(candidates) > holdout_n:
        holdout = candidates[-holdout_n:]
        train = candidates[:-holdout_n]
    else:
        holdout = []
        train = candidates
    return train, holdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", required=True, help="Path to users/<uid>.jsonl")
    ap.add_argument("--out", required=True, help="Path to write DPO JSONL")
    ap.add_argument("--holdout-out", default="", help="Path to write user hold-out JSONL (optional)")
    ap.add_argument("--min-score-gap", type=float, default=0.05)
    ap.add_argument("--holdout-n", type=int, default=50)
    args = ap.parse_args()

    log_rows = []
    with open(args.log, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                log_rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    print(f"Loaded {len(log_rows)} log rows from {args.log}")

    train, holdout = build_pairs(
        log_rows, min_score_gap=args.min_score_gap, holdout_n=args.holdout_n,
    )
    print(f"Built {len(train)} training pairs, {len(holdout)} hold-out rows")

    if train:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            for p in train:
                f.write(json.dumps(p, ensure_ascii=False) + "\n")
        print(f"Wrote {args.out}")

    if holdout and args.holdout_out:
        Path(args.holdout_out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.holdout_out, "w", encoding="utf-8") as f:
            for h in holdout:
                f.write(json.dumps(h, ensure_ascii=False) + "\n")
        print(f"Wrote {args.holdout_out}")


if __name__ == "__main__":
    main()
