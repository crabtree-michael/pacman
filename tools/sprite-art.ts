import {
  circle,
  color,
  ellipse,
  intersect,
  mirrorX,
  polygon,
  rect,
  sector,
  stroke,
  subtract,
  union,
  type Paint,
  type Raster,
  type Shape,
} from './raster.ts';

/**
 * The art itself: every frame in the sprite atlas, as shapes in tile units.
 *
 * Original art, not the arcade's ROM sprites — product spec open question 5
 * asks for exactly that. The shapes follow the arcade's silhouettes closely
 * enough that the game reads as Pac-Man, and the proportions match what the
 * placeholder renderer already drew, so nothing about the game's feel moves
 * when the atlas replaces it.
 *
 * Definitions are declarative on purpose: a frame is a list of (shape, colour)
 * layers, so re-skinning is an edit here and a rebuild, with no renderer change.
 */

/** Every character frame is a 2x2-tile box with the actor at its centre. */
export const SPRITE_TILES = 2;

/** The arcade's base tile is 8 art pixels; the atlas stores 4x that (§5.1). */
export const ATLAS_TILE_PX = 32;

/** One art pixel of the 5x7 bitmap font, in tile units. */
const GLYPH_PIXEL = 1 / 8;
const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;

const YELLOW = color('#ffcc00');
const EYE_WHITE = color('#ffffff');
const PUPIL = color('#2121ff');
const FRIGHT_BODY = color('#2121ff');
const FRIGHT_FLASH_BODY = color('#f8f8f8');
const FRIGHT_FACE = color('#ffffff');
const FRIGHT_FLASH_FACE = color('#ff0000');
const GLYPH_COLOR = color('#ffffff');

const GHOST_COLORS: Readonly<Record<string, string>> = {
  blinky: '#ff0000',
  pinky: '#ffb8ff',
  inky: '#00ffff',
  clyde: '#ffb852',
};

/** Directions, in the order the renderer names them. */
const DIRECTIONS = ['right', 'down', 'left', 'up'] as const;
type DirectionName = (typeof DIRECTIONS)[number];

/** Canvas angle each direction faces — 0 is +x and y grows downward. */
const FACING: Readonly<Record<DirectionName, number>> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
};

/** Unit vector each direction looks along, for the eyes. */
const LOOK: Readonly<Record<DirectionName, { x: number; y: number }>> = {
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  up: { x: 0, y: -1 },
};

/** Actor radius in tile units — the placeholder renderer's, kept exactly. */
const R = 0.75;

export interface Layer {
  shape: Shape;
  paint: Paint;
}

export interface FrameDef {
  name: string;
  /** Frame size in tile units. */
  width: number;
  height: number;
  /** The point the renderer positions the frame by, in tile units from its top-left. */
  pivotX: number;
  pivotY: number;
  layers: readonly Layer[];
}

function actorFrame(name: string, layers: readonly Layer[]): FrameDef {
  return {
    name,
    width: SPRITE_TILES,
    height: SPRITE_TILES,
    pivotX: SPRITE_TILES / 2,
    pivotY: SPRITE_TILES / 2,
    layers,
  };
}

// Pac-Man --------------------------------------------------------------

/** Three chomp phases, as fractions of a half-turn of mouth. */
const CHOMP_OPENINGS = [0, 0.16, 0.32] as const;

function pacman(facing: number, opening: number): Layer[] {
  const body = circle(0, 0, R);
  if (opening <= 0) return [{ shape: body, paint: YELLOW }];
  const half = opening * Math.PI;
  return [
    { shape: subtract(body, sector(0, 0, R, facing - half, facing + half)), paint: YELLOW },
  ];
}

/**
 * The death animation (product spec §4.5).
 *
 * Pac-Man turns to face up and the mouth opens until nothing is left, then a
 * burst of spokes. The one-second freeze this fills already runs — the phase
 * machine holds `Dying` for 1600 ms — so these frames land in a gap that was
 * previously empty.
 */
export const DEATH_FRAMES = 11;

