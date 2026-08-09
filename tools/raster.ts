/**
 * A tiny supersampling rasterizer for the sprite atlas.
 *
 * The art is defined as shapes in *tile units* — the same coordinate space the
 * renderer draws in — and baked to pixels here. Shapes are point-membership
 * predicates with a bounding box rather than paths, because that is all the
 * atlas needs: every character in this game is a circle, a sector, a rectangle
 * or a polygon, and combining those three ways covers the whole cast.
 *
 * Every fill is sampled `SAMPLES x SAMPLES` times per pixel and composited by
 * coverage, so edges are antialiased in the atlas itself. That matters at this
 * scale: sprites are drawn a little under their atlas size on most screens, and
 * antialiased source art downsamples cleanly where hard pixel edges would
 * crawl (architecture §2.3 makes the same argument for snapping the tile size).
 */

/** Sub-samples per pixel axis; 4 gives 16 coverage levels, which is plenty. */
const SAMPLES = 4;

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Shape {
  contains(x: number, y: number): boolean;
  bounds: Bounds;
}

export interface Point {
  x: number;
  y: number;
}

/** Straight RGBA, `a` in 0..1. */
export interface Paint {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function color(hex: string, alpha = 1): Paint {
  const value = hex.replace('#', '');
  if (value.length !== 6) throw new Error(`Expected #rrggbb, got "${hex}"`);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
    a: alpha,
  };
}

// Shapes ---------------------------------------------------------------

export function circle(cx: number, cy: number, r: number): Shape {
  const rSquared = r * r;
  return {
    contains: (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= rSquared,
    bounds: { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r },
  };
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): Shape {
  return {
    contains: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
    bounds: { x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry },
  };
}

export function rect(x0: number, y0: number, x1: number, y1: number): Shape {
  return {
    contains: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
    bounds: { x0, y0, x1, y1 },
  };
}

/**
 * A circular sector, swept clockwise on screen from `from` to `to` (canvas
 * angle convention: 0 is +x, and y grows downward). This is Pac-Man's mouth.
 */
export function sector(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
): Shape {
  const sweep = normalize(to - from);
  const disc = circle(cx, cy, r);
  return {
    contains: (x, y) => {
      if (!disc.contains(x, y)) return false;
      return normalize(Math.atan2(y - cy, x - cx) - from) <= sweep;
    },
    bounds: disc.bounds,
  };
}

function normalize(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

/** A closed polygon, by the even-odd rule. */
export function polygon(points: readonly Point[]): Shape {
  if (points.length < 3) throw new Error('A polygon needs at least three points');
  return {
    contains: (x, y) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i]!;
        const b = points[j]!;
        const straddles = a.y > y !== b.y > y;
        if (straddles && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
          inside = !inside;
        }
      }
      return inside;
    },
    bounds: {
      x0: Math.min(...points.map((p) => p.x)),
      y0: Math.min(...points.map((p) => p.y)),
      x1: Math.max(...points.map((p) => p.x)),
      y1: Math.max(...points.map((p) => p.y)),
    },
  };
}

/** A stroked line, as the set of points within `width / 2` of the segment. */
export function stroke(a: Point, b: Point, width: number): Shape {
  const half = width / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  return {
    contains: (x, y) => {
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
      const px = a.x + t * dx - x;
      const py = a.y + t * dy - y;
      return px * px + py * py <= half * half;
    },
    bounds: {
      x0: Math.min(a.x, b.x) - half,
      y0: Math.min(a.y, b.y) - half,
      x1: Math.max(a.x, b.x) + half,
      y1: Math.max(a.y, b.y) + half,
    },
  };
}

export function union(...shapes: readonly Shape[]): Shape {
  return {
    contains: (x, y) => shapes.some((shape) => shape.contains(x, y)),
    bounds: shapes.reduce<Bounds>(
      (acc, shape) => ({
        x0: Math.min(acc.x0, shape.bounds.x0),
        y0: Math.min(acc.y0, shape.bounds.y0),
        x1: Math.max(acc.x1, shape.bounds.x1),
        y1: Math.max(acc.y1, shape.bounds.y1),
      }),
      {
        x0: Number.POSITIVE_INFINITY,
        y0: Number.POSITIVE_INFINITY,
        x1: Number.NEGATIVE_INFINITY,
        y1: Number.NEGATIVE_INFINITY,
      },
    ),
  };
}

