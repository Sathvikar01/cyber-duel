"""Cyber Duel — Python port of the in-game combat resolver.

Faithful translation of:
  3d-game/src/combat/moveData.js
  3d-game/src/combat/stamina.js
  3d-game/src/combat/combatResolver.js
  3d-game/src/combat/aiArchetypes.js
  3d-game/src/data/characterData.js
  3d-game/src/fighters/fighterConfigs.js

Pure functions, no I/O. Tested against the JS sources via tests/test_parity.py.
"""
from .move_data import (
    MOVE_DATA,
    PLAYER_MOVES,
    GEMMA_MOVES,
    HEAVY_MOVES,
    LIGHT_MOVES,
    GRAPPLE_MOVES,
    DEFENSIVE_MOVES,
    get_move_duration,
    is_heavy_move,
    describe_move,
)
from .stamina import (
    STAMINA_CONFIG,
    get_stamina_cost,
    regen_stamina,
    spend_stamina,
    can_use_move,
    is_fatigued,
    clamp_stamina,
)
from .resolver import (
    COMBAT_CONFIG,
    REACTIONS,
    get_combo_scale,
    is_counter_hit_vulnerable,
    pick_reaction,
    resolve_attack,
    resolve_block,
    resolve_parry,
    resolve_clinch,
    resolve_throw,
    resolve_gemma_move,
    get_reaction_duration,
)
from .archetypes import (
    AI_ARCHETYPES,
    resolve_archetype,
    get_difficulty_profile,
)
from .characters import (
    CHARACTER_LIST,
    FIGHTERS,
    FIGHTER_LIST,
    DEFAULT_CHARACTER,
    get_character_by_id,
    get_fighter_by_id,
)

__all__ = [
    "MOVE_DATA", "PLAYER_MOVES", "GEMMA_MOVES",
    "HEAVY_MOVES", "LIGHT_MOVES", "GRAPPLE_MOVES", "DEFENSIVE_MOVES",
    "get_move_duration", "is_heavy_move", "describe_move",
    "STAMINA_CONFIG", "get_stamina_cost", "regen_stamina", "spend_stamina",
    "can_use_move", "is_fatigued", "clamp_stamina",
    "COMBAT_CONFIG", "REACTIONS", "get_combo_scale",
    "is_counter_hit_vulnerable", "pick_reaction",
    "resolve_attack", "resolve_block", "resolve_parry",
    "resolve_clinch", "resolve_throw", "resolve_gemma_move",
    "get_reaction_duration",
    "AI_ARCHETYPES", "resolve_archetype", "get_difficulty_profile",
    "CHARACTER_LIST", "FIGHTERS", "FIGHTER_LIST",
    "DEFAULT_CHARACTER", "get_character_by_id", "get_fighter_by_id",
]
