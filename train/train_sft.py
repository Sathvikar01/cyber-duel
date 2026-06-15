"""Stage 1: Supervised fine-tuning of Gemma-3-270M-IT on the
attribute-aware combat dataset (data/v2/sft_v2.jsonl).

Run:
  modal run modal/app.py::train_sft
  # or locally with a small GPU:
  python -m train.train_sft --data data/v2/sft_v2.jsonl --epochs 3

Outputs a LoRA adapter to /checkpoints/sft inside the Modal Volume
(cyber-duel-vol) or to the local --out dir.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from train.common import (
    BASE_MODEL_DEFAULT, get_hf_token, load_jsonl,
    format_full, lora_config, load_base,
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/v2/sft_v2.jsonl")
    ap.add_argument("--out", default="checkpoints/sft")
    ap.add_argument("--model", default=BASE_MODEL_DEFAULT)
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--seq-len", type=int, default=512)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    ap.add_argument("--max-samples", type=int, default=0)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    import torch
    from datasets import Dataset
    from transformers import TrainingArguments
    from peft import get_peft_model
    from trl import SFTTrainer, SFTConfig

    rows = load_jsonl(args.data)
    if args.max_samples:
        rows = rows[: args.max_samples]
    print(f"Loaded {len(rows)} rows from {args.data}")

    def to_text(r):
        return {"text": format_full(r["system"], r["prompt"], r["chosen"])}

    ds = Dataset.from_list([to_text(r) for r in rows])
    print("Sample text:\n", ds[0]["text"][:500], "...\n")

    tok, model = load_base(args.model)
    model = get_peft_model(model, lora_config(args.lora_r, args.lora_alpha))
    model.print_trainable_parameters()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    cfg = SFTConfig(
        output_dir=str(out_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_length=args.seq_len,
        logging_steps=20,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=args.seed,
        gradient_checkpointing=True,
        optim="adamw_torch",
        completion_only_loss=False,  # train on full sequence
        dataset_text_field="text",
    )
    trainer = SFTTrainer(
        model=model, args=cfg, train_dataset=ds, processing_class=tok,
    )
    trainer.train()
    trainer.save_model(str(out_dir))
    tok.save_pretrained(str(out_dir))
    print(f"\nSaved LoRA adapter to {out_dir}")


if __name__ == "__main__":
    main()
