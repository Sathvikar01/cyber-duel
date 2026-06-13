import modal
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

volume = modal.Volume.from_name("gemma-adapter")

image = modal.Image.debian_slim(python_version="3.11").apt_install("git").pip_install(
    "torch>=2.4.0",
    "transformers>=4.51.3",
    "peft",
    "bitsandbytes>=0.45.5",
    "accelerate>=0.34.1",
    "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git",
    "fastapi[standard]"
)

app = modal.App("gemma-3-test", image=image)

web_app = FastAPI()

web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.cls(gpu="A10G", timeout=600, volumes={"/models": volume})
class Model:
    @modal.enter()
    def load(self):
        from unsloth import FastLanguageModel
        from unsloth.chat_templates import get_chat_template

        print("Loading model from volume...")
        self.model, self.tokenizer = FastLanguageModel.from_pretrained(
            "/models/adapter",
            max_seq_length=512,
            load_in_4bit=True,
        )
        FastLanguageModel.for_inference(self.model)
        self.tokenizer = get_chat_template(self.tokenizer, chat_template="gemma-3")

    @modal.method()
    def infer(self, test_moves: str):
        prompt = f"<start_of_turn>user\n{test_moves}<end_of_turn>\n<start_of_turn>model\n"
        inputs = self.tokenizer(prompt, return_tensors="pt")
        input_ids = inputs["input_ids"].to("cuda")

        outputs = self.model.generate(input_ids=input_ids, max_new_tokens=200, use_cache=True)
        response = self.tokenizer.batch_decode(outputs)[0]
        
        try:
            response_part = response.split("<start_of_turn>model\n")[1].replace("<eos>", "").strip()
            return response_part
        except IndexError:
            return response

@web_app.post("/infer")
async def infer_endpoint(request: Request):
    data = await request.json()
    moves = data.get("moves", "")
    model_cls = Model()
    return {"response": model_cls.infer.remote(moves)}

@app.function()
@modal.asgi_app()
def fastapi_app():
    return web_app

@app.local_entrypoint()
def main():
    print("Run `modal deploy test_model.py` to deploy the web endpoint.")
