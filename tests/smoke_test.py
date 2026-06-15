"""End-to-end smoke test of all modules."""
import sys
sys.path.insert(0, '.')

# 1. Resolver
from data.v2.resolver_py import (
    MOVE_DATA, resolve_attack, resolve_parry, resolve_clinch,
    resolve_throw, get_stamina_cost, FIGHTERS, CHARACTER_LIST,
    get_difficulty_profile,
)
print('resolver_py: OK')

# 2. Data generator
from data.v2.generate_data_v2 import (
    generate_dataset, score_counter, build_user_prompt,
    build_assistant_turn, State, sample_state, LEGAL_COUNTERS,
)
print('generate_data_v2: OK')

# 3. Training common
from train.common import (
    BASE_MODEL_DEFAULT, get_hf_token, load_jsonl, format_prompt,
    format_full, lora_config, parse_counter, extract_reasoning,
)
print('train.common: OK')

# 4. Rewards
from train.rewards import compute_reward, _parse_prompt
print('train.rewards: OK')

# Quick functional tests
import random
rng = random.Random(0)
state = sample_state(rng)
print(f'sample_state OK: player={state.player_char_id} npc={state.npc_char_id} dist={state.distance_bucket}')
print(f'  last5={state.last5} pattern={state.pattern}')

prompt = build_user_prompt(state)
parsed = _parse_prompt(prompt)
assert parsed is not None and 'last5' in parsed, 'prompt parse failed'
print(f'prompt parser: OK (player_speed={parsed["player_speed"]} last5={parsed["last5"]})')

for c in LEGAL_COUNTERS:
    s = score_counter(state, c)
print('score_counter: OK (all 9 moves scored)')

chosen = build_assistant_turn(state, 'parry')
assert 'counter_move: parry' in chosen
print('build_assistant_turn: OK')

reward = compute_reward('parry', format_prompt('SYSTEM', prompt))
print(f'compute_reward: OK (reward={reward:+.3f})')

parsed_move = parse_counter('reasoning here\ncounter_move: cross')
assert parsed_move == 'cross', parsed_move
print('parse_counter: OK')

# Token check
tok = get_hf_token()
print(f'get_hf_token: {"OK (token present)" if tok else "no token in env (expected on local dev)"}')

print()
print('=== ALL IMPORTS + FUNCTIONAL TESTS PASS ===')
