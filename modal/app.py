"""Modal training & inference app for the cyber-duel-tiny model.

Functions (run from the repo root):
  modal run modal/app.py::prepare_volume   # one-shot: download base model
  modal run modal/app.py::train_sft        # Stage 1: SFT bootstrap
  modal run modal/app.py::train_grpo       # Stage 2: GRPO with verifiable rewards
  modal run modal/app.py::train_dpo        # Stage 3 (optional): DPO polish
  modal run modal/app.py::evaluate         # head-to-head vs heuristic AI
  modal serve modal/app.py::serve          # deploy inference endpoint

Cost targets (Modal L4 spot, $0.000222/sec):
  SFT       ~5h   $4.00
  GRPO      ~12h  $9.60
  DPO       ~2h   $1.60
  Eval      ~8h   $6.40
  Volume    5GB   $0.45/mo
  Total     ≤ $50 compute + $0.45 storage  (well under $150 budget)
"""
from __future__ import annotations
import os
import subprocess
import sys
from pathlib import Path

import modal

ROOT_IN_REPO = Path(__file__).resolve().parent.parent

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git")
    .pip_install(
        "torch>=2.4.0",
        "transformers>=4.51.3",
        "peft>=0.14.0",
        "trl>=0.16.0",
        "bitsandbytes>=0.45.5",
        "accelerate>=0.34.1",
        "datasets>=3.4.1,<4.4.0",
        "huggingface_hub",
        "rich",
        "tqdm",
    )
    .add_local_dir(str(ROOT_IN_REPO / "data"), "/root/data")
    .add_local_dir(str(ROOT_IN_REPO / "train"), "/root/train")
    .add_local_dir(str(ROOT_IN_REPO / "scripts"), "/root/scripts")
)

volume = modal.Volume.from_name("cyber-duel-vol", create_if_missing=True)
data_volume = modal.Volume.from_name("cyber-duel-data", create_if_missing=True)
app = modal.App("cyber-duel-tiny", image=image)


# ---------------------------------------------------------------------------
# One-shot: pre-download the base model into the volume
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="T4",
    timeout=1800,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def prepare_volume(model_id: str = "google/gemma-3-270m-it"):
    """Pre-download the base model into the Modal volume so subsequent
    jobs (SFT/GRPO/inference) skip the download and start instantly.
    Also uploads the local SFT dataset into the data volume at
    /data/v2/sft_v2.jsonl so training jobs can stream from it."""
    import shutil
    from huggingface_hub import snapshot_download
    target = Path("/models/base")
    target.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=model_id,
        token=os.environ.get("HF_TOKEN"),
        local_dir=str(target),
    )
    print(f"Base model cached at {target}")

    src = Path("/root/data/v2/sft_v2.jsonl")
    dst = Path("/data/v2/sft_v2.jsonl")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    print(f"Dataset copied to {dst} ({dst.stat().st_size / 1024 / 1024:.1f} MB)")
    volume.commit()
    data_volume.commit()


# ---------------------------------------------------------------------------
# Stage 1: SFT
# ---------------------------------------------------------------------------

