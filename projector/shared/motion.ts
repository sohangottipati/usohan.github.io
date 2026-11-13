// Named motion tokens: every animation on the wall and in the editor uses these.
// (Curves and timings from the charles-ux-animation skill: ease-out to appear,
// ease-in to leave, exits ~25% shorter than entrances, transform/opacity only.)

export const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)'; // appearing, responding
export const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)'; // leaving
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)'; // moving or resizing on screen

export const MOTION = {
  /** Scene change on the wall: a page-level transition. */
  sceneIn: 400,
  sceneOut: 300,
  /** "say …" messages and toasts. */
  messageIn: 240,
  messageOut: 170,
  messageRise: 16,
  /** Hover and color. */
  hover: 120,
};
