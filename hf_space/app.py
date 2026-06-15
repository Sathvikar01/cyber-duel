"""Cyber Duel Tiny -- FastAPI service for the HF Space.

Drop-in replacement for the 4B Gemma advisor, with optional per-user
online RL: each /predict can carry a `playerId` (UUID minted by the
client), and the Space will lazily load that user's LoRA delta adapter
from the `cyber-duel-tiny-users` Hub repo, log the (state, model_move,
player_next_move) triple to the `cyber-duel-tiny-logs` dataset repo, and
trigger a Modal retrain job when the user has accumulated enough new
clean pairs.  Clients without `playerId` keep using the frozen global
adapter exactly as before.

API
---
POST /predict
  Legacy form (still supported, no RL):
    {"sequence": "jab,cross,low_kick,roundhouse,uppercut"}
  Full state form (recommended):
    {
      "sequence":  "jab,cross,low_kick,roundhouse,uppercut",
      "player": {...}, "npc": {...},
      "round": 3, "distance": "close",
      "playerId":      "ab12-...",        # optional
      "playerPrevMove": "jab",            # optional, required for online RL
    }

GET  /health                          # {ready, has_token, online_rl_enabled}
GET  /me?playerId=...                 # {rounds_logged, retrains_done, ...}
POST /forget     {"playerId": "..."}  # delete user's adapter + log
"""
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM, AutoConfig
from peft import PeftModel
from huggingface_hub import (
    HfApi, snapshot_download, hf_hub_download, create_repo,
)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                    format="%(asctime)s | %(levelname)s | %(message)s")
log = logging.getLogger("cyber-duel-tiny")

BASE_MODEL = os.environ.get("BASE_MODEL", "google/gemma-3-270m-it")
ADAPTER_MODEL = os.environ.get("ADAPTER_MODEL", "Sathvik0101/cyber-duel-tiny-adapter")
USERS_REPO = os.environ.get("USERS_REPO", "Sathvik0101/cyber-duel-tiny-users")
LOGS_REPO = os.environ.get("LOGS_REPO", "Sathvik0101/cyber-duel-tiny-logs")
MODAL_WEBHOOK_URL = os.environ.get("MODAL_WEBHOOK_URL", "").strip()
MODAL_WEBHOOK_SECRET = os.environ.get("MODAL_WEBHOOK_SECRET", "").strip()

SKIP_MODEL_LOAD = os.environ.get("SKIP_MODEL_LOAD", "0") == "1"
ONLINE_RL_ENABLED = MODAL_WEBHOOK_URL != "" and MODAL_WEBHOOK_SECRET != ""

# Online-RL tunables
RETRAIN_THRESHOLD = int(os.environ.get("RETRAIN_THRESHOLD", "25"))
LOG_BUFFER_FLUSH_SEC = int(os.environ.get("LOG_BUFFER_FLUSH_SEC", "15"))
LOG_BUFFER_FLUSH_ROWS = int(os.environ.get("LOG_BUFFER_FLUSH_ROWS", "10"))
USER_ADAPTER_CACHE_SIZE = int(os.environ.get("USER_ADAPTER_CACHE_SIZE", "32"))
RETRAIN_COOLDOWN_SEC = int(os.environ.get("RETRAIN_COOLDOWN_SEC", "600"))  # 10 min
# Track retrain-request timestamps per uid in RAM to avoid spamming Modal
RETRAIN_INFLIGHT: Dict[str, float] = {}
# Per-uid last flush time (RAM-side; not a Space secret)
LAST_FLUSH_AT: Dict[str, float] = {}

# ---- Global model state ---------------------------------------------------
HAS_MODEL = False
base_model = None  # the underlying base, shared by all PEFT deltas
global_adapter = None  # PEFT model wrapping base_model with the global DPO adapter
tokenizer = None

# ---- Per-user state -------------------------------------------------------
# LRU cache of PeftModel objects, keyed by playerId
USER_ADAPTER_CACHE: "OrderedDict[str, PeftModel]" = OrderedDict()
# Per-uid pending log rows (not yet flushed to Hub)
LOG_BUFFER: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
# Last row for this uid (so the *next* /predict can fill in player_next_move)
LAST_ROW: Dict[str, Dict[str, Any]] = {}
# uid -> total flushed rows (for /me + retrain threshold)
FLUSHED_COUNT: Dict[str, int] = defaultdict(int)
# uid -> last time we POSTed /retrain to Modal (RAM-side cooldown)
LAST_RETRAIN_REQUEST: Dict[str, float] = {}

