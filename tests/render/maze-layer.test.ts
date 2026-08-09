import { describe, expect, it } from 'vitest';
import { MAZE_CLASSIC } from '../../src/data/maze-classic';
import { MazeLayer } from '../../src/render/maze-layer';
import { paletteForLevel } from '../../src/render/palette';
import { computeViewport } from '../../src/render/viewport';

/**
 * The maze is stroked as outlines rather than filled as blocks, which turns
 * "draw the walls" into a geometry problem: lines have to meet across tile
 * boundaries, stop where a wall ends, and never cross a corridor a player can
 * walk down.
 *
 * A recording context is enough to check all of that — the numbers the layer
 * hands the canvas are the whole of its output, and asserting on them says
 * more than a pixel count could.
 */

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Recording {
  segments: Segment[];
  arcs: { x: number; y: number; radius: number }[];
  fills: { x: number; y: number; w: number; h: number }[];
}

function record(): { canvas: HTMLCanvasElement; recording: Recording } {
  const recording: Recording = { segments: [], arcs: [], fills: [] };
  let cursor = { x: 0, y: 0 };

  const context = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: '',
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: (x: number, y: number) => {
      cursor = { x, y };
    },
    lineTo: (x: number, y: number) => {
      recording.segments.push({ x0: cursor.x, y0: cursor.y, x1: x, y1: y });
      cursor = { x, y };
    },
    arc: (x: number, y: number, radius: number) => {
      recording.arcs.push({ x, y, radius });
    },
    stroke: () => {},
    fillRect: (x: number, y: number, w: number, h: number) => {
      recording.fills.push({ x, y, w, h });
    },
  };

  const canvas = {
    style: {},
    width: 0,
    height: 0,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;

  return { canvas, recording };
}

function draw(): Recording {
  const { canvas, recording } = record();
  const viewport = computeViewport(280, 310, MAZE_CLASSIC.cols, MAZE_CLASSIC.rows, 1);
  new MazeLayer(canvas).draw(MAZE_CLASSIC, viewport, paletteForLevel(1));
  return recording;
}

function tileAt(col: number, row: number): string {
  return MAZE_CLASSIC.tiles[row]?.[col] ?? ' ';
}

describe('the maze outline', () => {
  const recording = draw();

  it('draws nothing for a tile buried inside a wall block', () => {
    // (8, 3) is the middle of the five-wide block on rows 2-4: wall on every
    // side, so it has no face on any corridor and nothing to contribute.
    for (const [col, row] of [
      [8, 2],
      [8, 4],
      [7, 3],
      [9, 3],
    ]) {
      expect(tileAt(col!, row!), `(${col}, ${row}) should be wall`).toBe('#');
    }

    const inside = recording.segments.filter(
      (segment) => segment.x0 > 8 && segment.x1 < 9 && segment.y0 > 3 && segment.y1 < 4,
    );
    expect(inside).toEqual([]);
  });

  it('gives the border ring two lines, one on each face', () => {
    // (5, 0) is top-border wall with a corridor below it and nothing above.
    // Off the board counts as open space, which is what puts a line on the
    // outside of the ring — the arcade's double border, for free.
    expect(tileAt(5, 0)).toBe('#');
    expect(tileAt(5, 1)).toBe('.');

    const horizontal = recording.segments
      .filter((s) => s.y0 === s.y1 && s.y0 < 1 && s.x0 >= 5 && s.x1 <= 6)
      .map((s) => s.y0)
      .sort((a, b) => a - b);

    expect(horizontal).toHaveLength(2);
    expect(horizontal[0]).toBeCloseTo(0.28); // outside face
    expect(horizontal[1]).toBeCloseTo(0.72); // inside face
  });

  it('keeps every line inside the wall tile that owns it', () => {
    // The strongest statement about a corridor: no stroke ever crosses one. A
    // line straying half a tile would put a wall across a route the simulation
    // still treats as open.
    for (const segment of recording.segments) {
      const midX = (segment.x0 + segment.x1) / 2;
      const midY = (segment.y0 + segment.y1) / 2;
      const col = Math.floor(midX);
      const row = Math.floor(midY);
      // A segment's midpoint can land on a shared edge between two wall tiles,
      // so accept the tile on either side of it.
      const owners = [tileAt(col, row), tileAt(Math.ceil(midX - 1), row), tileAt(col, Math.ceil(midY - 1))];
      expect(owners, `segment at (${midX}, ${midY})`).toContain('#');
    }
  });

  it('rounds every outside corner about the tile centre', () => {
    for (const arc of recording.arcs) {
      expect(arc.radius).toBeCloseTo(0.22);
      // Centred on a tile centre: both coordinates land on a half.
      expect(arc.x % 1).toBeCloseTo(0.5);
      expect(arc.y % 1).toBeCloseTo(0.5);
      expect(tileAt(Math.floor(arc.x), Math.floor(arc.y))).toBe('#');
    }
    expect(recording.arcs.length).toBeGreaterThan(50);
  });

  it('draws the ghost-house gate as a bar, and only there', () => {
    expect(recording.fills).toHaveLength(2);
    for (const fill of recording.fills) {
      expect(tileAt(fill.x, Math.floor(fill.y))).toBe('-');
    }
  });
});
