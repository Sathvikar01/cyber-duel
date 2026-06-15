"""Online per-user RL Modal functions.

Provides:
  - retrain_user_adapter(uid, log_jsonl_or_path)
      Pulls a per-user log from the cyber-duel-tiny-logs dataset repo,
      builds DPO pairs, fine-tunes a small LoRA starting from the global
      DPO adapter, evaluates against the global hold-out, and uploads the
      adapter to cyber-duel-tiny-users/<uid>/.

  - reset_user_adapter(uid)
      Deletes the user's folder from the user-adapter repo and the user's
      log file from the logs repo.

  - retrain_global_base(days_back=7)
      Aggregates all user logs in the last `days_back` days, builds a
      big DPO dataset (capped), retrains the global base adapter from
      the current SFT baseline, evaluates, publishes to
      cyber-duel-tiny-adapter.

Quota / safety:
  - Daily retrain counter in cyber-duel-data:/quota/YYYY-MM-DD.txt
  - Per-user cooldown via timestamps in cyber-duel-data:/cooldown/<uid>.txt
  - Eval-gate on every user retrain (refuses to publish a bad adapter)
"""
from __future__ import annotations
import datetime as dt
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import modal
from fastapi import FastAPI, Header, HTTPException, Request
import time
import hmac
import hashlib

ROOT_IN_REPO = Path(__file__).resolve().parent.parent

# Reuse the same image + volumes as the main app
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
        "fastapi",
        "uvicorn[standard]",
    )
    .add_local_dir(str(ROOT_IN_REPO / "data"), "/root/data")
    .add_local_dir(str(ROOT_IN_REPO / "train"), "/root/train")
    .add_local_dir(str(ROOT_IN_REPO / "scripts"), "/root/scripts")
)

# Single image; we just use the same `image` for both training + webhook
# so they're on the same Modal App and `.spawn()` works across funcs.
webhook_image = image

volume = modal.Volume.from_name("cyber-duel-vol", create_if_missing=True)
data_volume = modal.Volume.from_name("cyber-duel-data", create_if_missing=True)
app = modal.App("cyber-duel-tiny-online", image=image)

USERS_REPO = "Sathvik0101/cyber-duel-tiny-users"
LOGS_REPO = "Sathvik0101/cyber-duel-tiny-logs"
ADAPTER_REPO = "Sathvik0101/cyber-duel-tiny-adapter"
GLOBAL_BASE_ADAPTER_LOCAL = "/models/dpo"  # frozen, all per-user deltas start here

# Safety / cost
DAILY_RETRAIN_CAP = 20
PER_USER_COOLDOWN_MINUTES = 10
PER_USER_DAILY_CAP = 5
EVAL_GLOBAL_HOLDOUT = 100
HOLDOUT_N = 5
MIN_SCORE_GAP = 0.05
MIN_TRAIN_PAIRS = 4  # don't waste GPU on tiny datasets


# ---------------------------------------------------------------------------
# Quota helpers
# ---------------------------------------------------------------------------

def _quota_path_today() -> str:
    return f"/data/quota/{dt.date.today().isoformat()}.txt"


def _read_quota_today() -> int:
    p = Path(_quota_path_today())
    if not p.exists():
        return 0
    try:
        return int(p.read_text().strip() or "0")
    except ValueError:
        return 0


def _bump_quota_today() -> int:
    p = Path(_quota_path_today())
    p.parent.mkdir(parents=True, exist_ok=True)
    n = _read_quota_today() + 1
    p.write_text(str(n))
    data_volume.commit()
    return n


def _cooldown_path(uid: str) -> str:
    return f"/data/cooldown/{uid}.txt"


def _cooldown_active(uid: str) -> bool:
    p = Path(_cooldown_path(uid))
    if not p.exists():
        return False
    try:
        last = float(p.read_text().strip() or "0")
    except ValueError:
        return False
    age_min = (dt.datetime.utcnow().timestamp() - last) / 60.0
    return age_min < PER_USER_COOLDOWN_MINUTES