# Single lock so concurrent /predict calls don't double-flush
state_lock = threading.Lock()

LEGAL_MOVES = ("jab", "cross", "low_kick", "roundhouse", "uppercut",
               "parry", "backstep", "clinch", "throw")

# ---- Prompt schema (mirrors train/common.py + generate_data_v2.py) -------
DEFAULT_PLAYER = {"name": "fighter", "speed": 3, "power": 3, "range": 3,
                  "weight": 1.0, "stance": "neutral", "stamina": 100, "hp": 100}
DEFAULT_NPC = {"name": "fighter", "speed": 3, "power": 3, "range": 3,
               "weight": 1.0, "stance": "neutral", "stamina": 100, "hp": 100}

SYSTEM_PROMPT = (
    "You are an expert NPC AI for Duel of Albion, a 3D fighting game.\n"
    "Read the round, distance, both fighters' stats and stances, and the "
    "player's last 5 moves. Choose the single best counter-move from the 9 "
    "legal moves. Always end your reply with `counter_move: <move>` on its "
    "own line."
)


def get_hf_token() -> Optional[str]:
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if tok:
        return tok
    cache = Path.home() / ".cache" / "huggingface" / "token"
    if cache.exists():
        return cache.read_text(encoding="utf-8").strip() or None
    return None


