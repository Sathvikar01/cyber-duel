---
title: Cyberpunk Duel AI
emoji: ⚔️
colorFrom: purple
colorTo: blue
sdk: docker
hardware: nvidia-a10g-small
python_version: 3.11
pinned: false
---

# Cyberpunk Duel AI

A 3D AI-powered cyberpunk fighting game built with FastAPI.
The AI opponent uses a fine-tuned Gemma 3 model to counter your moves in real time.

## Setup
Add your `HF_TOKEN` as a Secret in Space settings so the gated base model (`google/gemma-3-4b-it`) can be downloaded.
The fine-tuned adapter is public at https://huggingface.co/Sathvik0101/gemma-3-combat-npc-adapter, but the base Gemma weights still require a token.
