/**
 * The connector path builder.
 *
 * The test that matters most is the one for repeated points. A zero-length segment divides by its
 * own length, which yields `NaN`, and `NaN` in path data makes SVG drop the path without a word --
 * no exception, no console entry, nothing in the DOM to inspect. The bug appears as a connector
 * that is simply missing, which a reader interprets as a missing relationship. So the assertion is
 * written against the string: no `NaN` may appear in it, ever.
 */
import { describe, expect, it } from 'vitest';

import { ortho } from './ortho.js';
import { GEOMETRY } from '../layout/layout.js';

describe('ortho', () => {
  it('draws a straight run between two points', () => {
    expect(
      ortho([
        [0, 0],
        [0, 50],
      ]),
    ).toBe('M0,0 L0,50');
  });

  it('rounds an interior corner', () => {
    const d = ortho([
      [0, 0],
      [0, 100],
      [100, 100],
    ]);
    expect(d).toContain('Q0,100');
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d.endsWith('L100,100')).toBe(true);
  });

  it('never puts NaN in the path, whatever it is given', () => {
    // A repeated point is the case that produced it: two layout values that happened to coincide,
    // which is ordinary rather than exotic -- a union directly above its only child does it.
    const paths = [
      ortho([
        [10, 10],
        [10, 10],
        [10, 60],
      ]),
      ortho([
        [10, 10],
        [10, 60],
        [10, 60],
      ]),
      ortho([
        [10, 10],
        [10, 10],
        [10, 10],
      ]),
      ortho([
        [0, 0],
        [0, 0],
        [50, 0],
        [50, 0],
        [50, 50],
      ]),
    ];
    for (const d of paths) expect(d).not.toContain('NaN');
  });

  it('collapses a repeated point rather than drawing a corner at it', () => {
    expect(
      ortho([
        [10, 10],
        [10, 10],
        [10, 60],
      ]),
    ).toBe('M10,10 L10,60');
  });

  it('draws nothing where there is nothing to draw', () => {
    expect(ortho([])).toBe('');
    expect(ortho([[5, 5]])).toBe('');
    expect(
      ortho([
        [5, 5],
        [5, 5],
      ]),
    ).toBe('');
  });

  it('never rounds by more than half a segment, so corners cannot overrun each other', () => {
    // A radius larger than the segment would send the curve backwards past the previous corner.
    const short = 6;
    const d = ortho([
      [0, 0],
      [0, short],
      [short, short],
    ]);
    const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
    expect(Math.max(...numbers)).toBeLessThanOrEqual(short);
    expect(GEOMETRY.elbow).toBeGreaterThan(short / 2);
  });
});
