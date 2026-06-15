"""Stage 3 (optional): DPO polish of the GRPO checkpoint.

Uses the (chosen, rejected) pairs in data/v2/sft_v2.jsonl (already
populated by the data generator) to do a single DPO epoch.
"""
from __future__ import annotations
import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from train.common import (
    BASE_MODEL_DEFAULT, load_jsonl, format_prompt, format_full,
    lora_config, load_base,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/v2/sft_v2.jsonl")
    ap.add_argument("--grpo-adapter", default="checkpoints/grpo",
                    help="Path to the GRPO LoRA adapter to start from")
    ap.add_argument("--out", default="checkpoints/dpo")
    ap.add_argument("--model", default=BASE_MODEL_DEFAULT)
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--lr", type=float, default=5e-7)
    ap.add_argument("--beta", type=float, default=0.1)
    ap.add_argument("--max-samples", type=int, default=0)
    ap.add_argument("--max-length", type=int, default=512)
    args = ap.parse_args()

    import torch
    from datasets import Dataset
    from peft import PeftModel
    from trl import DPOTrainer, DPOConfig

    rows = load_jsonl(args.data)
    if args.max_samples:
        rows = rows[: args.max_samples]
    print(f"Loaded {len(rows)} preference pairs from {args.data}")

    def to_pair(r):
        return {
            "prompt": format_prompt(r["system"], r["prompt"]),
            "chosen": r["chosen"] + "<end_of_turn>\n",
            "rejected": r["rejected"] + "<end_of_turn>\n",
        }

    ds = Dataset.from_list([to_pair(r) for r in rows])

    tok, base = load_base(args.model)
    model = PeftModel.from_pretrained(base, args.grpo_adapter, is_trainable=True)
    for n, p in model.named_parameters():
        if "lora_" in n:
            p.requires_grad_(True)
    model.print_trainable_parameters()

    cfg = DPOConfig(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_length=args.max_length,
        max_prompt_length=args.max_length - 200,
        logging_steps=20,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=0,
        beta=args.beta,
        gradient_checkpointing=True,
        optim="adamw_torch",
    )
    trainer = DPOTrainer(
        model=model, args=cfg, train_dataset=ds, processing_class=tok,
    )
    trainer.train()
    trainer.save_model(args.out)
    tok.save_pretrained(args.out)
    print(f"\nSaved DPO adapter to {args.out}")


if __name__ == "__main__":
    main()
