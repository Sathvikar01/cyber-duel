import json
import random

VALID_PLAYER_MOVES = ["jab", "cross", "low_kick", "roundhouse", "uppercut"]
VALID_COUNTER_MOVES = ["jab", "cross", "low_kick", "roundhouse", "uppercut", "parry", "backstep", "clinch", "throw"]

def pick_move(pool=None):
    return random.choice(pool or VALID_PLAYER_MOVES)

def gen_aggressive_rushdown():
    seq = [pick_move(), pick_move(), pick_move(), pick_move(), pick_move()]
    reasoning = (
        f"The player is applying constant pressure with a flurry of strikes: {', '.join(seq)}. "
        "This relentless aggression leaves them vulnerable to a quick counter that interrupts their momentum."
    )
    counter = random.choice(["uppercut", "low_kick", "parry"])
    return seq, reasoning, counter

def gen_low_kick_spam():
    seq = ["low_kick", pick_move(["jab", "cross"]), "low_kick", pick_move(["jab", "cross"]), "low_kick"]
    reasoning = (
        "The player repeatedly returns to low_kick, telegraphing a predictable kick-heavy pattern. "
        "A fast interrupt or a retreat-and-punish response will exploit the recovery."
    )
    counter = random.choice(["uppercut", "backstep", "roundhouse"])
    return seq, reasoning, counter

def gen_poke_and_reset():
    seq = ["jab", "cross", "jab", "cross", "low_kick"]
    reasoning = (
        "The player uses quick punch pokes to create rhythm before finishing low. "
        "Closing the gap with a fast advancing grab or catching the rhythm break is the best answer."
    )
    counter = random.choice(["throw", "low_kick", "roundhouse"])
    return seq, reasoning, counter

def gen_high_low_mixup():
    seq = ["jab", "low_kick", "cross", "uppercut", "roundhouse"]
    reasoning = (
        "The player mixes high punches with low kicks and a rising uppercut, creating a high-low mixup. "
        "A defensive evade followed by a punishing counter will beat the commitment."
    )
    counter = random.choice(["backstep", "parry", "clinch"])
    return seq, reasoning, counter

def gen_reactive_counter():
    seq = ["jab", "cross", "jab", "cross", "low_kick"]
    reasoning = (
        "The player alternates jab and cross before finishing low, indicating a reactive counter-punch style. "
        "Breaking their rhythm with a grab or an unreactable low attack is ideal."
    )
    counter = random.choice(["throw", "low_kick", "clinch"])
    return seq, reasoning, counter

def gen_all_roundhouse():
    seq = ["roundhouse", "roundhouse", "roundhouse", "roundhouse", "roundhouse"]
    reasoning = (
        "The player is spamming roundhouse with no variation. Duck under or interrupt with a fast jab, then punish."
    )
    counter = random.choice(["jab", "uppercut", "backstep"])
    return seq, reasoning, counter

def gen_throw_bait():
    seq = ["jab", "jab", "cross", "cross", "low_kick"]
    reasoning = (
        "The player strings together close-range punches, aiming to condition blocking before a potential grab. "
        "Keep distance and answer with a long-range kick or backstep to make their offense whiff."
    )
    counter = random.choice(["backstep", "low_kick", "roundhouse"])
    return seq, reasoning, counter

generators = [
    gen_aggressive_rushdown,
    gen_low_kick_spam,
    gen_poke_and_reset,
    gen_high_low_mixup,
    gen_reactive_counter,
    gen_all_roundhouse,
    gen_throw_bait,
]

def main():
    data = []
    for _ in range(2000):
        gen_func = random.choice(generators)
        seq, reasoning, counter = gen_func()
        scenario = {
            "conversations": [
                {"role": "user", "content": ", ".join(seq)},
                {"role": "model", "content": f"{reasoning}\ncounter_move: {counter}"}
            ]
        }
        data.append(scenario)

    with open("combat_dataset.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"Generated {len(data)} clean scenarios with game-valid moves.")

if __name__ == "__main__":
    main()