function death(index: number): Layer[] {
  const last = DEATH_FRAMES - 1;
  if (index === last) {
    // The burst: six short spokes, the moment after he vanishes.
    const spokes: Layer[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
      spokes.push({
        shape: stroke(
          { x: Math.cos(angle) * 0.22, y: Math.sin(angle) * 0.22 },
          { x: Math.cos(angle) * 0.6, y: Math.sin(angle) * 0.6 },
          0.12,
        ),
        paint: YELLOW,
      });
    }
    return spokes;
  }
  // Opens from a closed mouth to a full turn over the remaining frames, so the
  // last body frame is a sliver rather than a sudden disappearance.
  const opening = (index / (last - 1)) * 0.98;
  return pacman(FACING.up, opening);
}

// Ghosts ---------------------------------------------------------------

/**
 * The ghost silhouette: a domed head over a skirt whose hem alternates between
 * two frames. The notch positions swap between phases, which is what reads as
 * the ghost "walking".
 */
function ghostBody(phase: number): Shape {
  const halfWidth = R * 0.84;
  const shoulder = -R * 0.16;
  const base = R * 0.78;
  const body = union(circle(0, shoulder, halfWidth), rect(-halfWidth, shoulder, halfWidth, base));

  // The hem: notches cut up from the base, their positions swapped between the
  // two phases. Cutting from just below the base leaves the feet rounded rather
  // than pointed, which is what stops the silhouette reading as an umbrella.
  const notchRadius = halfWidth * 0.3;
  const offsets = phase === 0 ? [-2 / 3, 0, 2 / 3] : [-1, -1 / 3, 1 / 3, 1];
  const notches = offsets.map((offset) =>
    circle(offset * halfWidth, base + notchRadius * 0.45, notchRadius),
  );
  return subtract(body, ...notches);
}

function eyes(direction: DirectionName): Layer[] {
  const look = LOOK[direction];
  const layers: Layer[] = [];
  for (const sign of [-1, 1]) {
    const cx = sign * R * 0.38;
    const cy = -R * 0.18;
    layers.push({ shape: ellipse(cx, cy, R * 0.24, R * 0.3), paint: EYE_WHITE });
    layers.push({
      shape: circle(cx + look.x * R * 0.11, cy + look.y * R * 0.14, R * 0.15),
      paint: PUPIL,
    });
  }
  return layers;
}

function ghost(name: string, phase: number): Layer[] {
  return [{ shape: ghostBody(phase), paint: color(GHOST_COLORS[name]!) }];
}

/**
 * The frightened face — dot eyes and a wavy mouth.
 *
 * Colour is never the only signal (product spec §3.4), so a frightened ghost is
 * told apart by its face as well as its blue, and the flashing frames invert
 * both.
 */
function frightFace(paint: Paint): Layer[] {
  const layers: Layer[] = [];
  for (const sign of [-1, 1]) {
    layers.push({ shape: circle(sign * R * 0.34, -R * 0.2, R * 0.15), paint });
  }

  const mouthY = R * 0.28;
  const amplitude = R * 0.12;
  const points: { x: number; y: number }[] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const x = -R * 0.55 + (i / steps) * R * 1.1;
    points.push({ x, y: mouthY + (i % 2 === 0 ? -amplitude : amplitude) });
  }
  for (let i = points.length - 1; i >= 0; i--) {
    points.push({ x: points[i]!.x, y: points[i]!.y + R * 0.11 });
  }
  layers.push({ shape: polygon(points), paint });
  return layers;
}

function frightened(phase: number, flashing: boolean): Layer[] {
  return [
    { shape: ghostBody(phase), paint: flashing ? FRIGHT_FLASH_BODY : FRIGHT_BODY },
    ...frightFace(flashing ? FRIGHT_FLASH_FACE : FRIGHT_FACE),
  ];
}

// Fruit ----------------------------------------------------------------

const STEM = color('#8b5a2b');
const LEAF = color('#3fae4a');
const WHITE = color('#ffffff');

