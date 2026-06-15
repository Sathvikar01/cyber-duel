/**
 * Keyboard input mapping for the 2.5D fighter.
 *
 * The mapping is intentionally separate from the game loop so that controls
 * can be remapped, tested, or queried without touching Game.jsx.
 */

export const ACTIONS = Object.freeze({
  MOVE_LEFT: 'moveLeft',
  MOVE_RIGHT: 'moveRight',
  MOVE_UP: 'moveUp',
  MOVE_DOWN: 'moveDown',
  JAB: 'jab',
  CROSS: 'cross',
  LOW_KICK: 'lowKick',
  ROUNDHOUSE: 'roundhouse',
  UPPERCUT: 'uppercut',
  BLOCK: 'block',
  BACKSTEP: 'backstep',
  PAUSE: 'pause',
});

export const PLAYER_MOVES = Object.freeze([
  ACTIONS.JAB,
  ACTIONS.CROSS,
  ACTIONS.LOW_KICK,
  ACTIONS.ROUNDHOUSE,
  ACTIONS.UPPERCUT,
]);

/**
 * Default key -> action mapping.
 *
 * Movement: WASD or Arrow keys.
 * Attacks:  J jab, L cross, K low_kick, U uppercut, I roundhouse.
 * Defense:  Space / Shift hold to block, Q to backstep.
 * System:   Escape to pause.
 */
export const KEY_MAP = Object.freeze({
  a: ACTIONS.MOVE_LEFT,
  arrowleft: ACTIONS.MOVE_LEFT,
  d: ACTIONS.MOVE_RIGHT,
  arrowright: ACTIONS.MOVE_RIGHT,
  w: ACTIONS.MOVE_UP,
  arrowup: ACTIONS.MOVE_UP,
  s: ACTIONS.MOVE_DOWN,
  arrowdown: ACTIONS.MOVE_DOWN,

  j: ACTIONS.JAB,
  l: ACTIONS.CROSS,
  k: ACTIONS.LOW_KICK,
  u: ACTIONS.UPPERCUT,
  i: ACTIONS.ROUNDHOUSE,

  ' ': ACTIONS.BLOCK,
  shift: ACTIONS.BLOCK,

  q: ACTIONS.BACKSTEP,

  escape: ACTIONS.PAUSE,
});

/**
 * Keys that should have their default browser behaviour prevented during gameplay.
 */
export const PREVENT_DEFAULT_KEYS = Object.freeze(new Set([
  'w', 'a', 's', 'd',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'j', 'k', 'l', 'u', 'i',
  ' ', 'shift', 'q', 'escape',
]));

/**
 * Convert a raw KeyboardEvent.key value to a lower-case key id.
 *
 * @param {string} key
 * @returns {string}
 */
export function normalizeKey(key) {
  return (key || '').toLowerCase();
}

/**
 * Get the action associated with a key, if any.
 *
 * @param {string} key raw or normalized key
 * @param {object} [map]
 * @returns {string|null}
 */
export function getActionForKey(key, map = KEY_MAP) {
  return map[normalizeKey(key)] || null;
}

/**
 * Check whether a browser default should be suppressed for a key.
 *
 * @param {string} key
 * @returns {boolean}
 */
export function shouldPreventDefault(key) {
  return PREVENT_DEFAULT_KEYS.has(normalizeKey(key));
}

/**
 * Build an empty input state object.
 *
 * @returns {object}
 */
export function createInputState() {
  return {
    moveLeft: false,
    moveRight: false,
    moveUp: false,
    moveDown: false,
    jab: false,
    cross: false,
    lowKick: false,
    roundhouse: false,
    uppercut: false,
    block: false,
    backstep: false,
    pause: false,
  };
}

/**
 * Update input state from a keydown/keyup event.
 *
 * @param {object} state current input state (mutated)
 * @param {string} key raw key value
 * @param {boolean} pressed true for keydown, false for keyup
 * @returns {object} mutated state
 */
export function updateInputState(state, key, pressed) {
  const action = getActionForKey(key);
  if (action) {
    state[action] = pressed;
  }
  return state;
}

/**
 * Determine the intended 2D movement vector from input state.
 *
 * @param {object} state
 * @returns {{ x: number, z: number }} normalized vector (zero if no input)
 */
export function getMovementVector(state) {
  let x = 0;
  let z = 0;

  if (state.moveLeft) x -= 1;
  if (state.moveRight) x += 1;
  if (state.moveUp) z -= 1;
  if (state.moveDown) z += 1;

  const len = Math.sqrt(x * x + z * z);
  if (len === 0) return { x: 0, z: 0 };

  return { x: x / len, z: z / len };
}

/**
 * If an attack button is newly pressed, return the canonical player move name.
 *
 * @param {object} state current input state
 * @param {object} prev previous input state
 * @returns {string|null}
 */
export function getAttackInput(state, prev) {
  if (state.jab && !prev.jab) return 'jab';
  if (state.cross && !prev.cross) return 'cross';
  if (state.lowKick && !prev.lowKick) return 'low_kick';
  if (state.roundhouse && !prev.roundhouse) return 'roundhouse';
  if (state.uppercut && !prev.uppercut) return 'uppercut';
  return null;
}

/**
 * Return true if the player just started holding block this frame.
 */
export function blockStarted(state, prev) {
  return state.block && !prev.block;
}

/**
 * Return true if the player just released block this frame.
 */
export function blockEnded(state, prev) {
  return !state.block && prev.block;
}

/**
 * Return true if backstep was just pressed.
 */
export function backstepStarted(state, prev) {
  return state.backstep && !prev.backstep;
}

/**
 * Return true if pause was just pressed.
 */
export function pauseStarted(state, prev) {
  return state.pause && !prev.pause;
}

/**
 * Convert action id back to a friendly display label.
 */
export function getActionLabel(action) {
  switch (action) {
    case ACTIONS.MOVE_LEFT: return 'Move Left';
    case ACTIONS.MOVE_RIGHT: return 'Move Right';
    case ACTIONS.MOVE_UP: return 'Move Up';
    case ACTIONS.MOVE_DOWN: return 'Move Down';
    case ACTIONS.JAB: return 'Jab';
    case ACTIONS.CROSS: return 'Cross';
    case ACTIONS.LOW_KICK: return 'Low Kick';
    case ACTIONS.ROUNDHOUSE: return 'Roundhouse';
    case ACTIONS.UPPERCUT: return 'Uppercut';
    case ACTIONS.BLOCK: return 'Block';
    case ACTIONS.BACKSTEP: return 'Backstep';
    case ACTIONS.PAUSE: return 'Pause';
    default: return action;
  }
}
