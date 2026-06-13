import os
import json
import re
import time
from openai import OpenAI

client = OpenAI(
    base_url="https://api.groq.com/openai/v1",
    api_key=os.environ["GROQ_API_KEY"],
)

MODEL = "llama-3.3-70b-versatile"
TOTAL_SCENARIOS = 1000
BATCH_SIZE = 15
MAX_BATCHES = 150
OUTPUT_FILE = "combat_dataset.json"

SYSTEM_PROMPT = """You are an expert fighting game AI designer. Your task is to generate diverse combat scenarios for training an NPC AI system.

Each scenario represents a moment in a fight where you observe the player's last 5 moves and must decide the best counter-move.

Available move types (use a wide variety across scenarios):
- punch (jab, cross, uppercut, hook)
- kick (low_kick, roundhouse, side_kick, axe_kick, spinning_kick)
- block (high_block, low_block, parry)
- dodge (sidestep, backstep, duck, roll)
- grab (throw, clinch, sweep)
- special_attack (fireball, dragon_punch, spinning_fist, charge_attack)
- jump (jump, jump_kick, aerial_attack, divekick)
- crouch (crouch, crouch_punch, crouch_kick, leg_sweep)
- stance (aggressive_stance, defensive_stance, feint, taunt)
- movement (dash_forward, dash_backward, circle_left, circle_right)

For each scenario, produce a JSON object in this exact format:
{
  "conversations": [
    {"role": "user", "content": "<a comma-separated list of exactly 5 fighting moves the player performed>"},
    {"role": "model", "content": "<Your reasoning about the player's pattern and tendencies, followed by: counter_move: <your chosen counter move>>"}
  ]
}

Guidelines for extreme diversity:
- Vary the player's fighting style dramatically: aggressive rushdown, defensive turtle, mixup-heavy, grappler, zoner, evasive/hit-and-run, erratic spammer.
- Ensure the model's reasoning is deeply analytical, identifying habits, traps, and distance management.
- NEVER repeat the exact same sequence of 5 moves across scenarios. Make each sequence distinct.
- Include scenarios with predictable patterns (e.g., spamming fireballs) AND unpredictable mixups (e.g., feint into grab).
- Mix different skill levels (novice spam patterns vs expert feint sequences).
- Your counter_move must logically exploit the opening described in the reasoning.

Return ONLY a valid JSON array of scenario objects. No extra text, no markdown fences."""


def extract_json_array(text):
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1)
    else:
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            text = match.group(0)
    return json.loads(text)


def validate_scenario(scenario):
    if not isinstance(scenario, dict):
        return False
    convos = scenario.get("conversations")
    if not isinstance(convos, list) or len(convos) < 2:
        return False
    user_turn = convos[0]
    model_turn = convos[1]
    if user_turn.get("role") != "user" or model_turn.get("role") != "model":
        return False
    if not isinstance(user_turn.get("content"), str) or not isinstance(model_turn.get("content"), str):
        return False
    moves = [m.strip() for m in user_turn["content"].split(",")]
    if len(moves) != 5:
        return False
    if "counter_move" not in model_turn["content"].lower():
        return False
    return True


def generate_batch(batch_num, batch_size):
    user_prompt = (
        f"Generate exactly {batch_size} unique and diverse combat scenarios as a JSON array. "
        f"This is batch {batch_num} — make sure these scenarios are different from typical patterns. "
        f"Focus on variety in move types, player styles, and counter-strategies. "
        f"Return ONLY the JSON array."
    )

    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=1.0,
        max_tokens=4096,
    )

    raw = response.choices[0].message.content
    scenarios = extract_json_array(raw)
    valid = [s for s in scenarios if validate_scenario(s)]
    return valid


def main():
    all_scenarios = []
    batch_num = 0

    while len(all_scenarios) < TOTAL_SCENARIOS:
        if batch_num >= MAX_BATCHES:
            print(f"Warning: reached MAX_BATCHES ({MAX_BATCHES}) with only {len(all_scenarios)}/{TOTAL_SCENARIOS} scenarios. Stopping.")
            break
        batch_num += 1
        remaining = TOTAL_SCENARIOS - len(all_scenarios)
        current_batch_size = min(BATCH_SIZE, remaining)

        print(f"Batch {batch_num}: requesting {current_batch_size} scenarios "
              f"(have {len(all_scenarios)}/{TOTAL_SCENARIOS})...")

        try:
            batch = generate_batch(batch_num, current_batch_size)
            all_scenarios.extend(batch)
            print(f"  -> Got {len(batch)} valid scenarios")
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            print(f"  -> Batch {batch_num} failed to parse: {e}. Retrying...")
        except Exception as e:
            print(f"  -> Batch {batch_num} error: {e}. Waiting before retry...")
            time.sleep(5)

        if batch_num > 1:
            time.sleep(1)

    all_scenarios = all_scenarios[:TOTAL_SCENARIOS]

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(all_scenarios, f, indent=2, ensure_ascii=False)

    print(f"\nDone! Saved {len(all_scenarios)} scenarios to {OUTPUT_FILE}")

    move_types = set()
    for s in all_scenarios:
        content = s["conversations"][0]["content"].lower()
        for move in content.split(","):
            move_types.add(move.strip())

    print(f"Unique move expressions found: {len(move_types)}")


if __name__ == "__main__":
    main()
