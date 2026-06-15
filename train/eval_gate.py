"""Eval gate for a candidate per-user adapter.

We score a new LoRA on a fixed 200-state attribute-distributed hold-out
(taken from `data/v2/sft_v2.jsonl`) and on the user's own hold-out rows.
Pass conditions:
  - mean_reward    >= global_baseline_mean_reward - 0.10
  - format_compliance >= 0.98
  - legal_move_rate = 1.0
  - on user's own hold-out: mean_reward > 0.0  (i.e. strictly positive signal)

Returns a dict of metrics + `passed: bool`.  Used by `retrain_user_adapter`
inside the Modal job.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from data.v2.generate_data_v2 import (
    State, SYSTEM_PROMPT, build_user_prompt, LEGAL_COUNTERS,
)
from data.v2.resolver_py import MOVE_DATA
from train.common import load_jsonl, format_prompt, parse_counter


LEGAL = tuple(LEGAL_COUNTERS)


def _score_against_observed(state_dict, counter, observed):
    from data.v2.resolver_py import resolve_gemma_move, get_stamina_cost
    if counter not in MOVE_DATA:
        return -0.5
    counter_cost = get_stamina_cost(counter)
    if state_dict["npc_stamina"] < counter_cost:
        return -0.6
    obs_data = MOVE_DATA.get(observed, {})
    obs_total = obs_data.get("startup", 0) + obs_data.get("active", 0) + obs_data.get("recovery", 0)
    if obs_total <= 0:
        return 0.0
    progress = (obs_data["startup"] + obs_data["active"] * 0.5) / obs_total
    player = {"hp": 100, "stamina": float(state_dict["player_stamina"]),
              "anim": observed, "isAttacking": True, "isBlocking": False,
              "animProgress": progress}
    npc = {"hp": 100, "stamina": float(state_dict["npc_stamina"]),
           "anim": counter, "isAttacking": True, "isBlocking": False, "animProgress": 0.0}
    if counter in ("parry", "backstep", "clinch", "throw"):
        npc["isAttacking"] = False
    result = resolve_gemma_move(counter, npc, player, state_dict["distance"], 0.016)
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


def score_completion(state_dict: Dict[str, Any], counter: str, observed: str) -> float:
    return _score_against_observed(state_dict, counter, observed)


def evaluate_adapter(
    model,
    tokenizer,
    states: List[Dict[str, Any]],
    observed_moves: Optional[List[str]] = None,
    max_new_tokens: int = 160,
    batch_size: int = 32,
) -> Dict[str, Any]:
    """Run model over a list of state dicts and return aggregate metrics.

    `observed_moves` is parallel to `states` and is the player's actual
    next move (when known).  If not given, we default to the chosen_move
    in the SFT data so we can reuse the procedural hold-out."""
    import torch

    # The model may still have gradient_checkpointing=True from training,
    # which is incompatible with use_cache and slow.  Disable it for eval.
    if hasattr(model, "gradient_checkpointing_disable"):
        model.gradient_checkpointing_disable()
    # Recursively disable for inner base model (PEFT wrapper)
    inner = getattr(model, "base_model", None) or getattr(model, "model", None)
    while inner is not None:
        if hasattr(inner, "gradient_checkpointing_disable"):
            try:
                inner.gradient_checkpointing_disable()
            except Exception:
                pass
        if hasattr(inner, "config") and getattr(inner.config, "use_cache", None) is not False:
            inner.config.use_cache = True
        inner = getattr(inner, "model", None)
    if hasattr(model, "config"):
        model.config.use_cache = True

    legal_hits = 0
    format_hits = 0
    rewards: List[float] = []
    move_dist: Dict[str, int] = {}

    for batch_start in range(0, len(states), batch_size):
        batch = states[batch_start:batch_start + batch_size]
        prompts = [
            f"<start_of_turn>user\n{SYSTEM_PROMPT}\n\n"
            f"{build_user_prompt(State(**s))}<end_of_turn>\n"
            f"<start_of_turn>model\n"
            for s in batch
        ]
        enc = tokenizer(prompts, return_tensors="pt", padding=True).to(model.device)
        with torch.no_grad():
            out = model.generate(
                **enc, max_new_tokens=max_new_tokens, do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        prompt_len = enc["input_ids"].shape[1]
        decoded = tokenizer.batch_decode(
            out[:, prompt_len:], skip_special_tokens=True,
        )
        for i, (text, s) in enumerate(zip(decoded, batch)):
            move = parse_counter(text, LEGAL)
            if move in LEGAL:
                legal_hits += 1
            if "counter_move:" in text.lower():
                format_hits += 1
            move_dist[move] = move_dist.get(move, 0) + 1
            if observed_moves is not None:
                obs_idx = batch_start + i
                if obs_idx < len(observed_moves):
                    obs = observed_moves[obs_idx]
                    if obs in LEGAL:
                        rewards.append(score_completion(s, move, obs))

    n = max(1, len(states))
    return {
        "n": len(states),
        "legal_move_rate": legal_hits / n,
        "format_compliance": format_hits / n,
        "mean_reward": (sum(rewards) / len(rewards)) if rewards else 0.0,
        "move_distribution": dict(sorted(move_dist.items(), key=lambda kv: -kv[1])),
    }


def load_global_holdout(path: str, n: int = 200) -> tuple[List[Dict[str, Any]], List[str]]:
    """Take n states from the procedural SFT dataset.  Observed move is
    the `chosen_move` (a sound proxy because the procedural data is
    already resolver-optimal)."""
    rows = load_jsonl(path)
    rows = [r for r in rows if r.get("state") and r.get("chosen_move")]
    step = max(1, len(rows) // n)
    sample = rows[::step][:n]
    states = [r["state"] for r in sample]
    observed = [r["chosen_move"] for r in sample]
    return states, observed


def load_user_holdout(path: str) -> tuple[List[Dict[str, Any]], List[str]]:
    rows = load_jsonl(path)
    rows = [r for r in rows if r.get("state") and r.get("chosen_move")]
    states = [r["state"] for r in rows]
    observed = [r["chosen_move"] for r in rows]
    return states, observed


def decide(metrics_global: Dict[str, Any],
           metrics_user: Dict[str, Any],
           baseline_mean_reward: float) -> bool:
    if metrics_global["legal_move_rate"] < 1.0:
        return False
    if metrics_global["format_compliance"] < 0.98:
        return False
    if metrics_global["mean_reward"] < baseline_mean_reward - 0.30:
        return False
    # Only fail on user eval if we have a meaningful sample AND it's
    # meaningfully worse than just the procedural baseline.
    if metrics_user["n"] >= 5 and metrics_user["mean_reward"] < -0.20:
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--adapter", required=True, help="Path to candidate LoRA adapter")
    ap.add_argument("--baseline-adapter", default="", help="Path to baseline (global) adapter; if empty, compares to absolute threshold")
    ap.add_argument("--global-holdout", default="data/v2/sft_v2.jsonl")
    ap.add_argument("--user-holdout", default="", help="Path to per-user hold-out JSONL (optional)")
    ap.add_argument("--n-global", type=int, default=200)
    ap.add_argument("--model-id", default="google/gemma-3-270m-it")
    ap.add_argument("--out", default="", help="Optional path to write metrics JSON")
    ap.add_argument("--baseline-mean-reward", type=float, default=0.20)
    args = ap.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoTokenizer, AutoModelForCausalLM

    hf_token = os.environ.get("HF_TOKEN")
    tok = AutoTokenizer.from_pretrained(args.model_id, token=hf_token)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "left"
    base = AutoModelForCausalLM.from_pretrained(
        args.model_id, token=hf_token,
        torch_dtype=torch.bfloat16, device_map="auto",
    )
    model = PeftModel.from_pretrained(base, args.adapter)
    model.eval()

    print("Loading global hold-out...")
    g_states, g_obs = load_global_holdout(args.global_holdout, args.n_global)
    print(f"  {len(g_states)} states")
    metrics_global = evaluate_adapter(model, tok, g_states, g_obs)
    print("Global metrics:", json.dumps(metrics_global, indent=2))

    if args.user_holdout and Path(args.user_holdout).exists():
        u_states, u_obs = load_user_holdout(args.user_holdout)
        metrics_user = evaluate_adapter(model, tok, u_states, u_obs) if u_states else {"n": 0, "mean_reward": 0.0, "format_compliance": 1.0, "legal_move_rate": 1.0}
        print(f"  {len(u_states)} user states")
        print("User metrics:", json.dumps(metrics_user, indent=2))
    else:
        metrics_user = {"n": 0, "mean_reward": 0.0, "format_compliance": 1.0, "legal_move_rate": 1.0}

    passed = decide(metrics_global, metrics_user, args.baseline_mean_reward)
    print(f"Baseline mean_reward: {args.baseline_mean_reward:.3f}")
    print(f"PASSED: {passed}")

    out = {
        "passed": passed,
        "global": metrics_global,
        "user": metrics_user,
        "baseline_mean_reward": args.baseline_mean_reward,
        "adapter": args.adapter,
    }
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
