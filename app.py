import gradio as gr
import os
import base64
import json
import torch
try:
    import spaces
except ImportError:
    class MockSpaces:
        def GPU(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator
    spaces = MockSpaces()
try:
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
    HAS_ML = True
except ImportError:
    HAS_ML = False

# Configuration
BASE_MODEL = "google/gemma-3-4b-it"
ADAPTER_MODEL = "Sathvik0101/gemma-3-combat-npc-adapter"

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
        base_model = AutoModelForCausalLM.from_pretrained(
            BASE_MODEL, 
            token=hf_token, 
            torch_dtype=torch.bfloat16
        )
        
        print("Loading adapter via snapshot_download...")
        from huggingface_hub import snapshot_download
        adapter_path = snapshot_download(
            repo_id=ADAPTER_MODEL, 
            allow_patterns="checkpoint-375/*", 
            token=hf_token
        )
        local_adapter_dir = os.path.join(adapter_path, "checkpoint-375")
        model = PeftModel.from_pretrained(base_model, local_adapter_dir)
        HAS_MODEL = True
    except Exception as e:
        import traceback
        error_str = traceback.format_exc()
        print(f"Error loading model: {e}")
        MODEL_ERROR = str(e)
else:
    print("ML packages not installed. Running in Mock Mode.")

@spaces.GPU(duration=30)
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
            max_new_tokens=150,
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

# Read HTML path
html_path = os.path.join(os.path.dirname(__file__), "3d_scene.html")
# Ensure linux-style paths for Gradio /file= endpoint
html_url_path = html_path.replace("\\", "/")

iframe_html = (
    f'<iframe id="game-iframe" '
    f'src="/file={html_url_path}" '
    f'style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; border: none; z-index: 9999;">'
    f'</iframe>'
)

custom_css = """
body, html { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
.gradio-container { padding: 0 !important; margin: 0 !important; max-width: 100% !important; border: none !important; }
footer { display: none !important; }
"""

# The script links the iframe messages with Gradio hidden components
listener_script = """
<script>
window.addEventListener("message", function(e) {
    if (e.data && e.data.type === "AI_REQUEST") {
        const input_box = document.querySelector("#hidden_input textarea, #hidden_input input");
        if (input_box) {
            input_box.value = e.data.sequence;
            input_box.dispatchEvent(new Event('input', { bubbles: true }));
            
            setTimeout(() => {
                const btn = document.querySelector("#hidden_btn button");
                if (btn) {
                    btn.click();
                } else {
                    const wrapper = document.querySelector("#hidden_btn");
                    if (wrapper) wrapper.click();
                }
            }, 100);
        } else {
            console.error("[Bridge] Hidden input not found");
        }
    }
});

function handleAIResponse(responseStr) {
    if (!responseStr) return;
    try {
        const data = JSON.parse(responseStr);
        const iframe = document.getElementById("game-iframe");
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: 'AI_RESPONSE',
                sequence: data.sequence,
                reasoning: data.reasoning,
                counterMove: data.counterMove
            }, '*');
        }
    } catch(err) {
        console.error("[Bridge] Error parsing response", err);
    }
}
</script>
"""

with gr.Blocks(css=custom_css, head=listener_script) as demo:
    gr.HTML(iframe_html)
    
    # Hidden components for bridging iframe -> Gradio -> ZeroGPU
    with gr.Row(visible=False):
        hidden_input = gr.Textbox(elem_id="hidden_input")
        hidden_output = gr.Textbox(elem_id="hidden_output")
        hidden_btn = gr.Button(elem_id="hidden_btn")
        
        hidden_btn.click(
            fn=run_gemma,
            inputs=hidden_input,
            outputs=hidden_output
        )
        
        hidden_output.change(
            fn=None,
            inputs=[hidden_output],
            js="(val) => { handleAIResponse(val); return val; }"
        )

if __name__ == "__main__":
    demo.launch(
        server_name="0.0.0.0", 
        server_port=int(os.environ.get("PORT", 7860)), 
        allowed_paths=[os.path.dirname(__file__)],
        ssr=False
    )
