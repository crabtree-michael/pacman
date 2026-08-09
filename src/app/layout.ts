/**
 * Viewport band maths (product spec §2).
 *
 * Pure functions plus a thin applier, so the sizing rules can be snapshot
 * tested across a matrix of screen sizes without a browser (architecture §9).
 */

export const HUD_HEIGHT = 48;
export const STATUS_HEIGHT = 36;
export const CONTROL_ZONE_MIN = 180;
/** Past this the maze stops growing and the surplus goes to the thumb rest. */
export const MAZE_MAX_WIDTH = 520;
/** Below this width the game is unplayable and says so instead of rendering. */
export const MIN_SUPPORTED_WIDTH = 320;
/**
 * At or above this width the screen is wider than a thumb arc, so the joystick
 * rests in the bottom-left corner rather than centred (product spec §2.1).
 */
export const TABLET_MIN_WIDTH = 600;

/** Landscape: margin above and below the maze, and the minimum side gutters. */
const LANDSCAPE_MARGIN = 12;
const LANDSCAPE_GUTTER_MIN = 120;

export type Orientation = 'portrait' | 'landscape';

export interface LayoutMetrics {
  orientation: Orientation;
  tooSmall: boolean;
  /** Wide enough that the joystick pins to a corner instead of centring. */
  tablet: boolean;
  mazeWidth: number;
  mazeHeight: number;
  hudHeight: number;
  statusHeight: number;
  /** Portrait: the band's height. Landscape: the gutter's width. */
  controlZone: number;
}

export function computeLayout(
  availableWidth: number,
  availableHeight: number,
  cols: number,
  rows: number,
): LayoutMetrics {
  const orientation: Orientation =
    availableWidth > availableHeight ? 'landscape' : 'portrait';
  const tooSmall = availableWidth < MIN_SUPPORTED_WIDTH;
  const tablet = availableWidth >= TABLET_MIN_WIDTH;
  const aspect = cols / rows;

  if (orientation === 'landscape') {
    // The controls always win over maze size: shrink the maze until both
    // gutters fit rather than squeezing the thumb.
    let height = Math.max(0, availableHeight - 2 * LANDSCAPE_MARGIN);
    let width = height * aspect;
    if (availableWidth - width < 2 * LANDSCAPE_GUTTER_MIN) {
      width = Math.max(0, availableWidth - 2 * LANDSCAPE_GUTTER_MIN);
      height = width / aspect;
    }
    return {
      orientation,
      tooSmall,
      tablet,
      mazeWidth: width,
      mazeHeight: height,
      hudHeight: HUD_HEIGHT,
      // Landscape has no horizontal strip: lives move into the HUD column
      // alongside the score (product spec §2.2), so the band's height is zero.
      statusHeight: 0,
      controlZone: Math.max(LANDSCAPE_GUTTER_MIN, (availableWidth - width) / 2),
    };
  }

  const spareHeight = Math.max(
    0,
    availableHeight - HUD_HEIGHT - STATUS_HEIGHT - CONTROL_ZONE_MIN,
  );
  let width = Math.min(availableWidth, MAZE_MAX_WIDTH, spareHeight * aspect);
  let height = width / aspect;
  if (height > spareHeight) {
    height = spareHeight;
    width = height * aspect;
  }

  return {
    orientation,
    tooSmall,
    tablet,
    mazeWidth: width,
    mazeHeight: height,
    hudHeight: HUD_HEIGHT,
    statusHeight: STATUS_HEIGHT,
    controlZone: Math.max(
      CONTROL_ZONE_MIN,
      availableHeight - HUD_HEIGHT - STATUS_HEIGHT - height,
    ),
  };
}

/** Push the metrics into CSS custom properties; the stylesheet does the rest. */
export function applyLayout(root: HTMLElement, metrics: LayoutMetrics): void {
  root.style.setProperty('--hud-height', `${metrics.hudHeight}px`);
  root.style.setProperty('--status-height', `${metrics.statusHeight}px`);
  root.style.setProperty('--maze-width', `${metrics.mazeWidth}px`);
  root.style.setProperty('--maze-height', `${metrics.mazeHeight}px`);
  root.style.setProperty('--control-zone', `${metrics.controlZone}px`);
  root.dataset['orientation'] = metrics.orientation;
  root.dataset['tooSmall'] = String(metrics.tooSmall);
  root.dataset['tablet'] = String(metrics.tablet);
}