/** The eight bonus fruit (product spec §4.4), one frame each. */
const FRUIT: Readonly<Record<string, () => Layer[]>> = {
  cherry: () => [
    { shape: stroke({ x: 0, y: -0.62 }, { x: -0.26, y: -0.12 }, 0.07), paint: LEAF },
    { shape: stroke({ x: 0, y: -0.62 }, { x: 0.28, y: -0.02 }, 0.07), paint: LEAF },
    { shape: circle(-0.28, 0.16, 0.3), paint: color('#ff2b2b') },
    { shape: circle(0.3, 0.26, 0.3), paint: color('#d61414') },
    { shape: circle(-0.36, 0.06, 0.09), paint: WHITE },
  ],
  strawberry: () => [
    { shape: stroke({ x: 0, y: -0.62 }, { x: 0, y: -0.36 }, 0.08), paint: LEAF },
    {
      shape: polygon([
        { x: -0.44, y: -0.36 },
        { x: 0.44, y: -0.36 },
        { x: 0.22, y: -0.2 },
        { x: -0.22, y: -0.2 },
      ]),
      paint: LEAF,
    },
    {
      shape: union(
        circle(0, -0.12, 0.42),
        polygon([
          { x: -0.42, y: -0.12 },
          { x: 0.42, y: -0.12 },
          { x: 0, y: 0.6 },
        ]),
      ),
      paint: color('#ff5f8d'),
    },
    { shape: circle(-0.16, 0.06, 0.06), paint: WHITE },
    { shape: circle(0.16, 0.14, 0.06), paint: WHITE },
    { shape: circle(0, 0.32, 0.06), paint: WHITE },
  ],
  orange: () => [
    { shape: stroke({ x: 0, y: -0.56 }, { x: 0.04, y: -0.3 }, 0.08), paint: STEM },
    { shape: ellipse(0.26, -0.5, 0.24, 0.12), paint: LEAF },
    { shape: circle(0, 0.1, 0.44), paint: color('#ffa02b') },
    { shape: circle(-0.16, -0.04, 0.1), paint: color('#ffd08a') },
  ],
  apple: () => [
    { shape: stroke({ x: 0, y: -0.58 }, { x: 0.02, y: -0.3 }, 0.07), paint: STEM },
    { shape: ellipse(0.26, -0.52, 0.22, 0.11), paint: LEAF },
    {
      shape: subtract(circle(0, 0.12, 0.46), circle(0, -0.44, 0.22)),
      paint: color('#e02020'),
    },
    { shape: circle(-0.2, 0.02, 0.1), paint: color('#ff8080') },
  ],
  melon: () => [
    { shape: stroke({ x: 0, y: -0.56 }, { x: 0, y: -0.36 }, 0.08), paint: STEM },
    { shape: circle(0, 0.06, 0.46), paint: color('#7cd94f') },
    ...[-0.24, 0, 0.24].map((offset) => ({
      shape: intersect(circle(0, 0.06, 0.46), rect(offset - 0.05, -0.5, offset + 0.05, 0.6)),
      paint: color('#eafbe0'),
    })),
  ],
  galaxian: () => [
    {
      shape: polygon([
        { x: 0, y: -0.5 },
        { x: 0.18, y: 0.1 },
        { x: 0, y: 0.3 },
        { x: -0.18, y: 0.1 },
      ]),
      paint: color('#ffe14d'),
    },
    {
      shape: polygon([
        { x: -0.18, y: -0.06 },
        { x: -0.56, y: 0.34 },
        { x: -0.2, y: 0.26 },
      ]),
      paint: color('#5cc8ff'),
    },
    {
      shape: mirrorX(
        polygon([
          { x: -0.18, y: -0.06 },
          { x: -0.56, y: 0.34 },
          { x: -0.2, y: 0.26 },
        ]),
      ),
      paint: color('#5cc8ff'),
    },
    { shape: circle(0, -0.1, 0.09), paint: color('#ff2b2b') },
  ],
  bell: () => [
    {
      shape: union(
        intersect(circle(0, 0.06, 0.42), rect(-0.42, -0.36, 0.42, 0.3)),
        polygon([
          { x: -0.42, y: 0.06 },
          { x: 0.42, y: 0.06 },
          { x: 0.5, y: 0.32 },
          { x: -0.5, y: 0.32 },
        ]),
      ),
      paint: color('#ffe14d'),
    },
    { shape: rect(-0.08, -0.52, 0.08, -0.34), paint: color('#ffe14d') },
    { shape: circle(0, 0.42, 0.12), paint: color('#ffffff') },
    { shape: rect(-0.3, -0.24, -0.18, 0.18), paint: color('#fff6bf') },
  ],
  key: () => [
    { shape: subtract(circle(0, -0.28, 0.26), circle(0, -0.28, 0.11)), paint: color('#a9c7ff') },
    { shape: rect(-0.07, -0.14, 0.07, 0.52), paint: color('#a9c7ff') },
    { shape: rect(0.07, 0.18, 0.34, 0.28), paint: color('#a9c7ff') },
    { shape: rect(0.07, 0.38, 0.28, 0.48), paint: color('#a9c7ff') },
  ],
};

