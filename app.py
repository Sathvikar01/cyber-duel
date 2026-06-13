import os
import json
import torch
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
import uvicorn

try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    HAS_ML = True
except ImportError:
    HAS_ML = False

BASE_MODEL = "google/gemma-3-4b-it"
ADAPTER_MODEL = "Sathvik0101/gemma-3-combat-npc-adapter"  # public adapter


def get_hf_token():
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if token:
        return token
    token_path = os.path.expanduser("~/.cache/huggingface/token")
    if os.path.exists(token_path):
        try:
            with open(token_path, "r") as f:
                return f.read().strip()
        except Exception:
            pass
    return None


hf_token = get_hf_token()

HAS_MODEL = False
MODEL_ERROR = ""
model = None
tokenizer = None

if HAS_ML:
    print("Loading tokenizer and base model...")
    try:
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, token=hf_token)
        device_arg = "auto" if torch.cuda.is_available() else None
        base_model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL,
            token=hf_token,
            torch_dtype=torch.bfloat16,
            device_map=device_arg
        )
        if not torch.cuda.is_available():
            print("CUDA not available, model loaded on CPU")
        else:
            print(f"CUDA available: {torch.cuda.get_device_name(0)}")

        print("Loading adapter via snapshot_download...")
        from huggingface_hub import snapshot_download
        adapter_path = snapshot_download(repo_id=ADAPTER_MODEL, token=hf_token, force_download=True)
        model = PeftModel.from_pretrained(base_model, adapter_path)

        # Warmup generation to ensure the model is on the correct device and ready.
        print("Running warmup generation...")
        warmup_prompt = (
            "<start_of_turn>user\nYou are an expert fighting game NPC AI. "
            "The user has performed this sequence of 5 moves: jab,cross,low_kick,roundhouse,uppercut.\n"
            "Decide on the best counter-move from: jab, cross, low_kick, roundhouse, uppercut, parry, backstep, clinch, throw.\n"
            "Respond in this format:\n[reasoning]\ncounter_move: [move]"
            "<end_of_turn>\n<start_of_turn>model\n"
        )
        warmup_inputs = tokenizer(warmup_prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            _ = model.generate(**warmup_inputs, max_new_tokens=20, pad_token_id=tokenizer.eos_token_id)
        print("Warmup complete.")

        HAS_MODEL = True
    except Exception as e:
        import traceback
        error_str = traceback.format_exc()
        print(f"Error loading model: {e}")
        MODEL_ERROR = str(e)
else:
    print("ML packages not installed. Running in Mock Mode.")


def run_gemma(moves_sequence):
    if not HAS_ML or not HAS_MODEL:
        import time
        import random
        time.sleep(0.5)
        mock_counters = ["jab", "cross", "low_kick", "roundhouse", "uppercut", "parry", "backstep", "clinch", "throw"]
        return json.dumps({
            "reasoning": f"Mock Analysis: The player performed {moves_sequence}. {MODEL_ERROR if MODEL_ERROR else 'Running in offline mode.'}",
            "counterMove": random.choice(mock_counters),
            "sequence": moves_sequence
        })

    prompt = (
        f"<start_of_turn>user\n"
        f"You are an expert fighting game NPC AI. "
        f"The user has performed this sequence of 5 moves: {moves_sequence}.\n"
        f"Observe the pattern and decide on the best counter-move from: "
        f"jab, cross, low_kick, roundhouse, uppercut, parry, backstep, clinch, throw.\n"
        f"Respond in this format:\n"
        f"[Your reasoning about the player's pattern and tendencies]\n"
        f"counter_move: [your chosen counter move]"
        f"<end_of_turn>\n<start_of_turn>model\n"
    )

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=80,
            temperature=0.2,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id
        )

    text = tokenizer.decode(outputs[0][inputs["input_ids"].shape[-1]:], skip_special_tokens=True)

    reasoning = "Unable to process reasoning."
    counter_move = "jab"

    if "counter_move:" in text:
        parts = text.split("counter_move:")
        reasoning = parts[0].strip()
        counter_move = parts[1].strip()
    else:
        reasoning = text.strip()

    return json.dumps({"reasoning": reasoning, "counterMove": counter_move, "sequence": moves_sequence})


html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "3d_scene.html")
with open(html_path, "r", encoding="utf-8") as f:
    game_html = f.read()

app = FastAPI()


@app.get("/")
async def root():
    return HTMLResponse(content=game_html)


@app.get("/game")
async def serve_game_legacy():
    return RedirectResponse(url="/")


@app.get("/health")
async def health():
    """Health check so the game can wait until the model is loaded."""
    return JSONResponse(content={
        "ready": HAS_MODEL,
        "has_ml": HAS_ML,
        "error": MODEL_ERROR if not HAS_MODEL else "",
    })


@app.post("/predict")
async def predict(request: Request):
    """Direct inference endpoint used by the game.
    Falls back to a mock response if the model is not loaded.
    """
    try:
        data = await request.json()
    except Exception:
        data = {}
    sequence = data.get("sequence", "")
    result_str = run_gemma(sequence)
    try:
        result = json.loads(result_str)
    except Exception:
        result = {"reasoning": result_str, "counterMove": "jab", "sequence": sequence}
    return JSONResponse(content=result)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
