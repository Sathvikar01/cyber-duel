"""Cyber Duel Tiny — FastAPI service for the new HF Space.

Drop-in replacement for app.py:291-303. Same POST /predict contract.
Base: google/gemma-3-270m-it (text-only, ~540 MB bf16).
Adapter: <your-hf-username>/cyber-duel-tiny-adapter.

To deploy:
  1. Upload the trained adapter to HF Hub (see scripts/publish_space.py)
  2. Push this Space with `python scripts/publish_space.py`
  3. Add HF_TOKEN as a Space Secret so the gated 270M weights can be loaded
"""
import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("cyber-duel-tiny")

BASE_MODEL = os.environ.get("BASE_MODEL", "google/gemma-3-270m-it")
ADAPTER_MODEL = os.environ.get("ADAPTER_MODEL", "Sathvik0101/cyber-duel-tiny-adapter")
SKIP_MODEL_LOAD = os.environ.get("SKIP_MODEL_LOAD", "0") == "1"

HAS_MODEL = False
model = None
tokenizer = None


def get_hf_token() -> str | None:
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if tok:
        return tok
    cache = Path.home() / ".cache" / "huggingface" / "token"
    if cache.exists():
        return cache.read_text(encoding="utf-8").strip() or None
    return None


def load_model():
    global HAS_MODEL, model, tokenizer
    if SKIP_MODEL_LOAD:
        log.info("SKIP_MODEL_LOAD=1 — model is not loaded")
        return
    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM
        from peft import PeftModel
        from huggingface_hub import snapshot_download

        hf_token = get_hf_token()
        log.info(f"Loading {BASE_MODEL} with adapter {ADAPTER_MODEL}...")
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=hf_token)
        device_arg = "auto" if torch.cuda.is_available() else None
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        base = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL, token=hf_token, torch_dtype=dtype, device_map=device_arg,
        )
        adapter_path = snapshot_download(
            repo_id=ADAPTER_MODEL, token=hf_token,
        )
        model = PeftModel.from_pretrained(base, adapter_path)
        model.eval()

        # Warm up
        warmup = (
            "<start_of_turn>user\nYou are an expert fighting game NPC AI. "
            "The user has performed this sequence of 5 moves: jab,cross,low_kick,roundhouse,uppercut.\n"
            "Decide on the best counter-move from: jab, cross, low_kick, "
            "roundhouse, uppercut, parry, backstep, clinch, throw.\n"
            "Respond in this format:\n[reasoning]\ncounter_move: [move]"
            "<end_of_turn>\n<start_of_turn>model\n"
        )
        inputs = tokenizer(warmup, return_tensors="pt").to(model.device)
        with torch.no_grad():
            _ = model.generate(
                **inputs, max_new_tokens=20, do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        HAS_MODEL = True
        log.info("Model loaded and warmed up.")
    except Exception as e:
        log.exception("Model load failed: %s", e)
        model = None
        tokenizer = None


def run_model(sequence: str) -> str:
    prompt = (
        "<start_of_turn>user\nYou are an expert fighting game NPC AI. "
        f"The user has performed this sequence of 5 moves: {sequence}.\n"
        "Decide on the best counter-move from: jab, cross, low_kick, "
        "roundhouse, uppercut, parry, backstep, clinch, throw.\n"
        "Respond in this format:\n[reasoning]\ncounter_move: [move]"
        "<end_of_turn>\n<start_of_turn>model\n"
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        out = model.generate(
            **inputs, max_new_tokens=200, do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    text = tokenizer.decode(
        out[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True,
    )
    counter_move = "jab"
    reasoning = text
    if "counter_move:" in text:
        parts = text.split("counter_move:")
        reasoning = parts[0].strip()
        tail = parts[1].strip()
        first = tail.split()[0].strip(".,!?;:'\"")
        if first in ("jab", "cross", "low_kick", "roundhouse", "uppercut",
                     "parry", "backstep", "clinch", "throw"):
            counter_move = first
    return json.dumps({"reasoning": reasoning, "counterMove": counter_move, "sequence": sequence})


app = FastAPI(title="Cyber Duel Tiny")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
def _startup():
    load_model()


@app.get("/health")
async def health():
    return JSONResponse(content={"ready": HAS_MODEL, "has_token": bool(get_hf_token())})


@app.post("/predict")
async def predict(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    sequence = data.get("sequence", "")
    if not HAS_MODEL:
        return JSONResponse(
            content={"reasoning": "(model not loaded)", "counterMove": "jab", "sequence": sequence},
            status_code=503,
        )
    result_str = run_model(sequence)
    try:
        result = json.loads(result_str)
    except Exception:
        result = {"reasoning": result_str, "counterMove": "jab", "sequence": sequence}
    return JSONResponse(content=result)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))