def _stamp_cooldown(uid: str):
    p = Path(_cooldown_path(uid))
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(str(dt.datetime.utcnow().timestamp()))
    data_volume.commit()


def _per_user_count_today(uid: str) -> int:
    p = Path(f"/data/per_user/{dt.date.today().isoformat()}/{uid}.txt")
    if not p.exists():
        return 0
    try:
        return int(p.read_text().strip() or "0")
    except ValueError:
        return 0


def _bump_per_user_today(uid: str):
    p = Path(f"/data/per_user/{dt.date.today().isoformat()}/{uid}.txt")
    p.parent.mkdir(parents=True, exist_ok=True)
    n = _per_user_count_today(uid) + 1
    p.write_text(str(n))
    data_volume.commit()


# ---------------------------------------------------------------------------
# Per-user retrain
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="A100",
    timeout=1200,  # 20 min hard cap per retrain
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def retrain_user_adapter(uid: str, log_remote_path: str = "") -> Dict[str, Any]:
    """One per-user online retrain.

    Args:
      uid: short anonymous playerId
      log_remote_path: optional explicit path inside the logs repo
        (e.g. "users/<uid>.jsonl"). If empty, defaults to users/<uid>.jsonl.

    Returns:
      {ok, skipped, reason, sha, metrics, eval_passed}
    """
    from huggingface_hub import HfApi
    import torch
    from datasets import Dataset
    from peft import PeftModel
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from trl import DPOTrainer, DPOConfig

    sys.path.insert(0, "/root")
    from train.online_dpo import build_pairs
    from train.eval_gate import (
        evaluate_adapter, load_global_holdout, load_user_holdout, decide,
    )
    from train.common import load_jsonl

    log_remote_path = log_remote_path or f"users/{uid}.jsonl"
    out_user: Dict[str, Any] = {
        "uid": uid, "ok": False, "skipped": False, "reason": "",
    }

    # Safety gates
    if not uid or len(uid) < 4 or len(uid) > 64:
        out_user["reason"] = "invalid_uid"
        return out_user
    if _read_quota_today() >= DAILY_RETRAIN_CAP:
        out_user["skipped"] = True
        out_user["reason"] = "daily_global_cap"
        return out_user
    if _cooldown_active(uid):
        out_user["skipped"] = True
        out_user["reason"] = "user_cooldown"
        return out_user
    if _per_user_count_today(uid) >= PER_USER_DAILY_CAP:
        out_user["skipped"] = True
        out_user["reason"] = "per_user_daily_cap"
        return out_user

    # Pull the user log from Hub into the data volume
    log_local = Path(f"/data/users/{uid}.jsonl")
    log_local.parent.mkdir(parents=True, exist_ok=True)
    api = HfApi()
    try:
        from huggingface_hub import hf_hub_download
        downloaded = hf_hub_download(
            repo_id=LOGS_REPO, repo_type="dataset",
            filename=log_remote_path, token=os.environ.get("HF_TOKEN"),
        )
        shutil.copy2(downloaded, log_local)
    except Exception as e:
        out_user["reason"] = f"download_failed: {type(e).__name__}"
        return out_user

    log_rows = load_jsonl(log_local)
    if not log_rows:
        out_user["skipped"] = True
        out_user["reason"] = "empty_log"
        return out_user

    train_pairs, holdout_rows = build_pairs(
        log_rows, min_score_gap=MIN_SCORE_GAP, holdout_n=HOLDOUT_N,
    )
    out_user["n_log_rows"] = len(log_rows)
    out_user["n_train_pairs"] = len(train_pairs)
    out_user["n_holdout"] = len(holdout_rows)
    if len(train_pairs) < MIN_TRAIN_PAIRS:
        out_user["skipped"] = True
        out_user["reason"] = f"too_few_train_pairs({len(train_pairs)})"
        return out_user
    if len(holdout_rows) < 3:
        out_user["skipped"] = True
        out_user["reason"] = f"too_few_holdout_rows({len(holdout_rows)})"
        return out_user

    # Materialize the DPO dataset
    def to_pair(p):
        return {
            "prompt": f"<start_of_turn>user\n{p['system']}\n\n{p['prompt']}<end_of_turn>\n<start_of_turn>model\n",
            "chosen": p["chosen"] + "<end_of_turn>\n",
            "rejected": p["rejected"] + "<end_of_turn>\n",
        }
    ds = Dataset.from_list([to_pair(p) for p in train_pairs])

    # Snapshot the global base so we can start fresh every time
    global_base = Path("/models/dpo")
    if not global_base.exists():
        out_user["reason"] = "global_base_missing"
        return out_user

    # Train
    model_id = "google/gemma-3-270m-it"
    tok = AutoTokenizer.from_pretrained(model_id, token=os.environ.get("HF_TOKEN"))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "left"

    base = AutoModelForCausalLM.from_pretrained(
        model_id, token=os.environ.get("HF_TOKEN"),
        torch_dtype=torch.bfloat16, device_map="auto",
    )
    model = PeftModel.from_pretrained(base, str(global_base), is_trainable=True)
    for n, p_ in model.named_parameters():
        if "lora_" in n:
            p_.requires_grad_(True)
    model.print_trainable_parameters()

    out_ckpt = Path(f"/checkpoints/user_{uid}")
    if out_ckpt.exists():
        shutil.rmtree(out_ckpt)
    cfg = DPOConfig(
        output_dir=str(out_ckpt),
        # 3 epochs so 11 pairs get ~16 update steps -- enough for the LoRA
        # to actually distinguish chosen vs rejected.
        num_train_epochs=3.0,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        learning_rate=5e-7,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_length=512,
        logging_steps=10,
        save_strategy="no",
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=0,
        beta=0.1,
        # 270M fits comfortably on L4 bf16 without gradient checkpointing,
        # and disabling it lets the eval-gate reuse the trained model
        # directly without re-loading the base.
        gradient_checkpointing=False,
        optim="adamw_torch",
    )
    trainer = DPOTrainer(model=model, args=cfg, train_dataset=ds, processing_class=tok)
    trainer.train()

    # Save adapter to /models/users/<uid>
    out_dir = Path(f"/models/users/{uid}")
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.parent.mkdir(parents=True, exist_ok=True)
    trainer.model.save_pretrained(str(out_dir))
    tok.save_pretrained(str(out_dir))
    volume.commit()

    # Eval gate: 200-state global + user's own hold-out
    print("Eval-gating the new adapter...")
    metrics_global = evaluate_adapter(
        trainer.model, tok, *load_global_holdout("/data/v2/sft_v2.jsonl", EVAL_GLOBAL_HOLDOUT),
    )
    print(f"  global metrics: {json.dumps(metrics_global, indent=None)}")
    if holdout_rows:
        u_states = [r["state"] for r in holdout_rows]
        u_obs = [r["chosen_move"] for r in holdout_rows]
        metrics_user = evaluate_adapter(trainer.model, tok, u_states, u_obs)
        print(f"  user metrics:   {json.dumps(metrics_user, indent=None)}")
    else:
        metrics_user = {"n": 0, "mean_reward": 0.0, "legal_move_rate": 1.0, "format_compliance": 1.0}

    # Eval is on 200 procedural states (chosen_move is the resolver-optimal).
    # Pass criteria: legal_move_rate==1.0, format_compliance>=0.98, and
    # mean_reward >= baseline - 0.30 (lenient: small per-user adapters can't
    # be expected to match the global baseline exactly).
    passed = decide(metrics_global, metrics_user, baseline_mean_reward=-0.10)
    out_user["eval_passed"] = bool(passed)
    out_user["metrics_global"] = metrics_global
    out_user["metrics_user"] = metrics_user
    print(f"  eval PASSED={passed}")

    if not passed:
        out_user["skipped"] = True
        out_user["reason"] = "eval_gate_failed"
        print(f"  eval FAILED -> skipped")
        # Still commit the cooldown so we don't burn compute on the same
        # bad data again for 10 minutes
        _bump_quota_today()
        _stamp_cooldown(uid)
        _bump_per_user_today(uid)
        return out_user

    # Upload the passing adapter to cyber-duel-tiny-users/<uid>/
    try:
        api.create_repo(repo_id=USERS_REPO, repo_type="model", private=True, exist_ok=True)
        # First, clear any stale files for this user so the upload is
        # deterministic (old artifacts from a different retrain).
        try:
            existing = api.list_repo_files(repo_id=USERS_REPO, repo_type="model")
            stale = [f for f in existing if f.startswith(f"{uid}/")]
            for f in stale:
                try:
                    api.delete_file(repo_id=USERS_REPO, repo_type="model",
                                    path_in_repo=f)
                except Exception:
                    pass
        except Exception:
            pass
        api.upload_folder(
            folder_path=str(out_dir),
            path_in_repo=uid,
            repo_id=USERS_REPO,
            repo_type="model",
            commit_message=f"Online retrain for {uid} ({len(train_pairs)} pairs)",
        )
        sha = api.model_info(USERS_REPO, private=True).sha
        out_user["sha"] = sha
        print(f"  published to {USERS_REPO}/{uid}/")
    except Exception as e:
        out_user["reason"] = f"upload_failed: {type(e).__name__}: {e}"
        return out_user

    out_user["ok"] = True
    out_user["reason"] = "ok"
    _bump_quota_today()
    _stamp_cooldown(uid)
    _bump_per_user_today(uid)
    return out_user


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    timeout=600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/data": data_volume},
)
def reset_user_adapter(uid: str) -> Dict[str, Any]:
    """Delete the user's adapter folder + log file (GDPR / privacy)."""
    from huggingface_hub import HfApi
    api = HfApi()

    out: Dict[str, Any] = {"uid": uid, "ok": False, "actions": []}

    # 1. Delete adapter folder from cyber-duel-tiny-users
    try:
        api.delete_folder(repo_id=USERS_REPO, repo_type="model", path_in_repo=uid)
        out["actions"].append("adapter_deleted")
    except Exception as e:
        out["actions"].append(f"adapter_error: {type(e).__name__}")

    # 2. Delete the log file from cyber-duel-tiny-logs
    try:
        api.delete_file(repo_id=LOGS_REPO, repo_type="dataset", path_in_repo=f"users/{uid}.jsonl")
        out["actions"].append("log_deleted")
    except Exception as e:
        out["actions"].append(f"log_error: {type(e).__name__}")

    # 3. Wipe the local copy + cooldown + per-user counter
    local_log = Path(f"/data/users/{uid}.jsonl")
    if local_log.exists():
        local_log.unlink()
    cd = Path(_cooldown_path(uid))
    if cd.exists():
        cd.unlink()
    data_volume.commit()

    out["ok"] = True
    return out


