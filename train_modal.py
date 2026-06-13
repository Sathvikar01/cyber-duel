import modal
import os
import json

app = modal.App("gemma-3-combat-npc")

# Build the image with necessary ML libraries
image = modal.Image.debian_slim().pip_install(
    "transformers>=4.51.3",
    "peft>=0.14.0",
    "trl>=0.16.0",
    "torch>=2.4.0",
    "bitsandbytes>=0.45.5",
    "datasets>=3.4.1,<4.4.0",
    "accelerate>=0.34.1",
    "huggingface_hub",
    "rich",
    "tqdm"
)

def get_hf_token():
    # Attempt to read the token from ~/.cache/huggingface/token
    token_path = os.path.expanduser("~/.cache/huggingface/token")
    if os.path.exists(token_path):
        with open(token_path, "r") as f:
            return f.read().strip()
    return os.environ.get("HF_TOKEN")

@app.function(
    image=image, 
    gpu="A10G", # A10G is generally sufficient for 4B QLoRA
    timeout=3600,
    secrets=[
        # Attempt to pull HF_TOKEN from Modal secrets if configured, otherwise we pass it via args
    ]
)
def train_model(dataset_json, hf_token):
    import torch
    from datasets import Dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig, TrainingArguments
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTTrainer
    
    if not hf_token:
        raise ValueError("Hugging Face token is required. Ensure you are logged in using `huggingface-cli login` or HF_TOKEN is set.")

    print(f"Preparing dataset of {len(dataset_json)} scenarios...")
    dataset = Dataset.from_list(dataset_json)

    model_id = "google/gemma-3-4b-it"
    
    print(f"Loading tokenizer {model_id}...")
    tokenizer = AutoTokenizer.from_pretrained(model_id, token=hf_token)
    
    def format_chat(example):
        return {"text": tokenizer.apply_chat_template(example["conversations"], tokenize=False, add_generation_prompt=False)}

    print("Formatting conversations...")
    formatted_dataset = dataset.map(format_chat)

    print("Configuring 4-bit quantization...")
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16
    )

    print(f"Loading base model {model_id}...")
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        quantization_config=bnb_config,
        device_map="auto",
        token=hf_token
    )

    model = prepare_model_for_kbit_training(model)

    print("Applying LoRA config...")
    peft_config = LoraConfig(
        r=16,
        lora_alpha=32,
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    )

    model = get_peft_model(model, peft_config)

    # Calculate max steps (e.g. 3 epochs)
    # 2000 scenarios / 16 batch size (4 batch * 4 accumulation) = ~125 steps per epoch. 3 epochs = ~375 steps.
    max_steps = 375

    training_args = TrainingArguments(
        output_dir="./gemma-3-combat-lora",
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        logging_steps=10,
        max_steps=max_steps,
        save_steps=50,
        fp16=False,
        bf16=True, # Gemma works well with bfloat16
        optim="paged_adamw_32bit",
        report_to="none"
    )

    print("Initializing SFTTrainer...")
    trainer = SFTTrainer(
        model=model,
        train_dataset=formatted_dataset,
        args=training_args,
        processing_class=tokenizer,
        formatting_func=lambda x: x["text"],
    )

    print("Starting training...")
    trainer.train()

    print("Training complete! Pushing adapter to Hugging Face Hub...")
    try:
        model.push_to_hub("gemma-3-combat-npc-adapter", token=hf_token, private=False)
        tokenizer.push_to_hub("gemma-3-combat-npc-adapter", token=hf_token, private=False)
        print("Successfully pushed to Hub! You can now use your adapter in app.py")
    except Exception as e:
        print(f"Failed to push to hub: {e}")

@app.local_entrypoint()
def main():
    print("Loading local combat_dataset.json...")
    try:
        with open("combat_dataset.json", "r", encoding="utf-8") as f:
            local_data = json.load(f)
    except FileNotFoundError:
        print("Error: combat_dataset.json not found! Please wait for generate_data.py to finish.")
        return
        
    hf_token = get_hf_token()
    if not hf_token:
        print("Warning: Hugging Face token not found locally. Ensure you are logged in via huggingface-cli.")
        
    print(f"Submitting Modal training job with {len(local_data)} scenarios...")
    train_model.remote(local_data, hf_token)