def load_global_model():
    """Load the base + global DPO adapter once, share base_model across
    all per-user PEFT deltas."""
    global HAS_MODEL, base_model, global_adapter, tokenizer
    if SKIP_MODEL_LOAD:
        log.info("SKIP_MODEL_LOAD=1 -- model is not loaded")
        return
    try:
        hf_token = get_hf_token()
        log.info(f"Loading base {BASE_MODEL} + global adapter {ADAPTER_MODEL}...")

        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=hf_token)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "left"

        device_arg = "auto" if torch.cuda.is_available() else None
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

        config = AutoConfig.from_pretrained(BASE_MODEL, token=hf_token)
        if hasattr(config, "vision_config") and config.vision_config is not None:
            config.vision_config = None

        base_model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL, config=config, token=hf_token,
            torch_dtype=dtype, device_map=device_arg,
        )
        adapter_path = snapshot_download(repo_id=ADAPTER_MODEL, token=hf_token)
        global_adapter = PeftModel.from_pretrained(base_model, adapter_path)
        global_adapter.eval()

        # Warmup
        warmup_state = {
            "player": DEFAULT_PLAYER, "npc": DEFAULT_NPC,
            "round": 1, "distance": "close",
            "sequence": "jab,cross,low_kick,roundhouse,uppercut",
        }
        warmup_prompt = build_prompt(warmup_state)
        warmup_inputs = tokenizer(warmup_prompt, return_tensors="pt").to(base_model.device)
        with torch.no_grad():
            _ = global_adapter.generate(
                **warmup_inputs, max_new_tokens=20, do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        HAS_MODEL = True
        log.info("Global model loaded and warmed up on %s", base_model.device)
    except Exception as e:
        log.exception("Global model load failed: %s", e)
        base_model = None
        global_adapter = None
        tokenizer = None
        HAS_MODEL = False


# ---- Prompt + parser ------------------------------------------------------
def _format_fighter(f: dict) -> str:
    return (
        f"{f.get('name', 'fighter')}"
        f" (speed={f.get('speed', 3)}, power={f.get('power', 3)}, "
        f"range={f.get('range', 3)}, weight={f.get('weight', 1.0)}, "
        f"stance={f.get('stance', 'neutral')}, "
        f"stamina={f.get('stamina', 100)}, hp={f.get('hp', 100)})"
    )


def build_prompt(state: dict) -> str:
    player = state.get("player") or DEFAULT_PLAYER
    npc = state.get("npc") or DEFAULT_NPC
    round_ = state.get("round", 1)
    dist = state.get("distance", "close")
    sequence = state.get("sequence", "jab,cross,low_kick,roundhouse,uppercut")
    user_msg = (
        f"Round {round_} | Distance: {dist}\n"
        f"Player: {_format_fighter(player)}\n"
        f"NPC   : {_format_fighter(npc)}\n"
        f"Player last 5 moves: {sequence}\n"
        f"Decide the best counter-move from: "
        f"{', '.join(LEGAL_MOVES)}."
    )
    return (
        f"<start_of_turn>user\n{SYSTEM_PROMPT}\n\n{user_msg}<end_of_turn>\n"
        f"<start_of_turn>model\n"
    )


def parse_counter(text: str) -> str:
    text_low = text.lower()
    if "counter_move:" in text_low:
        tail = text_low.split("counter_move:", 1)[1].strip()
        first = tail.split()[0].strip(".,!?;:'\"")
        first = first.rstrip(",.;:?!")
        if first in LEGAL_MOVES:
            return first
    for m in LEGAL_MOVES:
        if m in text_low:
            return m
    return "jab"


# ---- Inference ------------------------------------------------------------
def _generate_with_model(model, state: dict) -> Tuple[str, str]:
    """Returns (full_text, counter_move)."""
    prompt = build_prompt(state)
    inputs = tokenizer(prompt, return_tensors="pt").to(base_model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs, max_new_tokens=200, do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    text = tokenizer.decode(
        out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True,
    )
    return text, parse_counter(text)


def get_model_for(uid: Optional[str]):
    """Return the PeftModel to use for this request.

    LRU-cache per-user deltas; lazy-download from Hub on first request for
    a new uid.  Falls back to the global adapter if the user has none yet.
    """
    if not uid or not ONLINE_RL_ENABLED:
        return global_adapter, "global"
    with state_lock:
        if uid in USER_ADAPTER_CACHE:
            USER_ADAPTER_CACHE.move_to_end(uid)
            return USER_ADAPTER_CACHE[uid], "user"
    # Lazy download outside the lock.  We use snapshot_download to grab
    # the entire <uid>/ folder (adapter weights + tokenizer files).
    try:
        adapter_dir = snapshot_download(
            repo_id=USERS_REPO, allow_patterns=[f"{uid}/*"],
            token=get_hf_token(),
        )
        # snapshot_download returns the local root that contains
        # `<uid>/adapter_model.safetensors`.  PEFT's from_pretrained
        # expects the folder containing adapter_config.json.
        per_user_dir = str(Path(adapter_dir) / uid)
        if not (Path(per_user_dir) / "adapter_config.json").exists():
            raise FileNotFoundError(f"adapter_config.json not in {per_user_dir}")
        delta = PeftModel.from_pretrained(base_model, per_user_dir)
        delta.eval()
        with state_lock:
            USER_ADAPTER_CACHE[uid] = delta
            USER_ADAPTER_CACHE.move_to_end(uid)
            while len(USER_ADAPTER_CACHE) > USER_ADAPTER_CACHE_SIZE:
                USER_ADAPTER_CACHE.popitem(last=False)
        return delta, "user"
    except Exception as e:
        log.info("No per-user adapter for %s (%s) -- using global", uid, e)
        return global_adapter, "global"


def evict_user_cache(uid: str):
    with state_lock:
        USER_ADAPTER_CACHE.pop(uid, None)


# ---- Online-RL logging ----------------------------------------------------
def _state_to_log(state: dict, model_move: str) -> Dict[str, Any]:
    """Build a log row from the /predict state and the model's response."""
    player = state.get("player") or DEFAULT_PLAYER
    npc = state.get("npc") or DEFAULT_NPC
    last5 = (state.get("sequence", "").split(",") + ["jab"] * 5)[:5]
    dist = state.get("distance", "close")
    distance_m = {"close": 1.5, "mid": 3.0, "far": 4.5}.get(dist, 3.0)
    return {
        "ts": int(time.time()),
        "uid": state.get("playerId", ""),
        "state": {
            "player_char_id": player.get("name", "fighter"),
            "npc_char_id": npc.get("name", "fighter"),
            "player_speed": int(player.get("speed", 3)),
            "player_power": int(player.get("power", 3)),
            "player_range": int(player.get("range", 3)),
            "player_weight": float(player.get("weight", 1.0)),
            "player_stance": player.get("stance", "neutral"),
            "npc_speed": int(npc.get("speed", 3)),
            "npc_power": int(npc.get("power", 3)),
            "npc_range": int(npc.get("range", 3)),
            "npc_weight": float(npc.get("weight", 1.0)),
            "npc_stance": npc.get("stance", "neutral"),
            "distance_bucket": dist,
            "distance": distance_m,
            "player_stamina": int(player.get("stamina", 100)),
            "npc_stamina": int(npc.get("stamina", 100)),
            "round": int(state.get("round", 1)),
            "last5": last5,
        },
        "model_move": model_move,
        "model_adapter_scope": "user" if state.get("playerId") else "global",
        "player_next_move": None,  # filled in by next /predict or on flush
    }


def _flush_user_log(uid: str) -> int:
    """Atomically upload the buffered log rows for `uid` to the logs repo."""
    with state_lock:
        rows = LOG_BUFFER.pop(uid, [])
    if not rows:
        return 0
    n = len(rows)
    try:
        api = HfApi()
        # Ensure repo exists
        create_repo(LOGS_REPO, repo_type="dataset", private=True, exist_ok=True)
        # Download existing, append, re-upload (simple & correct)
        existing_lines: List[str] = []
        try:
            existing = hf_hub_download(
                repo_id=LOGS_REPO, repo_type="dataset",
                filename=f"users/{uid}.jsonl", token=get_hf_token(),
            )
            with open(existing, "r", encoding="utf-8") as f:
                existing_lines = f.readlines()
        except Exception:
            pass
        new_lines = [json.dumps(r, ensure_ascii=False) + "\n" for r in rows]
        with state_lock:
            FLUSHED_COUNT[uid] += n
        api.upload_file(
            path_or_fileobj="".join(existing_lines + new_lines).encode("utf-8"),
            path_in_repo=f"users/{uid}.jsonl",
            repo_id=LOGS_REPO, repo_type="dataset",
            commit_message=f"Append {n} rows for {uid}",
            token=get_hf_token(),
        )
        log.info("Flushed %d rows for %s (total %d)",
                 n, uid, FLUSHED_COUNT[uid])
    except Exception as e:
        log.warning("Log flush failed for %s: %s", uid, e)
        # Put them back so we don't lose data
        with state_lock:
            LOG_BUFFER[uid] = rows + LOG_BUFFER.get(uid, [])
    return n


def _post_webhook(path: str, payload: Dict[str, Any]) -> bool:
    if not (MODAL_WEBHOOK_URL and MODAL_WEBHOOK_SECRET):
        return False
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(MODAL_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    try:
        import urllib.request
        req = urllib.request.Request(
            MODAL_WEBHOOK_URL.rstrip("/") + path,
            data=body, method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Signature": sig,
                "X-Timestamp": str(int(time.time())),
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            log.info("Webhook %s -> %s", path, resp.status)
            return 200 <= resp.status < 300
    except Exception as e:
        log.warning("Webhook %s failed: %s", path, e)
        return False


def _maybe_trigger_retrain(uid: str):
    if not ONLINE_RL_ENABLED:
        return
    now = time.time()
    with state_lock:
        last_ts = LAST_RETRAIN_REQUEST.get(uid, 0)
        flushed = FLUSHED_COUNT.get(uid, 0)
    if now - last_ts < RETRAIN_COOLDOWN_SEC:
        return
    if flushed < RETRAIN_THRESHOLD:
        return
    with state_lock:
        LAST_RETRAIN_REQUEST[uid] = now
    log.info("Triggering retrain for %s (flushed=%d)", uid, flushed)
    _post_webhook("/retrain", {"uid": uid})


# ---- FastAPI app ----------------------------------------------------------
app = FastAPI(title="cyber-duel-tiny")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    load_global_model()
    if ONLINE_RL_ENABLED:
        log.info("Online RL enabled (webhook=%s, logs_repo=%s, users_repo=%s)",
                 MODAL_WEBHOOK_URL, LOGS_REPO, USERS_REPO)
    else:
        log.info("Online RL disabled (no MODAL_WEBHOOK_URL/SECRET set)")


@app.get("/health")
def health():
    return {
        "ready": HAS_MODEL,
        "has_token": get_hf_token() is not None,
        "online_rl_enabled": ONLINE_RL_ENABLED,
        "user_adapters_cached": len(USER_ADAPTER_CACHE),
        "buffered_users": len(LOG_BUFFER),
    }


@app.get("/me")
def me(playerId: str = ""):
    if not ONLINE_RL_ENABLED:
        return {"online_rl_enabled": False}
    if not playerId:
        return {"error": "missing playerId"}
    with state_lock:
        flushed = FLUSHED_COUNT.get(playerId, 0)
        last_ts = LAST_RETRAIN_REQUEST.get(playerId, 0)
        adapter_scope = "user" if playerId in USER_ADAPTER_CACHE else "global"
    next_at = max(0, RETRAIN_THRESHOLD - flushed)
    cooldown_left = max(0, int(RETRAIN_COOLDOWN_SEC - (time.time() - last_ts)))
    return {
        "playerId": playerId,
        "rounds_logged": flushed,
        "next_retrain_in": next_at,
        "cooldown_left_sec": cooldown_left if last_ts else 0,
        "adapter_scope": adapter_scope,
        "online_rl_enabled": True,
    }


@app.post("/forget")
async def forget(request: Request):
    if not ONLINE_RL_ENABLED:
        return JSONResponse(content={"ok": False, "reason": "online_rl_disabled"},
                            status_code=400)
    try:
        data = await request.json()
    except Exception:
        data = {}
    uid = (data or {}).get("playerId", "")
    if not uid or len(uid) < 4 or len(uid) > 64:
        return JSONResponse(content={"ok": False, "reason": "bad playerId"},
                            status_code=400)
    evict_user_cache(uid)
    with state_lock:
        LOG_BUFFER.pop(uid, None)
        LAST_ROW.pop(uid, None)
        FLUSHED_COUNT.pop(uid, None)
        LAST_RETRAIN_REQUEST.pop(uid, None)
        LAST_FLUSH_AT.pop(uid, None)
    _post_webhook("/forget", {"uid": uid})
    return {"ok": True, "uid": uid}


@app.post("/predict")
async def predict(request: Request):
    sequence = ""
    try:
        try:
            data = await request.json()
        except Exception:
            data = {}
        sequence = (data or {}).get("sequence", "")
        state = {
            "sequence":  sequence,
            "player":    (data or {}).get("player"),
            "npc":       (data or {}).get("npc"),
            "round":     (data or {}).get("round", 1),
            "distance":  (data or {}).get("distance", "close"),
            "playerId":  (data or {}).get("playerId", "") or "",
        }
        player_prev_move = (data or {}).get("playerPrevMove", "") or ""

        if not HAS_MODEL:
            return JSONResponse(
                content={"reasoning": "(model not loaded)", "counterMove": "jab", "sequence": sequence},
                status_code=503,
            )

        model, scope = get_model_for(state["playerId"] or None)
        text, counter_move = _generate_with_model(model, state)
        reasoning = text.split("counter_move:")[0].strip() if "counter_move:" in text else text.strip()

        # ---- Online RL bookkeeping (only if a playerId was sent) ----
        if ONLINE_RL_ENABLED and state["playerId"]:
            uid = state["playerId"]
            with state_lock:
                # Backfill the previous row's player_next_move
                if uid in LAST_ROW and player_prev_move in LEGAL_MOVES:
                    LAST_ROW[uid]["player_next_move"] = player_prev_move
                # Save THIS row for the next call to backfill
                LAST_ROW[uid] = _state_to_log(state, counter_move)
                # Add a placeholder row carrying the player's own next move (will be
                # overwritten when the next /predict arrives) so we still log even
                # if the user never comes back.
                LOG_BUFFER[uid].append(LAST_ROW[uid])
                buf_size = len(LOG_BUFFER[uid])
                flushed = FLUSHED_COUNT[uid]

            # Flush if buffer is large or stale
            now = time.time()
            with state_lock:
                last_flush = LAST_FLUSH_AT.get(uid, 0)
            if buf_size >= LOG_BUFFER_FLUSH_ROWS or (
                buf_size > 0 and now - last_flush > LOG_BUFFER_FLUSH_SEC
            ):
                with state_lock:
                    LAST_FLUSH_AT[uid] = now
                # Flush in a background thread so /predict isn't blocked
                threading.Thread(target=_flush_user_log,
                                 args=(uid,), daemon=True).start()
            _maybe_trigger_retrain(uid)

        return JSONResponse(content={
            "reasoning": reasoning,
            "counterMove": counter_move,
            "sequence": sequence,
            "adapterScope": scope,
        })
    except Exception as e:
        log.exception("predict failed: %s", e)
        return JSONResponse(
            content={"reasoning": f"(error: {type(e).__name__}: {e})",
                     "counterMove": "jab", "sequence": sequence},
            status_code=500,
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