# ---------------------------------------------------------------------------
# Global retrain (aggregated across users)
# ---------------------------------------------------------------------------

@app.function(
    image=image,
    gpu="A100",
    timeout=2 * 3600,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume, "/data": data_volume},
)
def retrain_global_base(days_back: int = 7, max_pairs: int = 20000) -> Dict[str, Any]:
    """Aggregate all per-user logs from the last `days_back` days, build a
    mixed DPO dataset, and retrain the global base adapter from the SFT
    baseline."""
    from huggingface_hub import HfApi, hf_hub_download
    import torch
    from datasets import Dataset
    from peft import PeftModel
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from trl import DPOTrainer, DPOConfig

    sys.path.insert(0, "/root")
    from train.online_dpo import build_pairs
    from train.eval_gate import evaluate_adapter, load_global_holdout, decide
    from train.common import load_jsonl

    api = HfApi()
    cutoff = (dt.datetime.utcnow() - dt.timedelta(days=days_back)).timestamp()

    # List all per-user files
    files = api.list_repo_files(repo_id=LOGS_REPO, repo_type="dataset")
    user_files = [f for f in files if f.startswith("users/") and f.endswith(".jsonl")]
    print(f"Found {len(user_files)} user log files")

    all_rows: List[Dict[str, Any]] = []
    for f in user_files:
        try:
            local = hf_hub_download(
                repo_id=LOGS_REPO, repo_type="dataset",
                filename=f, token=os.environ.get("HF_TOKEN"),
            )
            for r in load_jsonl(local):
                r["_src"] = f
                all_rows.append(r)
        except Exception as e:
            print(f"Skip {f}: {e}")

    print(f"Total rows: {len(all_rows)}")
    all_rows = [r for r in all_rows if r.get("ts", 0) >= cutoff]
    print(f"After cutoff: {len(all_rows)}")

    train_pairs, _ = build_pairs(all_rows, min_score_gap=MIN_SCORE_GAP, holdout_n=0)
    print(f"Built {len(train_pairs)} pairs")
    if len(train_pairs) > max_pairs:
        # Keep the most recent ones
        train_pairs = sorted(train_pairs, key=lambda p: p.get("ts", 0))[-max_pairs:]
        print(f"Capped to {len(train_pairs)}")

    if len(train_pairs) < 100:
        return {"ok": False, "reason": "too_few_pairs", "n": len(train_pairs)}

    def to_pair(p):
        return {
            "prompt": f"<start_of_turn>user\n{p['system']}\n\n{p['prompt']}<end_of_turn>\n<start_of_turn>model\n",
            "chosen": p["chosen"] + "<end_of_turn>\n",
            "rejected": p["rejected"] + "<end_of_turn>\n",
        }
    ds = Dataset.from_list([to_pair(p) for p in train_pairs])

    # Train from SFT (NOT from current dpo) so the new global is a step
    # forward, not compounding deltas
    sft = Path("/models/sft")
    if not sft.exists():
        return {"ok": False, "reason": "sft_missing"}

    model_id = "google/gemma-3-270m-it"
    tok = AutoTokenizer.from_pretrained(model_id, token=os.environ.get("HF_TOKEN"))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "left"

    base = AutoModelForCausalLM.from_pretrained(
        model_id, token=os.environ.get("HF_TOKEN"),
        torch_dtype=torch.bfloat16, device_map="auto",
    )
    model = PeftModel.from_pretrained(base, str(sft), is_trainable=True)
    for n, p_ in model.named_parameters():
        if "lora_" in n:
            p_.requires_grad_(True)
    model.print_trainable_parameters()

    out_ckpt = Path("/checkpoints/dpo_new")
    if out_ckpt.exists():
        shutil.rmtree(out_ckpt)
    cfg = DPOConfig(
        output_dir=str(out_ckpt),
        num_train_epochs=1.0,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=8,
        learning_rate=5e-7,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.0,
        max_length=512,
        logging_steps=50,
        save_strategy="no",
        bf16=torch.cuda.is_available(),
        report_to="none",
        seed=0,
        beta=0.1,
        gradient_checkpointing=False,
        optim="adamw_torch",
    )
    trainer = DPOTrainer(model=model, args=cfg, train_dataset=ds, processing_class=tok)
    trainer.train()

    # Eval
    g_states, g_obs = load_global_holdout("/data/v2/sft_v2.jsonl", 1000)
    metrics = evaluate_adapter(trainer.model, tok, g_states, g_obs)
    print("Global eval:", json.dumps(metrics, indent=2))

    passed = decide(metrics, {"n": 0, "mean_reward": 0.0, "legal_move_rate": 1.0, "format_compliance": 1.0}, baseline_mean_reward=0.20)
    if not passed:
        return {"ok": False, "reason": "eval_gate_failed", "metrics": metrics}

    # Save and publish
    new_dpo = Path("/models/dpo_new")
    if new_dpo.exists():
        shutil.rmtree(new_dpo)
    trainer.model.save_pretrained(str(new_dpo))
    tok.save_pretrained(str(new_dpo))
    # Replace /models/dpo with the new one
    target = Path("/models/dpo")
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(new_dpo, target)
    volume.commit()

    api.create_repo(repo_id=ADAPTER_REPO, repo_type="model", private=False, exist_ok=True)
    api.upload_folder(
        folder_path=str(new_dpo),
        repo_id=ADAPTER_REPO,
        repo_type="model",
        commit_message=f"Global online retrain ({len(train_pairs)} pairs from {len(user_files)} users)",
    )
    return {"ok": True, "n_pairs": len(train_pairs), "n_users": len(user_files), "metrics": metrics}

