"""Character/fighter definitions — mirror of characterData.js + fighterConfigs.js.

We keep only the fields the model needs at inference time: id, name, style,
stats (speed/power/range), and physics.weight (drives movement lerp speed).
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional

CHARACTER_LIST: List[Dict[str, Any]] = [
    {
        "id": "ronin", "name": "The Ronin", "style": "Balanced Striker",
        "stats": {"strength": 60, "speed": 60, "defense": 55, "shadow": 50},
        "physics": {"weight": 1.0}, "stance": "balanced",
    },
    {
        "id": "brute", "name": "The Pit Champion", "style": "Heavy Brawler",
        "stats": {"strength": 70, "speed": 45, "defense": 70, "shadow": 40},
        "physics": {"weight": 1.4}, "stance": "hunched",
    },
    {
        "id": "monk", "name": "The Iron Monk", "style": "Fast Striker",
        "stats": {"strength": 50, "speed": 85, "defense": 35, "shadow": 70},
        "physics": {"weight": 0.8}, "stance": "low",
    },
    {
        "id": "assassin", "name": "The Velvet Assassin", "style": "Agile Skirmisher",
        "stats": {"strength": 90, "speed": 35, "defense": 60, "shadow": 30},
        "physics": {"weight": 0.7}, "stance": "sideways",
    },
]

FIGHTERS: Dict[str, Dict[str, Any]] = {
    "ronin": {
        "id": "ronin", "name": "Ronin", "style": "balanced", "difficulty": "normal",
        "stats": {"speed": 3, "power": 3, "range": 3}, "physics": {"weight": 1.0},
        "stance": "balanced",
    },
    "brute": {
        "id": "brute", "name": "Brute", "style": "heavy", "difficulty": "easy",
        "stats": {"speed": 1, "power": 5, "range": 2}, "physics": {"weight": 1.4},
        "stance": "hunched",
    },
    "monk": {
        "id": "monk", "name": "Monk", "style": "fast", "difficulty": "hard",
        "stats": {"speed": 5, "power": 2, "range": 3}, "physics": {"weight": 0.8},
        "stance": "low",
    },
    "assassin": {
        "id": "assassin", "name": "Assassin", "style": "agile", "difficulty": "expert",
        "stats": {"speed": 4, "power": 2, "range": 4}, "physics": {"weight": 0.7},
        "stance": "sideways",
    },
}

FIGHTER_LIST: List[Dict[str, Any]] = list(FIGHTERS.values())
DEFAULT_CHARACTER: Dict[str, Any] = CHARACTER_LIST[0]


def get_character_by_id(char_id: str) -> Dict[str, Any]:
    for c in CHARACTER_LIST:
        if c["id"] == char_id:
            return c
    return DEFAULT_CHARACTER


def get_fighter_by_id(fighter_id: str) -> Optional[Dict[str, Any]]:
    return FIGHTERS.get(fighter_id)
