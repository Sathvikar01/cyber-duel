"""
Deploy to Hugging Face Spaces using the huggingface_hub Python API.
Uploads app.py, 3d_scene.html, requirements.txt, README.md, Dockerfile
Usage: python deploy_to_hf.py
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

from huggingface_hub import HfApi, create_repo, CommitOperationAdd

SPACE_NAME = "cyberpunk-duel-ai"
SDK        = "docker"

def get_token():
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if token:
        return token
    token_path = os.path.expanduser("~/.cache/huggingface/token")
    if os.path.exists(token_path):
        with open(token_path, "r") as f:
            t = f.read().strip()
            if t:
                return t
    return None

def main():
    token = get_token()
    if not token:
        print("ERROR: No HF token found. Run: huggingface-cli login")
        sys.exit(1)

    api = HfApi(token=token)
    user = api.whoami()["name"]
    repo_id = f"{user}/{SPACE_NAME}"

    print(f"Logged in as: {user}")
    print(f"Creating/reusing Space: {repo_id}")

    create_repo(
        repo_id=repo_id,
        repo_type="space",
        space_sdk=SDK,
        exist_ok=True,
        token=token,
        private=False,
    )
    print(f"Space ready: https://huggingface.co/spaces/{repo_id}")

    base_dir = os.path.dirname(os.path.abspath(__file__))
    files_to_upload = ["app.py", "3d_scene.html", "three.min.js", "requirements.txt", "README.md", "Dockerfile"]

    operations = []
    for filename in files_to_upload:
        local_path = os.path.join(base_dir, filename)
        if not os.path.exists(local_path):
            print(f"WARNING: {filename} not found, skipping.")
            continue
        print(f"Staging {filename}...")
        with open(local_path, "rb") as f:
            content = f.read()
        operations.append(
            CommitOperationAdd(path_in_repo=filename, path_or_fileobj=content)
        )

    print("Committing all files in one batch...")
    api.create_commit(
        repo_id=repo_id,
        repo_type="space",
        operations=operations,
        commit_message="Deploy: restore original 3d_scene.html game with Gemma AI",
        token=token,
    )

    print()
    print("=" * 60)
    print("Deployment complete!")
    print(f"Space: https://huggingface.co/spaces/{repo_id}")
    print()
    print("REMINDER: Ensure HF_TOKEN secret is set in Space settings:")
    print(f"  https://huggingface.co/spaces/{repo_id}/settings")
    print("=" * 60)

if __name__ == "__main__":
    main()
