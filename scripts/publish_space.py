"""Publish the trained adapter and the new HF Space.

Usage:
  python scripts/publish_space.py
  python scripts/publish_space.py --space-name my-tiny-space
  python scripts/publish_space.py --adapter-only
"""
from __future__ import annotations
import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def get_token() -> str | None:
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if tok:
        return tok
    cache = Path.home() / ".cache" / "huggingface" / "token"
    if cache.exists():
        return cache.read_text(encoding="utf-8").strip() or None
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--space-name", default="cyber-duel-tiny")
    ap.add_argument("--adapter-name", default="cyber-duel-tiny-adapter")
    ap.add_argument("--adapter", default="checkpoints/grpo",
                    help="Local path to the trained LoRA adapter")
    ap.add_argument("--adapter-only", action="store_true",
                    help="Only upload the adapter; skip the Space")
    ap.add_argument("--space-only", action="store_true",
                    help="Only push the Space; skip the adapter")
    args = ap.parse_args()

    token = get_token()
    if not token:
        print("ERROR: HF_TOKEN not set. Run `huggingface-cli login` or set HF_TOKEN.")
        sys.exit(1)

    from huggingface_hub import HfApi, create_repo, upload_folder, whoami
    api = HfApi(token=token)
    user = whoami(token=token)["name"]
    print(f"Logged in as: {user}")

    adapter_repo = f"{user}/{args.adapter_name}"
    space_repo = f"{user}/{args.space_name}"

    # ----- Upload adapter -----
    if not args.space_only:
        adapter_path = Path(args.adapter)
        if not adapter_path.exists():
            print(f"ERROR: adapter path does not exist: {adapter_path}")
            sys.exit(1)
        create_repo(repo_id=adapter_repo, repo_type="model", exist_ok=True, token=token)
        print(f"Uploading adapter from {adapter_path} to {adapter_repo}...")
        upload_folder(
            folder_path=str(adapter_path),
            repo_id=adapter_repo,
            repo_type="model",
            token=token,
            commit_message="Upload cyber-duel-tiny LoRA adapter",
        )
        print(f"Adapter: https://huggingface.co/{adapter_repo}")

    # ----- Push Space -----
    if not args.adapter_only:
        create_repo(
            repo_id=space_repo, repo_type="space", space_sdk="docker",
            exist_ok=True, token=token,
        )
        space_path = ROOT / "hf_space"
        print(f"Uploading Space from {space_path} to {space_repo}...")
        upload_folder(
            folder_path=str(space_path),
            repo_id=space_repo,
            repo_type="space",
            token=token,
            commit_message="Deploy cyber-duel-tiny",
        )
        print(f"Space: https://huggingface.co/spaces/{space_repo}")
        print("\nNext steps:")
        print(f"  1. Open https://huggingface.co/spaces/{space_repo}/settings")
        print(f"  2. Add HF_TOKEN as a Secret (gated 270M weights)")
        print(f"  3. Set ADAPTER_MODEL env var to '{adapter_repo}'")


if __name__ == "__main__":
    main()
