"""Check which Gemma repos the user's HF account can access."""
import os
from huggingface_hub import HfApi

tok_path = os.path.expanduser("~/.cache/huggingface/token")
tok = open(tok_path, encoding="utf-8").read().strip() if os.path.exists(tok_path) else None
print(f"Token loaded: {bool(tok)}  (len={len(tok) if tok else 0})")

api = HfApi(token=tok)
try:
    me = api.whoami()
    print(f"HF user: {me.get('name')}")
except Exception as e:
    print(f"whoami failed: {e}")
    raise SystemExit(1)

for repo in ["google/gemma-3-4b-it", "google/gemma-3-1b-it", "google/gemma-3-270m-it",
             "Qwen/Qwen3-1.7B", "HuggingFaceTB/SmolLM3-3B"]:
    try:
        info = api.model_info(repo, token=tok)
        gated = getattr(info, "gated", "?")
        print(f"  {repo:35s} ACCESS OK  (gated={gated})")
    except Exception as e:
        msg = str(e)[:100]
        print(f"  {repo:35s} {type(e).__name__}: {msg}")
