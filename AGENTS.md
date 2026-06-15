## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Repomix Codebase Strategy

Use Repomix to pack and search codebases efficiently, reducing token usage.

Rules:
- At session start, the token-compress plugin automatically caches a Repomix packed output.
- For searching code patterns, use grep which now searches the Repomix cache automatically.
- Only read full files when you need to edit them - use packed output for understanding structure.
- Reuse the existing packed output within session (cached for 1 hour).
- When editing, prefer minimal diffs/patches over rewriting whole files.

## Cyber Duel Tiny (Gemma-3-270M-IT advisor)

A drop-in replacement for the Gemma-3-4B-IT model currently serving `/predict`
in `app.py`. ~15× smaller, attribute-aware, trained with SFT → GRPO on Modal.

**Base**: `google/gemma-3-270m-it` (text-only, ~540 MB bf16, same Gemma family as the 4B, gated license but `HF_TOKEN` is already in the CLI env).

**RL approach**: GRPO with verifiable rewards from the Python port of the in-game combat resolver (no LLM teacher — all data is procedurally generated).

**Character attributes** injected into every prompt: speed, power, range, weight, stance, stamina, hp, distance bucket, round, and the player's last 5 moves.

### Key files
- `data/v2/resolver_py/` — Python port of `3d-game/src/combat/{moveData,stamina,combatResolver,aiArchetypes}.js` and `characterData.js` / `fighterConfigs.js`. Pure functions, no I/O.
- `data/v2/generate_data_v2.py` — Procedural dataset generator (24k rows, no LLM).
- `data/v2/sft_v2.jsonl` — Generated SFT/DPO dataset (51.7 MB, 8 of 9 moves covered).
- `train/common.py` — Shared helpers (HF token, LoRA, chat template, parse_counter).
- `train/rewards.py` — Verifiable GRPO reward function (parses prompt, rolls out resolver).
- `train/train_sft.py` — Stage 1 SFT bootstrap (TRL `SFTTrainer` + LoRA).
- `train/train_grpo.py` — Stage 2 GRPO (TRL `GRPOTrainer`).
- `train/train_dpo.py` — Stage 3 DPO polish (TRL `DPOTrainer`, optional).
- `modal/app.py` — Modal app with 4 functions: `prepare_volume`, `train_sft`, `train_grpo`, `train_dpo`, `evaluate`, plus `Model` class for serving.
- `hf_space/app.py` — FastAPI for the new `cyber-duel-tiny` HF Space.
- `hf_space/{requirements.txt,README.md,Dockerfile}` — Space boilerplate.
- `scripts/eval_h2h.py` — Local head-to-head evaluator.
- `scripts/publish_space.py` — Upload adapter + push new Space.
- `tests/test_parity.py` — 14 parity tests for the resolver port (all pass).
- `tests/smoke_test.py` — End-to-end smoke test (imports + functional).

### Modal run sequence (in order)
```bash
modal run modal/app.py::prepare_volume    # ~5 min, $0.20 — download base model
modal run modal/app.py::train_sft         # ~5 h, $4.00  — Stage 1 SFT
modal run modal/app.py::train_grpo        # ~12 h, $9.60 — Stage 2 GRPO
modal run modal/app.py::train_dpo         # ~2 h, $1.60  — Stage 3 DPO (optional)
modal run modal/app.py::evaluate          # ~8 h, $6.40  — head-to-head eval
python scripts/publish_space.py           # free — upload adapter + push new Space
```

### Local sanity checks
```bash
python tests/test_parity.py    # 14/14 resolver parity tests
python tests/smoke_test.py     # end-to-end import + functional
python data/v2/generate_data_v2.py --n 24000 --out data/v2/sft_v2.jsonl
```

### Cost cap
- Total Modal compute target: **≤ $50** (well under the $150 budget).
- Volume storage: ~5 GB → $0.45/mo.