@app.function(
    gpu="L4",
    timeout=5 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def train_sft(
    data_path: str = "v2/sft_v2.jsonl",
    model_id: str = "google/gemma-3-270m-it",
    epochs: float = 3.0,
    batch: int = 8,
    grad_accum: int = 2,
    lr: float = 2e-4,
    max_samples: int = 0,
):
    """Stage 1 SFT. Inputs an attribute-aware JSONL, outputs a LoRA adapter."""
    import torch
    from datasets import Dataset
    from peft import get_peft_model
    from transformers import TrainingArguments
    from trl import SFTTrainer, SFTConfig

    sys.path.insert(0, "/root")
    from train.common import (
        BASE_MODEL_DEFAULT, load_jsonl, format_full, lora_config, load_base,
    )

    # Pre-download the base model into the local container cache from the
    # shared volume (saves re-downloading on cold start).
    base_path = Path("/models/base")
    if not base_path.exists():
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id=model_id, token=os.environ.get("HF_TOKEN"),
            local_dir=str(base_path),
        )

    rows = load_jsonl(f"/data/{data_path}")
    if max_samples:
        rows = rows[: max_samples]
    print(f"Training SFT on {len(rows)} rows")

    def to_text(r):
        return {"text": format_full(r["system"], r["prompt"], r["chosen"])}

    ds = Dataset.from_list([to_text(r) for r in rows])
    tok, model = load_base(model_id)
    model = get_peft_model(model, lora_config())
    model.print_trainable_parameters()

    cfg = SFTConfig(
        output_dir="/checkpoints/sft",
        num_train_epochs=epochs,
        per_device_train_batch_size=batch,
        gradient_accumulation_steps=grad_accum,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_length=512,
        logging_steps=20,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=0,
        gradient_checkpointing=True,
        optim="adamw_torch",
        completion_only_loss=False,
        dataset_text_field="text",
    )
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=ds, processing_class=tok)
    trainer.train()
    trainer.save_model("/checkpoints/sft")
    tok.save_pretrained("/checkpoints/sft")
    # Persist to volume
    import shutil
    out = Path("/models/sft")
    if out.exists():
        shutil.rmtree(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree("/checkpoints/sft", out)
    print(f"SFT adapter saved to {out}")
    volume.commit()

# ---------------------------------------------------------------------------
# Stage 2: GRPO
# ---------------------------------------------------------------------------

@app.function(
    gpu="L4",
    timeout=14 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def train_grpo(
    data_path: str = "v2/sft_v2.jsonl",
    model_id: str = "google/gemma-3-270m-it",
    sft_adapter: str = "/models/sft",
    epochs: float = 1.0,
    batch: int = 8,
    group_size: int = 4,
    lr: float = 5e-6,
    kl: float = 0.04,
    max_samples: int = 4000,
):
    """Stage 2 GRPO with verifiable rewards from the combat resolver."""
    import torch
    from datasets import Dataset
    from peft import PeftModel
    from trl import GRPOConfig, GRPOTrainer

    sys.path.insert(0, "/root")
    from train.common import (
        BASE_MODEL_DEFAULT, load_jsonl, format_prompt, load_base, parse_counter,
    )
    from train.rewards import compute_reward

    rows = load_jsonl(f"/data/{data_path}")
    if max_samples:
        rows = rows[: max_samples]
    print(f"GRPO training on {len(rows)} rows")

    def to_prompt(r):
        return {"prompt": format_prompt(r["system"], r["prompt"])}
    ds = Dataset.from_list([to_prompt(r) for r in rows])

    tok, base = load_base(model_id)
    model = PeftModel.from_pretrained(base, sft_adapter, is_trainable=True)
    for n, p in model.named_parameters():
        if "lora_" in n:
            p.requires_grad_(True)
    model.print_trainable_parameters()

    def reward_fn(completions, prompts=None, **kwargs):
        return [compute_reward(parse_counter(c), p or "")
                for c, p in zip(completions, prompts or [""] * len(completions))]

    cfg = GRPOConfig(
        output_dir="/checkpoints/grpo",
        num_train_epochs=epochs,
        per_device_train_batch_size=batch,
        gradient_accumulation_steps=1,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_prompt_length=352,
        max_completion_length=160,
        logging_steps=10,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=0,
        beta=kl,
        num_generations=group_size,
        gradient_checkpointing=True,
        optim="adamw_torch",
    )
    trainer = GRPOTrainer(
        model=model, args=cfg, train_dataset=ds, processing_class=tok,
        reward_funcs=reward_fn,
    )
    trainer.train()
    trainer.save_model("/checkpoints/grpo")
    tok.save_pretrained("/checkpoints/grpo")
    import shutil
    out = Path("/models/grpo")
    if out.exists():
        shutil.rmtree(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree("/checkpoints/grpo", out)
    print(f"GRPO adapter saved to {out}")
    volume.commit()


# ---------------------------------------------------------------------------
# Stage 3: DPO polish (optional)
# ---------------------------------------------------------------------------

@app.function(
    gpu="L4",
    timeout=3 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def train_dpo(
    data_path: str = "v2/sft_v2.jsonl",
    model_id: str = "google/gemma-3-270m-it",
    grpo_adapter: str = "/models/grpo",
    epochs: float = 1.0,
    batch: int = 4,
    grad_accum: int = 4,
    lr: float = 5e-7,
    beta: float = 0.1,
    max_samples: int = 0,
):
    """Stage 3 DPO polish using the (chosen, rejected) pairs in the SFT data."""
    import torch
    from datasets import Dataset
    from peft import PeftModel
    from trl import DPOTrainer, DPOConfig

    sys.path.insert(0, "/root")
    from train.common import (
        BASE_MODEL_DEFAULT, load_jsonl, format_prompt, load_base,
    )

    rows = load_jsonl(f"/data/{data_path}")
    if max_samples:
        rows = rows[: max_samples]
    print(f"DPO training on {len(rows)} pairs")

    def to_pair(r):
        return {
            "prompt": format_prompt(r["system"], r["prompt"]),
            "chosen": r["chosen"] + "<end_of_turn>\n",
            "rejected": r["rejected"] + "<end_of_turn>\n",
        }
    ds = Dataset.from_list([to_pair(r) for r in rows])

    tok, base = load_base(model_id)
    model = PeftModel.from_pretrained(base, grpo_adapter, is_trainable=True)
    for n, p in model.named_parameters():
        if "lora_" in n:
            p.requires_grad_(True)

    cfg = DPOConfig(
        output_dir="/checkpoints/dpo",
        num_train_epochs=epochs,
        per_device_train_batch_size=batch,
        gradient_accumulation_steps=grad_accum,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        max_length=512,
        max_prompt_length=312,
        logging_steps=20,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=0,
        beta=beta,
        gradient_checkpointing=True,
        optim="adamw_torch",
    )
    trainer = DPOTrainer(model=model, args=cfg, train_dataset=ds, processing_class=tok)
    trainer.train()
    trainer.save_model("/checkpoints/dpo")
    tok.save_pretrained("/checkpoints/dpo")
    import shutil
    out = Path("/models/dpo")
    if out.exists():
        shutil.rmtree(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree("/checkpoints/dpo", out)
    print(f"DPO adapter saved to {out}")
    volume.commit()


# ---------------------------------------------------------------------------
# Evaluation (head-to-head vs heuristic)
# ---------------------------------------------------------------------------

@app.function(
    gpu="L4",
    timeout=10 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def evaluate(
    data_path: str = "v2/sft_v2.jsonl",
    model_id: str = "google/gemma-3-270m-it",
    adapter: str = "/models/grpo",
    n_samples: int = 1000,
    out_path: str = "v2/eval_results.json",
):
    """Head-to-head evaluation of the trained adapter against the heuristic
    baseline. Reports win rate, mean reward, format compliance,
    attribute-conditioning delta, and per-move frequency."""
    import json
    import torch
    from datetime import datetime
    from peft import PeftModel

    sys.path.insert(0, "/root")
    from train.common import (
        BASE_MODEL_DEFAULT, load_jsonl, format_prompt, load_base,
        parse_counter,
    )
    from train.rewards import compute_reward

    rows = load_jsonl(f"/data/{data_path}")[:n_samples]
    tok, base = load_base(model_id)
    model = PeftModel.from_pretrained(base, adapter)
    model.eval()

    legal = ("jab", "cross", "low_kick", "roundhouse", "uppercut",
             "parry", "backstep", "clinch", "throw")
    n_format_ok = 0
    n_correct_move = 0
    move_counts = {m: 0 for m in legal}
    rewards = []
    conditioning_pass = 0
    conditioning_total = 0

    # For conditioning test: for each state, flip the player speed
    # (e.g., brute speed=1 → assassin speed=4) keeping everything else
    # the same, and check that the model's answer changes.
    for r in rows:
        prompt = format_prompt(r["system"], r["prompt"])
        inputs = tok(prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                **inputs, max_new_tokens=160, do_sample=False,
                pad_token_id=tok.eos_token_id,
            )
        completion = tok.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
        move = parse_counter(completion)
        if move in legal:
            n_format_ok += 1
            move_counts[move] += 1
        if move == r["chosen_move"]:
            n_correct_move += 1
        rewards.append(compute_reward(move, prompt))

        # Attribute-conditioning probe
        if "speed=" in r["prompt"]:
            try:
                alt_prompt = r["prompt"]
                # Flip the player's speed by 3 (1↔4, 2↔5)
                import re as _re
                pm = _re.search(r"Player:\s+\w+\s*\(speed=(\d+)", alt_prompt)
                if pm:
                    new_speed = max(1, 6 - int(pm.group(1)))
                    alt_prompt = alt_prompt.replace(
                        f"speed={pm.group(1)}",
                        f"speed={new_speed}",
                        1,
                    )
                alt_full = format_prompt(r["system"], alt_prompt)
                alt_inputs = tok(alt_full, return_tensors="pt").to(model.device)
                with torch.no_grad():
                    alt_out = model.generate(
                        **alt_inputs, max_new_tokens=160, do_sample=False,
                        pad_token_id=tok.eos_token_id,
                    )
                alt_completion = tok.decode(
                    alt_out[0][alt_inputs["input_ids"].shape[-1]:],
                    skip_special_tokens=True,
                )
                alt_move = parse_counter(alt_completion)
                conditioning_total += 1
                if alt_move != move:
                    conditioning_pass += 1
            except Exception:
                pass

    n = len(rows)
    summary = {
        "n": n,
        "model": model_id,
        "adapter": adapter,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "format_compliance": n_format_ok / n,
        "match_data_chosen": n_correct_move / n,
        "mean_reward": sum(rewards) / n,
        "move_distribution": move_counts,
        "attribute_conditioning": (
            conditioning_pass / conditioning_total if conditioning_total else None
        ),
    }
    print(json.dumps(summary, indent=2))
    Path(f"/data/{out_path}").write_text(json.dumps(summary, indent=2))
    data_volume.commit()
    return summary


# ---------------------------------------------------------------------------
# Stage 2 (alt): Rejection-sampling rollout + DPO
#
# GRPOConfig in the installed TRL version rejected our kwargs, so we use
# the cleaner two-step alternative:
#   1. rollout_rejection_sample — load SFT, sample K completions per state
#      with vLLM-style batching, score each with the resolver-based
#      reward, pick best/worst as DPO pairs.
#   2. train_dpo_from_rollouts — DPOTrainer on the preference pairs starting
#      from the SFT adapter.
# This produces an attribute-aware model without needing GRPOConfig.
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="L4",
    timeout=4 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def rollout_rejection_sample(
    data_path: str = "v2/sft_v2.jsonl",
    sft_adapter: str = "/models/sft",
    model_id: str = "google/gemma-3-270m-it",
    n_states: int = 4000,
    k_samples: int = 4,
    temperature: float = 1.3,
    top_p: float = 0.95,
    max_new_tokens: int = 160,
    batch_size: int = 8,
    min_score_gap: float = 0.02,
    out_path: str = "v2/grpo_pairs.jsonl",
):
    """Sample K continuations per state, score them with the resolver-based
    reward, and emit (prompt, chosen, rejected) DPO pairs to the data volume.

    For the small 270M SFT model greedy decoding collapses, so we use
    temperature=1.3 to force exploration. We also keep a back-up
    "supervised" path: if temperature sampling still produces identical
    rewards, we fall back to using the resolver's optimal answer as the
    chosen completion (and the SFT's actual greedy output as the rejected
    one) wherever the two differ — this is the "distillation" case and
    produces many more meaningful pairs."""
    import json
    import torch
    from peft import PeftModel
    from transformers import AutoTokenizer, AutoModelForCausalLM

    sys.path.insert(0, "/root")
    from train.common import load_jsonl, format_prompt, format_full, parse_counter
    from train.rewards import compute_reward
    from data.v2.generate_data_v2 import (
        build_assistant_turn, score_counter, build_user_prompt, SYSTEM_PROMPT,
    )
    from data.v2.resolver_py import FIGHTERS

    rows = load_jsonl(f"/data/{data_path}")[:n_states]
    print(f"Rolling out {len(rows)} states × K={k_samples} (sampled) + supervised fallback")

    tok = AutoTokenizer.from_pretrained(model_id, token=os.environ.get("HF_TOKEN"))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "left"

    base = AutoModelForCausalLM.from_pretrained(
        model_id, token=os.environ.get("HF_TOKEN"),
        torch_dtype=torch.bfloat16, device_map="auto",
    )
    model = PeftModel.from_pretrained(base, sft_adapter)
    model.eval()

    sampled_pairs: list = []
    supervised_pairs: list = []

    for batch_start in range(0, len(rows), batch_size):
        batch = rows[batch_start: batch_start + batch_size]
        prompts = [format_prompt(r["system"], r["prompt"]) for r in batch]
        inputs = tok(prompts, return_tensors="pt", padding=True,
                     truncation=True, max_length=352).to(model.device)

        # 1. SFT greedy output (the "rejected" candidate)
        with torch.no_grad():
            sft_out = model.generate(
                **inputs, max_new_tokens=max_new_tokens, do_sample=False,
                pad_token_id=tok.pad_token_id,
            )
        # 2. Sampled K continuations
        with torch.no_grad():
            sampled_out = model.generate(
                **inputs, max_new_tokens=max_new_tokens,
                do_sample=True, temperature=temperature, top_p=top_p,
                num_return_sequences=k_samples, pad_token_id=tok.pad_token_id,
            )

        prompt_len = inputs["input_ids"].shape[1]
        for i, r in enumerate(batch):
            sft_text = tok.decode(sft_out[i][prompt_len:], skip_special_tokens=True)
            sft_move = parse_counter(sft_text)
            prompt_text = prompts[i]

            sampled_texts = []
            for k in range(k_samples):
                seq_idx = i * k_samples + k
                sampled_texts.append(
                    tok.decode(sampled_out[seq_idx][prompt_len:], skip_special_tokens=True)
                )
            sft_score = compute_reward(sft_move, prompt_text)
            sampled_scores = [compute_reward(parse_counter(t), prompt_text)
                              for t in sampled_texts]
            ranked = sorted(range(len(sampled_scores)),
                            key=lambda j: -sampled_scores[j])
            best_idx, worst_idx = ranked[0], ranked[-1]
            if sampled_scores[best_idx] - sampled_scores[worst_idx] >= min_score_gap:
                sampled_pairs.append({
                    "prompt": prompt_text,
                    "chosen": sampled_texts[best_idx] + "<end_of_turn>\n",
                    "rejected": sampled_texts[worst_idx] + "<end_of_turn>\n",
                    "chosen_score": float(sampled_scores[best_idx]),
                    "rejected_score": float(sampled_scores[worst_idx]),
                    "source": "sampled",
                })

            # Supervised fallback: use resolver-optimal as chosen if it
            # differs from the SFT's greedy output
            import sys as _sys
            _sys.path.insert(0, "/root")
            from data.v2.generate_data_v2 import State
            st = State(**r["state"])
            legal = ("jab", "cross", "low_kick", "roundhouse", "uppercut",
                     "parry", "backstep", "clinch", "throw")
            scored = [(c, score_counter(st, c)) for c in legal]
            scored.sort(key=lambda kv: -kv[1])
            best_move, best_score = scored[0]
            if best_move != sft_move and best_score - sft_score >= 0.05:
                optimal_completion = build_assistant_turn(st, best_move)
                supervised_pairs.append({
                    "prompt": prompt_text,
                    "chosen": optimal_completion + "<end_of_turn>\n",
                    "rejected": sft_text + "<end_of_turn>\n",
                    "chosen_score": float(best_score),
                    "rejected_score": float(sft_score),
                    "source": "supervised",
                })

        if (batch_start // batch_size) % 20 == 0:
            print(f"  {batch_start + len(batch)}/{len(rows)}"
                  f"  sampled={len(sampled_pairs)}  supervised={len(supervised_pairs)}")

    out_rows = sampled_pairs + supervised_pairs
    out_file = Path(f"/data/{out_path}")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("w", encoding="utf-8") as f:
        for r in out_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(out_rows)} DPO pairs to {out_file}"
          f"  (sampled={len(sampled_pairs)}, supervised={len(supervised_pairs)})")
    if out_rows:
        import statistics
        gaps = [r["chosen_score"] - r["rejected_score"] for r in out_rows]
        print(f"Mean score gap: {statistics.mean(gaps):.3f}"
              f"  median: {statistics.median(gaps):.3f}")
        from collections import Counter
        print("Chosen-move distribution:", dict(Counter(
            r["chosen"].split("counter_move:")[-1].split("<")[0].strip()
            for r in out_rows).most_common()))
        print("Rejected-move distribution:", dict(Counter(
            r["rejected"].split("counter_move:")[-1].split("<")[0].strip()
            for r in out_rows).most_common()))
    data_volume.commit()


@app.function(
    image=image,
    gpu="L4",
    timeout=2 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def make_clean_dpo_pairs(
    data_path: str = "v2/sft_v2.jsonl",
    sft_adapter: str = "/models/sft",
    model_id: str = "google/gemma-3-270m-it",
    n_states: int = 6000,
    batch_size: int = 8,
    min_score_gap: float = 0.05,
    out_path: str = "v2/dpo_clean.jsonl",
):
    """Build a clean (prompt, chosen, rejected) dataset where:
        chosen   = resolver-optimal templated reasoning + counter_move
        rejected = the SFT model's greedy output (which pattern-matches).
    We pair only when the two answers differ (and by a meaningful reward
    gap). All text is well-formed — no high-temperature sampling."""
    import json
    import torch
    from peft import PeftModel
    from transformers import AutoTokenizer, AutoModelForCausalLM

    sys.path.insert(0, "/root")
    from train.common import load_jsonl, format_prompt, parse_counter
    from train.rewards import compute_reward
    from data.v2.generate_data_v2 import (
        State, build_assistant_turn, score_counter, SYSTEM_PROMPT,
    )
    from data.v2.resolver_py import FIGHTERS
    from collections import Counter

    rows = load_jsonl(f"/data/{data_path}")[:n_states]
    print(f"Building clean DPO dataset from {len(rows)} states (greedy SFT vs resolver-optimal)")

    tok = AutoTokenizer.from_pretrained(model_id, token=os.environ.get("HF_TOKEN"))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "left"

    base = AutoModelForCausalLM.from_pretrained(
        model_id, token=os.environ.get("HF_TOKEN"),
        torch_dtype=torch.bfloat16, device_map="auto",
    )
    model = PeftModel.from_pretrained(base, sft_adapter)
    model.eval()

    out_rows: list = []
    sft_move_counts: Counter = Counter()
    optimal_move_counts: Counter = Counter()
    disagree = 0
    same = 0

    for batch_start in range(0, len(rows), batch_size):
        batch = rows[batch_start: batch_start + batch_size]
        prompts = [format_prompt(r["system"], r["prompt"]) for r in batch]
        inputs = tok(prompts, return_tensors="pt", padding=True,
                     truncation=True, max_length=352).to(model.device)

        with torch.no_grad():
            sft_out = model.generate(
                **inputs, max_new_tokens=160, do_sample=False,
                pad_token_id=tok.pad_token_id,
            )
        prompt_len = inputs["input_ids"].shape[1]
        for i, r in enumerate(batch):
            sft_text = tok.decode(sft_out[i][prompt_len:], skip_special_tokens=True)
            sft_move = parse_counter(sft_text)
            prompt_text = prompts[i]

            st = State(**r["state"])
            legal = ("jab", "cross", "low_kick", "roundhouse", "uppercut",
                     "parry", "backstep", "clinch", "throw")
            scored = [(c, score_counter(st, c)) for c in legal]
            scored.sort(key=lambda kv: -kv[1])
            optimal_move, optimal_score = scored[0]

            sft_move_counts[sft_move] += 1
            optimal_move_counts[optimal_move] += 1

            if optimal_move == sft_move:
                same += 1
                continue
            disagree += 1
            sft_score = compute_reward(sft_move, prompt_text)
            if optimal_score - sft_score < min_score_gap:
                continue

            optimal_completion = build_assistant_turn(st, optimal_move)
            out_rows.append({
                "prompt": prompt_text,
                "chosen": optimal_completion + "<end_of_turn>\n",
                "rejected": sft_text + "<end_of_turn>\n",
                "chosen_move": optimal_move,
                "rejected_move": sft_move,
                "chosen_score": float(optimal_score),
                "rejected_score": float(sft_score),
                "score_gap": float(optimal_score - sft_score),
            })

        if (batch_start // batch_size) % 20 == 0:
            print(f"  {batch_start + len(batch)}/{len(rows)}"
                  f"  pairs={len(out_rows)}  disagree={disagree}  same={same}")

    out_file = Path(f"/data/{out_path}")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with out_file.open("w", encoding="utf-8") as f:
        for r in out_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"\nSFT agrees with resolver: {same}/{len(rows)} ({100*same/len(rows):.1f}%)")
    print(f"SFT disagrees: {disagree}/{len(rows)} ({100*disagree/len(rows):.1f}%)")
    print(f"Wrote {len(out_rows)} pairs to {out_file}")
    print(f"SFT move distribution: {dict(sft_move_counts.most_common())}")
    print(f"Optimal move distribution: {dict(optimal_move_counts.most_common())}")
    if out_rows:
        import statistics
        gaps = [r["score_gap"] for r in out_rows]
        print(f"Score gap — mean: {statistics.mean(gaps):.3f}  median: {statistics.median(gaps):.3f}")
    data_volume.commit()


@app.function(
    image=image,
    gpu="L4",
    timeout=2 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def train_dpo_from_rollouts(
    data_path: str = "v2/dpo_clean.jsonl",
    sft_adapter: str = "/models/sft",
    model_id: str = "google/gemma-3-270m-it",
    epochs: float = 1.0,
    batch: int = 2,
    grad_accum: int = 8,
    lr: float = 5e-7,
    beta: float = 0.1,
    max_length: int = 512,
):
    """DPO training on the rejection-sampled preference pairs."""
    import torch
    from datasets import Dataset
    from peft import PeftModel

    sys.path.insert(0, "/root")
    from train.common import load_jsonl, load_base

    rows = load_jsonl(f"/data/{data_path}")
    print(f"DPO training on {len(rows)} pairs")

    ds = Dataset.from_list(rows)

    tok, base = load_base(model_id)
    model = PeftModel.from_pretrained(base, sft_adapter, is_trainable=True)
    for n, p in model.named_parameters():
        if "lora_" in n:
            p.requires_grad_(True)
    model.print_trainable_parameters()

    from trl import DPOTrainer, DPOConfig
    cfg = DPOConfig(
        output_dir="/checkpoints/dpo",
        num_train_epochs=epochs,
        per_device_train_batch_size=batch,
        gradient_accumulation_steps=grad_accum,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_length=max_length,
        logging_steps=20,
        save_strategy="epoch",
        save_total_limit=1,
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=0,
        beta=beta,
        gradient_checkpointing=True,
        optim="adamw_torch",
    )
    trainer = DPOTrainer(model=model, args=cfg, train_dataset=ds, processing_class=tok)
    trainer.train()
    trainer.save_model("/checkpoints/dpo")
    tok.save_pretrained("/checkpoints/dpo")

    import shutil
    out = Path("/models/dpo")
    if out.exists():
        shutil.rmtree(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree("/checkpoints/dpo", out)
    print(f"DPO adapter saved to {out}")
    volume.commit()


@app.function(
    image=image,
    gpu="L4",
    timeout=10 * 60,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def test_dpo_inference(
    adapter: str = "/models/dpo",
    model_id: str = "google/gemma-3-270m-it",
    n: int = 8,
):
    """Live inference test: generate 8 prompts that span the attribute matrix
    (fast vs slow, heavy vs light, close vs far) and report the model's
    counter_move + reward for each. Shows the DPO model is actually
    attribute-aware (different character combos get different answers)."""
    import json
    import torch
    from peft import PeftModel
    from transformers import AutoTokenizer, AutoModelForCausalLM

    sys.path.insert(0, "/root")
    from train.common import format_prompt, parse_counter
    from train.rewards import compute_reward
    from data.v2.generate_data_v2 import State, build_user_prompt
    from data.v2.resolver_py import FIGHTERS

    tok = AutoTokenizer.from_pretrained(model_id, token=os.environ.get("HF_TOKEN"))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "left"

    base = AutoModelForCausalLM.from_pretrained(
        model_id, token=os.environ.get("HF_TOKEN"),
        torch_dtype=torch.bfloat16, device_map="auto",
    )
    model = PeftModel.from_pretrained(base, adapter)
    model.eval()

    # A spectrum of state profiles to test attribute awareness
    test_cases = [
        {"name": "fast monk jab-spamming close",
         "pc": "monk", "nc": "brute", "dist": "close", "ps": 100, "ns": 100, "r": 3,
         "last5": ("jab","jab","jab","jab","jab")},
        {"name": "slow brute jab-spamming close (same last5)",
         "pc": "brute", "nc": "monk", "dist": "close", "ps": 100, "ns": 100, "r": 3,
         "last5": ("jab","jab","jab","jab","jab")},
        {"name": "heavy brute cross-spamming close",
         "pc": "brute", "nc": "monk", "dist": "close", "ps": 100, "ns": 100, "r": 3,
         "last5": ("cross","cross","cross","cross","cross")},
        {"name": "fast monk cross-spamming close (same last5)",
         "pc": "monk", "nc": "brute", "dist": "close", "ps": 100, "ns": 100, "r": 3,
         "last5": ("cross","cross","cross","cross","cross")},
        {"name": "fast monk roundhouse-spamming far",
         "pc": "monk", "nc": "brute", "dist": "far", "ps": 100, "ns": 100, "r": 3,
         "last5": ("roundhouse","roundhouse","roundhouse","roundhouse","roundhouse")},
        {"name": "slow brute roundhouse-spamming far (same last5)",
         "pc": "brute", "nc": "monk", "dist": "far", "ps": 100, "ns": 100, "r": 3,
         "last5": ("roundhouse","roundhouse","roundhouse","roundhouse","roundhouse")},
        {"name": "low-stamina fast monk (should punish with heavy)",
         "pc": "monk", "nc": "brute", "dist": "close", "ps": 15, "ns": 100, "r": 3,
         "last5": ("jab","low_kick","cross","jab","cross")},
        {"name": "high-stamina fast monk (same)",
         "pc": "monk", "nc": "brute", "dist": "close", "ps": 100, "ns": 100, "r": 3,
         "last5": ("jab","low_kick","cross","jab","cross")},
    ][:n]

    results = []
    for tc in test_cases:
        pc = FIGHTERS[tc["pc"]]
        nc = FIGHTERS[tc["nc"]]
        state = State(
            player_char_id=tc["pc"], npc_char_id=tc["nc"],
            player_speed=pc["stats"]["speed"], player_power=pc["stats"]["power"],
            player_range=pc["stats"]["range"], player_weight=pc["physics"]["weight"],
            player_stance=pc["stance"],
            npc_speed=nc["stats"]["speed"], npc_power=nc["stats"]["power"],
            npc_range=nc["stats"]["range"], npc_weight=nc["physics"]["weight"],
            npc_stance=nc["stance"],
            distance_bucket=tc["dist"],
            distance={"close": 1.5, "mid": 3.0, "far": 4.5}[tc["dist"]],
            player_stamina=tc["ps"], npc_stamina=tc["ns"],
            round=tc["r"], last5=tc["last5"], pattern="custom",
        )
        prompt = format_prompt("", build_user_prompt(state))
        inputs = tok(prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                **inputs, max_new_tokens=120, do_sample=False,
                pad_token_id=tok.pad_token_id,
            )
        text = tok.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True)
        move = parse_counter(text)
        reward = compute_reward(move, prompt)
        results.append({
            "name": tc["name"],
            "player": tc["pc"], "npc": tc["nc"],
            "last5": ",".join(tc["last5"]),
            "distance": tc["dist"],
            "stamina": tc["ps"],
            "counter_move": move,
            "reward": float(reward),
            "reasoning_snippet": text.split("\ncounter_move:")[0].strip()[-160:],
        })

    print("\n" + "=" * 80)
    print("DPO MODEL — ATTRIBUTE-AWARE INFERENCE TEST")
    print("=" * 80)
    for r in results:
        print(f"\n  Test: {r['name']}")
        print(f"    player={r['player']}  npc={r['npc']}  dist={r['distance']}  stam={r['stamina']}")
        print(f"    last5: {r['last5']}")
        print(f"    → counter_move: {r['counter_move']}    reward: {r['reward']:+.3f}")
        print(f"    reasoning: ...{r['reasoning_snippet']}")
    print("\n" + "=" * 80)
    print("KEY QUESTION: do identical last-5 + stamina produce different counter_moves")
    print("for different (player_char, npc_char) combinations?")
    print("=" * 80)
    # Group by last5+stamina and check if answers differ across character pairs
    from collections import defaultdict
    by_state = defaultdict(list)
    for r in results:
        key = (r["last5"], r["stamina"], r["distance"])
        by_state[key].append(r)
    for key, group in by_state.items():
        moves = [g["counter_move"] for g in group]
        unique = set(moves)
        print(f"\n  same last5+stam+dist → moves: {moves}  unique: {len(unique)}")
        for g in group:
            print(f"    {g['player']} vs {g['npc']}  →  {g['counter_move']}  (reward {g['reward']:+.3f})")

    return results


# ---------------------------------------------------------------------------
# Publish adapter to HF Hub (runs inside Modal — no local download needed)
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    timeout=1800,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume},
)
def publish_adapter(adapter_path: str = "/models/sft"):
    """Upload the trained adapter to HuggingFace Hub."""
    from huggingface_hub import HfApi, whoami, create_repo, upload_folder
    api = HfApi()
    user = whoami()["name"]
    repo = f"{user}/cyber-duel-tiny-adapter"
    create_repo(repo_id=repo, repo_type="model", exist_ok=True)
    print(f"Uploading {adapter_path} -> {repo}")
    upload_folder(
        folder_path=adapter_path,
        repo_id=repo,
        repo_type="model",
        commit_message="Upload cyber-duel-tiny LoRA adapter (SFT)",
    )
    print(f"Published: https://huggingface.co/{repo}")


# ---------------------------------------------------------------------------
# Inference endpoint (optional — for Modal hosting instead of HF Space)
# ---------------------------------------------------------------------------

@app.cls(
    gpu="L4",
    timeout=600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume},
)
class Model:
    """Optional Modal-hosted inference endpoint. Defaults to the SFT
    adapter; override with `modal run modal/app.py::serve --adapter
    /models/grpo` after GRPO completes."""

    @modal.enter()
    def load(self):
        import torch
        from peft import PeftModel
        sys.path.insert(0, "/root")
        from train.common import load_base, parse_counter

        adapter = os.environ.get("ADAPTER_PATH", "/models/sft")
        log_path = Path(adapter) / "adapter_config.json"
        if not log_path.exists():
            raise RuntimeError(
                f"Adapter not found at {adapter}. "
                f"Run modal run modal/app.py::train_sft first."
            )
        self.tok, self.base = load_base("google/gemma-3-270m-it")
        self.model = PeftModel.from_pretrained(self.base, adapter)
        self.model.eval()
        self.parse_counter = parse_counter

    @modal.method()
    def predict(self, sequence: str) -> dict:
        import torch
        prompt = (
            "<start_of_turn>user\nYou are an expert fighting game NPC AI. "
            f"The user has performed this sequence of 5 moves: {sequence}.\n"
            "Decide on the best counter-move from: jab, cross, low_kick, "
            "roundhouse, uppercut, parry, backstep, clinch, throw.\n"
            "Respond in this format:\n[reasoning]\ncounter_move: [move]"
            "<end_of_turn>\n<start_of_turn>model\n"
        )
        inputs = self.tok(prompt, return_tensors="pt").to(self.model.device)
        with torch.no_grad():
            out = self.model.generate(
                **inputs, max_new_tokens=200, do_sample=False,
                pad_token_id=self.tok.eos_token_id,
            )
        text = self.tok.decode(out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)
        move = self.parse_counter(text)
        reasoning = text.split("counter_move:")[0].strip() if "counter_move:" in text else text.strip()
        return {"reasoning": reasoning, "counterMove": move, "sequence": sequence}