# ---------------------------------------------------------------------------
# Webhook: FastAPI app for the Space to call us
# ---------------------------------------------------------------------------

# Image: same as the training image (with fastapi/uvicorn) so both
# the GPU training funcs and the webhook can coexist on one Modal App.
# `image` is defined at the top of the file.
WEBHOOK_SECRET = ""
REPLAY_WINDOW_SECONDS = 300


def hmac_sha256_hex(secret_bytes: bytes, body: bytes) -> str:
    return hmac.new(secret_bytes, body, hashlib.sha256).hexdigest()


def _verify_webhook_signature(body: bytes, signature: str, ts: str):
    # Re-read on each call so the secret is picked up from env (Modal
    # secrets are mounted at container start, not module import).
    secret = os.environ.get("MODAL_WEBHOOK_SECRET", "")
    if not secret:
        raise ValueError("webhook_secret_not_set")
    try:
        ts_int = int(ts)
    except (TypeError, ValueError):
        raise ValueError("bad_timestamp")
    if abs(int(time.time()) - ts_int) > REPLAY_WINDOW_SECONDS:
        raise ValueError("stale_timestamp")
    expected = hmac_sha256_hex(secret.encode(), body)
    if not hmac.compare_digest(expected, signature or ""):
        raise ValueError("bad_signature")


