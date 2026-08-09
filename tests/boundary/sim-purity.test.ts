import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Enforces the `sim/` isolation rule from architecture §6.
 *
 * The doc specifies this as an ESLint import-boundary rule. ESLint is not in
 * the toolchain yet — typescript-eslint hard-errors on TypeScript 7, which this
 * project builds with (typescript-eslint#10940). Rather than leave the rule
 * unenforced until that lands, it is a test: it checks the same constraint, it
 * runs in the same `npm test`, and it adds no dependency that would pin the
 * project to an older compiler. Swap it for the lint rule when the toolchain
 * allows, not before.
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Layers `sim/` may not reach into. `data/` is allowed: it is inert board data. */
const FORBIDDEN_LAYERS = ['render', 'input', 'ui', 'audio', 'app'];

/** Globals that would make the simulation non-portable or non-deterministic. */
const FORBIDDEN_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'performance',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'Math.random',
  'Date.now',
  'new Date',
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/** Module specifiers of every static import/export in a source file. */
function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((match) => match[1]!);
}

/**
 * Strip comments and string literals before scanning for globals.
 *
 * Without this the check trips over its own documentation: `sim/rng.ts` carries
 * a comment explaining that nothing in `sim/` may call `Math.random`.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function globalPattern(name: string): RegExp {
  return new RegExp(`(^|[^.\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

const simFiles = walk(join(SRC, 'sim'));

describe('sim/ isolation', () => {
  it('finds the simulation sources', () => {
    expect(simFiles.length).toBeGreaterThan(0);
  });

  for (const file of simFiles) {
    const name = relative(SRC, file);
    const source = readFileSync(file, 'utf8');
    const code = stripCommentsAndStrings(source);

    it(`${name} imports only from sim/ and data/`, () => {
      for (const specifier of importSpecifiers(source)) {
        const segments = specifier.split('/');
        const reached = FORBIDDEN_LAYERS.filter((layer) => segments.includes(layer));
        expect(
          reached,
          `${name} imports "${specifier}" — sim/ may not depend on ${reached.join(', ')}`,
        ).toEqual([]);
      }
    });

    it(`${name} touches no host globals`, () => {
      const found = FORBIDDEN_GLOBALS.filter((global) => globalPattern(global).test(code));
      expect(
        found,
        `${name} references ${found.join(', ')} — sim/ must stay pure and headless`,
      ).toEqual([]);
    });
  }
});
