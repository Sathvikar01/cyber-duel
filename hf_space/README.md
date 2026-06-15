---
title: Cyber Duel Tiny
emoji: ⚡
colorFrom: yellow
colorTo: red
sdk: docker
hardware: cpu-basic
python_version: "3.11"
pinned: false
---

# Cyber Duel Tiny

A 270M-parameter combat advisor that replaces the Gemma 3 4B base model
in [Duel of Albion](https://huggingface.co/spaces/Sathvik0101/cyberpunk-duel-ai).

## What it does

Given the player's last 5 moves, the model recommends a counter-move from
the 9 legal options (jab, cross, low_kick, roundhouse, uppercut, parry,
backstep, clinch, throw), conditioned on both fighters' stats
(speed, power, range, weight, stance), stamina, distance, and round.

## API

`POST /predict` — same contract as the main Space.

```http
POST /predict
Content-Type: application/json

{"sequence": "jab,cross,low_kick,jab,cross"}
```

```json
{
  "reasoning": "The player is alternating jab and cross before finishing low...",
  "counterMove": "throw",
  "sequence": "jab,cross,low_kick,jab,cross"
}
```

## Training

Trained on Modal with LoRA + GRPO (verifiable rewards from the in-game
combat resolver). See `modal/app.py` in the [training repo](https://huggingface.co/Sathvik0101/cyber-duel-tiny-adapter).

## How to redeploy

1. Add `HF_TOKEN` as a Space Secret so the gated `gemma-3-270m-it` weights can be downloaded.
2. Update `ADAPTER_MODEL` env var to point to the latest adapter release.
3. The Space will hot-reload on push.
