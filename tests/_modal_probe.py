"""Quick Modal probe: print the HF token Modal sees, and try the download."""
import os
import modal

app = modal.App("cyber-duel-probe")

@app.function(
    image=modal.Image.debian_slim().pip_install("huggingface_hub"),
    secrets=[modal.Secret.from_name("huggingface-token")],
    gpu="T4",
    timeout=600,
)
def probe():
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    print(f"HF_TOKEN present: {bool(tok)}, len={len(tok) if tok else 0}")
    print(f"Token prefix: {tok[:12] + '...' if tok else None}")
    from huggingface_hub import HfApi
    api = HfApi(token=tok)
    try:
        me = api.whoami()
        print(f"whoami OK: {me.get('name')}")
    except Exception as e:
        print(f"whoami failed: {e}")
    for repo in ["google/gemma-3-4b-it", "google/gemma-3-270m-it"]:
        try:
            info = api.model_info(repo)
            print(f"  {repo}: OK (gated={getattr(info, 'gated', '?')})")
        except Exception as e:
            print(f"  {repo}: {type(e).__name__}: {str(e)[:120]}")
    return "done"