export function intersect(...shapes: readonly Shape[]): Shape {
  const [first, ...rest] = shapes;
  if (!first) throw new Error('intersect needs at least one shape');
  return {
    contains: (x, y) => shapes.every((shape) => shape.contains(x, y)),
    bounds: rest.reduce<Bounds>(
      (acc, shape) => ({
        x0: Math.max(acc.x0, shape.bounds.x0),
        y0: Math.max(acc.y0, shape.bounds.y0),
        x1: Math.min(acc.x1, shape.bounds.x1),
        y1: Math.min(acc.y1, shape.bounds.y1),
      }),
      first.bounds,
    ),
  };
}

/** Everything in `base` that is not in any of `holes`. */
export function subtract(base: Shape, ...holes: readonly Shape[]): Shape {
  return {
    contains: (x, y) => base.contains(x, y) && !holes.some((hole) => hole.contains(x, y)),
    bounds: base.bounds,
  };
}

export function translate(shape: Shape, dx: number, dy: number): Shape {
  return {
    contains: (x, y) => shape.contains(x - dx, y - dy),
    bounds: {
      x0: shape.bounds.x0 + dx,
      y0: shape.bounds.y0 + dy,
      x1: shape.bounds.x1 + dx,
      y1: shape.bounds.y1 + dy,
    },
  };
}

/** Mirror across the vertical axis at `x = axis`. */
export function mirrorX(shape: Shape, axis = 0): Shape {
  return {
    contains: (x, y) => shape.contains(2 * axis - x, y),
    bounds: {
      x0: 2 * axis - shape.bounds.x1,
      y0: shape.bounds.y0,
      x1: 2 * axis - shape.bounds.x0,
      y1: shape.bounds.y1,
    },
  };
}

// Canvas ---------------------------------------------------------------

/**
 * An RGBA pixel buffer addressed in tile units.
 *
 * `scale` is pixels per tile; `originX`/`originY` are the tile-unit coordinates
 * of the buffer's top-left corner. Frames are drawn with the actor at (0, 0),
 * so a 2x2-tile frame has an origin of (-1, -1).
 */
export class Raster {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  private readonly scale: number;
  private readonly originX: number;
  private readonly originY: number;

  constructor(
    width: number,
    height: number,
    scale: number,
    originX: number,
    originY: number,
  ) {
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.originX = originX;
    this.originY = originY;
    this.pixels = new Uint8Array(width * height * 4);
  }

  fill(shape: Shape, paint: Paint): void {
    if (paint.a <= 0) return;
    const step = 1 / SAMPLES;
    const offset = step / 2;
    const perSample = 1 / (SAMPLES * SAMPLES);

    const minX = Math.max(0, Math.floor(this.toPixelX(shape.bounds.x0)));
    const maxX = Math.min(this.width - 1, Math.ceil(this.toPixelX(shape.bounds.x1)));
    const minY = Math.max(0, Math.floor(this.toPixelY(shape.bounds.y0)));
    const maxY = Math.min(this.height - 1, Math.ceil(this.toPixelY(shape.bounds.y1)));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        let covered = 0;
        for (let sy = 0; sy < SAMPLES; sy++) {
          const y = this.toUnitY(py + offset + sy * step);
          for (let sx = 0; sx < SAMPLES; sx++) {
            if (shape.contains(this.toUnitX(px + offset + sx * step), y)) covered++;
          }
        }
        if (covered === 0) continue;
        this.blend(px, py, paint, covered * perSample * paint.a);
      }
    }
  }

  /** Copy this raster into another at a pixel offset. Used by the packer. */
  blitInto(target: Uint8Array, targetWidth: number, x: number, y: number): void {
    for (let row = 0; row < this.height; row++) {
      const from = row * this.width * 4;
      const to = ((y + row) * targetWidth + x) * 4;
      target.set(this.pixels.subarray(from, from + this.width * 4), to);
    }
  }

  private blend(px: number, py: number, paint: Paint, alpha: number): void {
    const index = (py * this.width + px) * 4;
    const dstA = this.pixels[index + 3]! / 255;
    const outA = alpha + dstA * (1 - alpha);
    if (outA <= 0) return;

    for (let channel = 0; channel < 3; channel++) {
      const src = channel === 0 ? paint.r : channel === 1 ? paint.g : paint.b;
      const dst = this.pixels[index + channel]!;
      this.pixels[index + channel] = Math.round(
        (src * alpha + dst * dstA * (1 - alpha)) / outA,
      );
    }
    this.pixels[index + 3] = Math.round(outA * 255);
  }

  private toPixelX(x: number): number {
    return (x - this.originX) * this.scale;
  }

  private toPixelY(y: number): number {
    return (y - this.originY) * this.scale;
  }

  private toUnitX(px: number): number {
    return px / this.scale + this.originX;
  }

  private toUnitY(py: number): number {
    return py / this.scale + this.originY;
  }
}
