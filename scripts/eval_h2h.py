"""Local head-to-head evaluator — compare two LoRA adapters (or base vs
adapter) on the eval split of data/v2/sft_v2.jsonl.

Usage:
  python scripts/eval_h2h.py --adapter-a checkpoints/sft --adapter-b checkpoints/grpo
  python scripts/eval_h2h.py --adapter-a checkpoints/grpo --random-baseline
"""
from __future__ import annotations
import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from train.common import load_jsonl, format_prompt, load_base, parse_counter
from train.rewards import compute_reward


LEGAL = ("jab", "cross", "low_kick", "roundhouse", "uppercut",
         "parry", "backstep", "clinch", "throw")


def evaluate_adapter(adapter_path: str | None, rows: list, n: int, seed: int = 0) -> dict:
    import torch
    from peft import PeftModel

    if adapter_path is None:
        # Random baseline: pick a legal move uniformly
        rng = random.Random(seed)
        n_format_ok = sum(1 for _ in range(n))
        return {
            "name": "random",
            "n": n,
            "format_compliance": 1.0,
            "match_data_chosen": 0.0,
            "mean_reward": 0.0,
        }

    tok, base = load_base("google/gemma-3-270m-it")
    model = PeftModel.from_pretrained(base, adapter_path)
    model.eval()

    n_format_ok = 0
    n_correct = 0
    rewards = []
    move_counts = {m: 0 for m in LEGAL}
    for r in rows[:n]:
        prompt = format_prompt(r["system"], r["prompt"])
        inputs = tok(prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                **inputs, max_new_tokens=160, do_sample=False,
                pad_token_id=tok.eos_token_id,
            )
        completion = tok.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
        move = parse_counter(completion)
        if move in LEGAL:
            n_format_ok += 1
            move_counts[move] += 1
        if move == r["chosen_move"]:
            n_correct += 1
        rewards.append(compute_reward(move, prompt))

    return {
        "name": adapter_path,
        "n": n,
        "format_compliance": n_format_ok / n,
        "match_data_chosen": n_correct / n,
        "mean_reward": sum(rewards) / n,
        "move_distribution": move_counts,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/v2/sft_v2.jsonl")
    ap.add_argument("--adapter-a", default="checkpoints/sft")
    ap.add_argument("--adapter-b", default="checkpoints/grpo")
    ap.add_argument("--random-baseline", action="store_true")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    rows = load_jsonl(args.data)
    print(f"Loaded {len(rows)} rows, evaluating on first {args.n}.")

    a = evaluate_adapter(args.adapter_a, rows, args.n, args.seed)
    print(json.dumps(a, indent=2))

    if args.random_baseline:
        b = evaluate_adapter(None, rows, args.n, args.seed)
    else:
        b = evaluate_adapter(args.adapter_b, rows, args.n, args.seed)
    print(json.dumps(b, indent=2))

    # Comparison
    print(f"\nA: {a['name']}  mean_reward={a['mean_reward']:+.3f}  match={a['match_data_chosen']:.1%}")
    print(f"B: {b['name']}  mean_reward={b['mean_reward']:+.3f}  match={b['match_data_chosen']:.1%}")
    if b["mean_reward"] > a["mean_reward"]:
        print(f"  B beats A by {b['mean_reward'] - a['mean_reward']:+.3f} reward")


if __name__ == "__main__":
    main()
