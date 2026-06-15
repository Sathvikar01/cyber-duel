"""Stage 2: GRPO post-training of the SFT checkpoint.

Uses TRL's GRPOTrainer (huggingface/trl >= 0.16) with a verifiable
reward function (rewards.py) that:
  1. Parses `counter_move: <move>` from the completion (1.0 if legal, else 0.0)
  2. Runs K=4 stochastic rollouts of the resolver with that counter
  3. Computes win_proxy + counter_hit_rate + stamina_efficiency
  4. Adds KL penalty against the SFT reference

Run:
  modal run modal/app.py::train_grpo
"""
from __future__ import annotations
import argparse
import json
import os
import random
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from train.common import (
    BASE_MODEL_DEFAULT, get_hf_token, load_jsonl, format_prompt,
    lora_config, load_base, parse_counter,
)
from train.rewards import compute_reward


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/v2/sft_v2.jsonl")
    ap.add_argument("--sft-adapter", default="checkpoints/sft",
                    help="Path to the SFT LoRA adapter to start from")
    ap.add_argument("--out", default="checkpoints/grpo")
    ap.add_argument("--model", default=BASE_MODEL_DEFAULT)
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--group-size", type=int, default=4)
    ap.add_argument("--lr", type=float, default=5e-6)
    ap.add_argument("--kl", type=float, default=0.04)
    ap.add_argument("--max-completion-length", type=int, default=160)
    ap.add_argument("--seq-len", type=int, default=512)
    ap.add_argument("--max-samples", type=int, default=0)
    ap.add_argument("--rollouts-per-move", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    import torch
    from datasets import Dataset
    from peft import PeftModel, get_peft_model
    from trl import GRPOConfig, GRPOTrainer

    rows = load_jsonl(args.data)
    if args.max_samples:
        rows = rows[: args.max_samples]
    print(f"Loaded {len(rows)} training rows from {args.data}")

    # Reuse the same system prompt as SFT; format only the user side here.
    def to_prompt(r):
        return {"prompt": format_prompt(r["system"], r["prompt"])}

    ds = Dataset.from_list([to_prompt(r) for r in rows])

    # Load base + SFT adapter
    tok, base = load_base(args.model)
    model = PeftModel.from_pretrained(base, args.sft_adapter, is_trainable=True)
    # Ensure LoRA params are still trainable after loading the adapter
    for n, p in model.named_parameters():
        if "lora_" in n:
            p.requires_grad_(True)
    model.print_trainable_parameters()

    # Reward function closure (TRL passes completions + prompts to reward fns)
    def reward_fn(completions, prompts=None, **kwargs):
        # prompts and completions are lists of strings in TRL GRPO
        rewards = []
        for comp, prompt in zip(completions, prompts or [""] * len(completions)):
            # Extract the move from the completion
            move = parse_counter(comp)
            # Find the original state via prompt hash
            # We use a simple lookup: hash the prompt text and look it up
            # in the global rows list. The dataset is small enough.
            rewards.append(compute_reward(move, prompt))
        return rewards

    cfg = GRPOConfig(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=1,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_length=args.seq_len,
        max_completion_length=args.max_completion_length,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=args.seed,
        beta=args.kl,  # KL coefficient
        num_generations=args.group_size,
        gradient_checkpointing=True,
        optim="adamw_torch",
    )
    trainer = GRPOTrainer(
        model=model, args=cfg, train_dataset=ds, processing_class=tok,
        reward_funcs=reward_fn,
    )
    trainer.train()
    trainer.save_model(args.out)
    tok.save_pretrained(args.out)
    print(f"\nSaved GRPO adapter to {args.out}")


if __name__ == "__main__":
    main()
