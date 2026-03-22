/**
 * Wind barb icon mapping for Deck.gl IconLayer.
 *
 * Wind barb convention:
 * - Half barb = 5 kt
 * - Full barb = 10 kt
 * - Pennant (triangle) = 50 kt
 * - Calm = circle
 *
 * Icons point NORTH (up). Deck.gl getAngle rotates them to the
 * wind direction (direction FROM which wind blows).
 *
 * Southern hemisphere: barbs are mirrored (drawn on right side of staff).
 */

export interface WindBarbMapping {
  [key: string]: { x: number; y: number; width: number; height: number; anchorY: number };
}

const ICON_SIZE = 64;
const COLS = 10;

/**
 * Get the icon key for a given wind speed in knots.
 * Rounds to nearest 5 kt.
 */
export function getWindBarbKey(speedKt: number): string {
  if (speedKt < 2.5) return 'calm';
  const rounded = Math.round(speedKt / 5) * 5;
  const clamped = Math.min(rounded, 200);
  return `wb_${clamped}`;
}

/**
 * Generate the icon mapping for the wind barb sprite atlas.
 * Atlas layout: 10 columns, rows of 64x64 icons.
 * Index 0 = calm, then 5, 10, 15, ..., 200 (41 icons total).
 */
export function generateWindBarbMapping(): WindBarbMapping {
  const mapping: WindBarbMapping = {};

  // calm is index 0
  mapping['calm'] = {
    x: 0,
    y: 0,
    width: ICON_SIZE,
    height: ICON_SIZE,
    anchorY: ICON_SIZE / 2,
  };

  // 5 kt through 200 kt
  for (let speed = 5; speed <= 200; speed += 5) {
    const index = speed / 5; // 1-based
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    mapping[`wb_${speed}`] = {
      x: col * ICON_SIZE,
      y: row * ICON_SIZE,
      width: ICON_SIZE,
      height: ICON_SIZE,
      anchorY: ICON_SIZE / 2,
    };
  }

  return mapping;
}

/**
 * Generate a wind barb as an SVG string for a given speed.
 * The barb points upward (north). Staff at center-bottom, barbs on left.
 */
export function generateWindBarbSVG(speedKt: number, mirror: boolean = false): string {
  const size = ICON_SIZE;
  const cx = size / 2;
  const staffTop = 8;
  const staffBottom = size - 8;
  const barbLength = 16;

  if (speedKt < 2.5) {
    // Calm: circle
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${size / 2}" r="4" fill="none" stroke="#1a5fad" stroke-width="2"/>
    </svg>`;
  }

  const paths: string[] = [];
  // Staff line
  paths.push(`<line x1="${cx}" y1="${staffTop}" x2="${cx}" y2="${staffBottom}" stroke="#1a5fad" stroke-width="2" stroke-linecap="round"/>`);

  let remaining = Math.round(speedKt / 5) * 5;
  let y = staffBottom; // Start from bottom of staff (tail end — barbs fly downwind)
  const side = mirror ? 1 : -1; // -1 = left (NH), 1 = right (SH)
  const spacing = 6;

  // Pennants (50 kt)
  while (remaining >= 50) {
    const x1 = cx;
    const x2 = cx + side * barbLength;
    paths.push(`<polygon points="${x1},${y} ${x2},${y - spacing / 2} ${x1},${y - spacing}" fill="#1a5fad" stroke="#1a5fad" stroke-width="1"/>`);
    y -= spacing + 2;
    remaining -= 50;
  }

  // Full barbs (10 kt)
  while (remaining >= 10) {
    const x2 = cx + side * barbLength;
    paths.push(`<line x1="${cx}" y1="${y}" x2="${x2}" y2="${y + 4}" stroke="#1a5fad" stroke-width="2" stroke-linecap="round"/>`);
    y -= spacing;
    remaining -= 10;
  }

  // Half barb (5 kt)
  if (remaining >= 5) {
    const x2 = cx + side * (barbLength * 0.6);
    paths.push(`<line x1="${cx}" y1="${y}" x2="${x2}" y2="${y + 3}" stroke="#1a5fad" stroke-width="2" stroke-linecap="round"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${paths.join('')}</svg>`;
}
