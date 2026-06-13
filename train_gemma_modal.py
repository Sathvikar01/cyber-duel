import modal
import os

volume = modal.Volume.from_name("gemma-adapter", create_if_missing=True)

image = modal.Image.debian_slim(python_version="3.11").apt_install("git").pip_install(
    "torch>=2.4.0",
    "transformers>=4.51.3",
    "datasets>=3.4.1,<4.4.0",
    "trl",
    "peft",
    "bitsandbytes>=0.45.5",
    "accelerate>=0.34.1",
    "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git",
).add_local_file("combat_dataset.json", remote_path="/root/combat_dataset.json")

app = modal.App("gemma-3-finetune", image=image)


@app.function(
    gpu="A10G",
    timeout=7200,
    secrets=[modal.Secret.from_name("huggingface-token")],
    volumes={"/models": volume},
)
def train():
    from unsloth import FastLanguageModel
    from unsloth.chat_templates import get_chat_template, train_on_responses_only
    from datasets import load_dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments

    model, tokenizer = FastLanguageModel.from_pretrained(
        "unsloth/gemma-3-4b-it-bnb-4bit",
        max_seq_length=512,
        load_in_4bit=True,
    )

    tokenizer = get_chat_template(tokenizer, chat_template="gemma-3")

    dataset = load_dataset("json", data_files="/root/combat_dataset.json", split="train")

    def format_chat(example):
        example["text"] = tokenizer.apply_chat_template(
            example["conversations"], tokenize=False
        )
        return example

    dataset = dataset.map(format_chat)

    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        lora_alpha=16,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            max_steps=100,
            warmup_steps=5,
            learning_rate=2e-4,
            fp16=False,
            bf16=True,
            logging_steps=1,
            output_dir="/models/adapter",
            optim="adamw_8bit",
            seed=3407,
            save_strategy="no",
        ),
    )

    trainer = train_on_responses_only(
        trainer,
        instruction_part="<start_of_turn>user\n",
        response_part="<start_of_turn>model\n",
    )

    trainer.train()

    model.save_pretrained("/models/adapter")
    tokenizer.save_pretrained("/models/adapter")
    volume.commit()

    print("Model saved to volume")

    # Upload the final adapter to the Hugging Face Hub as a public repo.
    hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if hf_token:
        from huggingface_hub import HfApi
        repo_id = "Sathvik0101/gemma-3-combat-npc-adapter"
        api = HfApi(token=hf_token)
        print(f"Uploading adapter to {repo_id} (public)...")
        api.create_repo(repo_id=repo_id, exist_ok=True, token=hf_token)
        api.upload_folder(
            repo_id=repo_id,
            folder_path="/models/adapter",
            path_in_repo=".",
            token=hf_token,
        )
        print("Adapter uploaded to Hub as a public model.")
    else:
        print("No HF_TOKEN found; skipping Hub upload.")


@app.local_entrypoint()
def main():
    train.remote()
