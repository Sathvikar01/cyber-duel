"""Common helpers shared by train_sft.py, train_grpo.py, and inference.

Centralises:
  - HF token lookup (env / ~/.cache/huggingface/token)
  - Model + tokenizer loading with optional LoRA adapter
  - Gemma-3 chat template formatting
  - LoRA config (matches your existing train_gemma_modal.py)
"""
from __future__ import annotations
import os
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

# Lazy imports — transformers / peft / trl are only required when actually
# training or serving. Keeps the resolver tests lightweight.

BASE_MODEL_DEFAULT = "google/gemma-3-270m-it"
GEMMA_TEMPLATE = "gemma-3"


def get_hf_token() -> Optional[str]:
    """Resolve HF token from env, then from the CLI cache."""
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if tok:
        return tok
    cache = Path.home() / ".cache" / "huggingface" / "token"
    if cache.exists():
        return cache.read_text(encoding="utf-8").strip() or None
    return None


def load_jsonl(path: str | Path) -> List[Dict[str, Any]]:
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


# ---------------------------------------------------------------------------
# Gemma-3 chat formatting
# ---------------------------------------------------------------------------

def format_prompt(system: str, user: str) -> str:
    """Return a plain string ready for `tokenizer.apply_chat_template` or
    for SFTrainer when response-only masking isn't used."""
    return (
        f"<start_of_turn>user\n{system}\n\n{user}<end_of_turn>\n"
        f"<start_of_turn>model\n"
    )


def format_full(system: str, user: str, assistant: str) -> str:
    return (
        f"<start_of_turn>user\n{system}\n\n{user}<end_of_turn>\n"
        f"<start_of_turn>model\n{assistant}<end_of_turn>\n"
    )


# ---------------------------------------------------------------------------
# LoRA / model helpers
# ---------------------------------------------------------------------------

def lora_config(r: int = 16, alpha: int = 32, dropout: float = 0.05):
    from peft import LoraConfig
    return LoraConfig(
        r=r, lora_alpha=alpha, lora_dropout=dropout, bias="none",
        task_type="CAUSAL_LM",
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
    )


def load_base(model_id: str, dtype: Any | None = None, device_map: str = "auto"):
    """Load a base causal LM + tokenizer. Strips vision_config if present."""
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, AutoConfig

    if dtype is None:
        dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    cfg = AutoConfig.from_pretrained(model_id, token=get_hf_token())
    if hasattr(cfg, "vision_config") and cfg.vision_config is not None:
        cfg.vision_config = None
    tok = AutoTokenizer.from_pretrained(model_id, token=get_hf_token())
    model = AutoModelForCausalLM.from_pretrained(
        model_id, config=cfg, token=get_hf_token(),
        torch_dtype=dtype, device_map=device_map,
    )
    return tok, model


def load_with_adapter(adapter_path: str, base_id: str | None = None, dtype: Any | None = None):
    """Load base + LoRA adapter, ready for inference."""
    import torch
    from peft import PeftModel
    base_id = base_id or BASE_MODEL_DEFAULT
    tok, base = load_base(base_id, dtype=dtype)
    model = PeftModel.from_pretrained(base, adapter_path, token=get_hf_token())
    model.eval()
    return tok, model


def parse_counter(text: str, legal: tuple = ("jab", "cross", "low_kick", "roundhouse",
                                              "uppercut", "parry", "backstep",
                                              "clinch", "throw")) -> str:
    """Extract the `counter_move: <move>` token from a model completion.

    Mirrors the parser at app.py:175-181. Falls back to 'jab' (the safest
    default) if no legal move is found."""
    text = text.lower()
    if "counter_move:" in text:
        tail = text.split("counter_move:", 1)[1].strip()
        first = tail.split()[0].strip(".,!?;:'\"")
        first = first.rstrip(",.;:?!")
        if first in legal:
            return first
    # Fallback: first legal move mentioned anywhere
    for m in legal:
        if m in text:
            return m
    return "jab"


def extract_reasoning(text: str) -> str:
    """Return the text leading up to the `counter_move:` line, trimmed."""
    if "counter_move:" in text:
        return text.split("counter_move:", 1)[0].strip()
    return text.strip()
