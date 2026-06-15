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

`POST /predict` — counter-move recommendation.

```http
POST /predict
Content-Type: application/json

{
  "sequence":      "jab,cross,low_kick,jab,cross",
  "player":        {"name": "monk", "speed": 5, "power": 2, "range": 3, "weight": 0.8, "stance": "low", "stamina": 100, "hp": 100},
  "npc":           {"name": "brute","speed": 1, "power": 5, "range": 2, "weight": 1.4, "stance": "hunched", "stamina": 100, "hp": 100},
  "round":         3,
  "distance":      "close",
  "playerId":      "ab12-...",          // optional, enables online RL
  "playerPrevMove": "jab"                // optional, back-fills the previous log row
}
```

```json
{
  "reasoning":    "The player is alternating jab and cross before finishing low...",
  "counterMove":  "throw",
  "sequence":     "jab,cross,low_kick,jab,cross",
  "adapterScope": "user"                  // "user" once you have a personalised adapter
}
```

`GET  /health`   — `{ready, has_token, online_rl_enabled, user_adapters_cached, buffered_users}`
`GET  /me?playerId=...`   — `{rounds_logged, next_retrain_in, cooldown_left_sec, adapter_scope, online_rl_enabled}`
`POST /forget`  body `{"playerId": "..."}` — deletes the user's adapter + log (privacy / GDPR).

### Online RL

If the request includes a `playerId` and the Space was started with the
`MODAL_WEBHOOK_URL` and `MODAL_WEBHOOK_SECRET` env vars set, the Space
will:

1. Log `(state, model_move, player_next_move)` to the
   `cyber-duel-tiny-logs` Hugging Face dataset (private).
2. After 25 fresh rows have been flushed, POST to the Modal webhook to
   trigger a per-user DPO retrain.
3. The new LoRA delta is uploaded to `cyber-duel-tiny-users/<uid>/` and
   loaded on the next `/predict` for that player.

The default base adapter (`Sathvik0101/cyber-duel-tiny-adapter`) is used
as the starting point for every per-user delta, and the global base
gets refreshed weekly by Modal's `retrain_global_base` job.

## Training

Trained on Modal with LoRA + DPO (verifiable rewards from the in-game
combat resolver). See `modal/app.py` in the [training repo](https://huggingface.co/Sathvik0101/cyber-duel-tiny-adapter).

## How to redeploy

1. Add `HF_TOKEN` as a Space Secret so the gated `gemma-3-270m-it` weights can be downloaded.
2. (Optional) Add `MODAL_WEBHOOK_URL` and `MODAL_WEBHOOK_SECRET` to enable
   online per-user RL.
3. Update `ADAPTER_MODEL` env var to point to the latest adapter release.
4. The Space will hot-reload on push (you may need a manual restart to
   pick up the new code if the env vars change).