// The 5x7 bitmap font --------------------------------------------------

/**
 * The HUD and the overlay cards draw from this strip rather than a webfont
 * (architecture §5.1): no extra request, no FOUT, no layout shift, and text
 * that scales with the maze instead of with the reader's default font size.
 */
const FONT: Readonly<Record<string, readonly string[]>> = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..##.', '....#', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['..#..', '.#.#.', '#...#', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
};

function glyphFrame(character: string, rows: readonly string[]): FrameDef {
  const layers: Layer[] = [];
  for (let row = 0; row < GLYPH_ROWS; row++) {
    const line = rows[row]!;
    let col = 0;
    while (col < GLYPH_COLS) {
      if (line[col] !== '#') {
        col++;
        continue;
      }
      // Merge each run of lit pixels into one rectangle: fewer, larger fills
      // land exactly on atlas pixel boundaries and keep the glyphs crisp.
      let end = col;
      while (end + 1 < GLYPH_COLS && line[end + 1] === '#') end++;
      layers.push({
        shape: rect(
          col * GLYPH_PIXEL,
          row * GLYPH_PIXEL,
          (end + 1) * GLYPH_PIXEL,
          (row + 1) * GLYPH_PIXEL,
        ),
        paint: GLYPH_COLOR,
      });
      col = end + 1;
    }
  }

  return {
    name: glyphFrameName(character),
    width: GLYPH_COLS * GLYPH_PIXEL,
    height: GLYPH_ROWS * GLYPH_PIXEL,
    pivotX: 0,
    pivotY: 0,
    layers,
  };
}

export function glyphFrameName(character: string): string {
  return `glyph:${character}`;
}

// The atlas's frame list -----------------------------------------------

export function allFrames(): FrameDef[] {
  const frames: FrameDef[] = [];

  for (const direction of DIRECTIONS) {
    for (const [phase, opening] of CHOMP_OPENINGS.entries()) {
      frames.push(actorFrame(`pac-${direction}-${phase}`, pacman(FACING[direction], opening)));
    }
  }

  for (let index = 0; index < DEATH_FRAMES; index++) {
    frames.push(actorFrame(`pac-death-${index}`, death(index)));
  }

  for (const name of Object.keys(GHOST_COLORS)) {
    for (const phase of [0, 1]) {
      frames.push(actorFrame(`ghost-${name}-${phase}`, ghost(name, phase)));
    }
  }

  // Eyes are their own frame, composited over a body — the arcade draws them
  // the same way, and it turns 4 ghosts x 4 directions x 2 phases of baked
  // frames into 8 bodies plus 4 pairs of eyes.
  for (const direction of DIRECTIONS) {
    frames.push(actorFrame(`eyes-${direction}`, eyes(direction)));
  }

  for (const phase of [0, 1]) {
    frames.push(actorFrame(`fright-${phase}`, frightened(phase, false)));
    frames.push(actorFrame(`fright-flash-${phase}`, frightened(phase, true)));
  }

  for (const [kind, build] of Object.entries(FRUIT)) {
    frames.push(actorFrame(`fruit-${kind}`, build()));
  }

  for (const [character, rows] of Object.entries(FONT)) {
    frames.push(glyphFrame(character, rows));
  }

  return frames;
}

/** Paint one frame's layers into a raster positioned at its pivot. */
export function drawFrame(raster: Raster, frame: FrameDef): void {
  for (const layer of frame.layers) {
    raster.fill(layer.shape, layer.paint);
  }
}