# Same App -- the webhook functions on the same `cyber-duel-tiny-online` App
webhook_app = app
fastapi_app = FastAPI(title="cyber-duel-tiny-webhook")


@fastapi_app.get("/health")
def _health() -> Dict[str, Any]:
    return {"ok": True, "has_secret": bool(os.environ.get("MODAL_WEBHOOK_SECRET", ""))}


@fastapi_app.post("/retrain")
async def _retrain(request: Request,
                   x_signature: str = Header(default=""),
                   x_timestamp: str = Header(default="")) -> Dict[str, Any]:
    body = await request.body()
    try:
        _verify_webhook_signature(body, x_signature, x_timestamp)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="bad_json")
    uid = (payload or {}).get("uid", "")
    if not uid or len(uid) < 4 or len(uid) > 64:
        raise HTTPException(status_code=400, detail="bad_uid")
    log_remote = (payload or {}).get("log_remote_path", f"users/{uid}.jsonl")
    call = retrain_user_adapter.spawn(uid, log_remote)
    return {"ok": True, "call_id": call.object_id, "uid": uid, "log_remote_path": log_remote}


@fastapi_app.post("/forget")
async def _forget(request: Request,
                  x_signature: str = Header(default=""),
                  x_timestamp: str = Header(default="")) -> Dict[str, Any]:
    body = await request.body()
    try:
        _verify_webhook_signature(body, x_signature, x_timestamp)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="bad_json")
    uid = (payload or {}).get("uid", "")
    if not uid or len(uid) < 4 or len(uid) > 64:
        raise HTTPException(status_code=400, detail="bad_uid")
    call = reset_user_adapter.spawn(uid)
    return {"ok": True, "call_id": call.object_id, "uid": uid}


@webhook_app.function(
    image=webhook_image,
    secrets=[
        modal.Secret.from_name("huggingface-token"),
        modal.Secret.from_name("cyber-duel-webhook-secret"),
    ],
)
@modal.asgi_app()
def fastapi_asgi():
    return fastapi_app
