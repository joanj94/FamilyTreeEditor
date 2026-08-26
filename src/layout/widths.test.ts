/**
 * Boxes that fit the names in them.
 *
 * The complaint this answers is a chart drawing `María del Carmen F…`, which a reader takes for a
 * wrong record rather than a narrow box. So the assertions are about the two halves of the fix:
 * a box is wide enough for its own name, and widening one box does not put it through its
 * neighbour.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { GEOMETRY, computeLayout } from './layout.js';
import { measureText } from './text.js';
import { personWidth, personWidths, widthOf } from './widths.js';
import type { Family, GedcomDoc, Individual, Xref } from '../model/types.js';

const named = (xref: Xref, name: string): Individual => ({ xref, names: [{ value: name }] });

/** A couple with one child, so the widths are exercised through a real pack. */
function household(names: Record<Xref, string>): GedcomDoc {
  const [husband, wife, child] = Object.keys(names);
  const individuals = Object.entries(names).map<Individual>(([xref, name]) => ({
    ...named(xref, name),
    ...(xref === child
      ? { familiesAsChild: [{ xref: '@F1@' }] }
      : { familiesAsSpouse: [{ xref: '@F1@' }] }),
  }));
  const family: Family = {
    xref: '@F1@',
    ...(husband === undefined ? {} : { husband }),
    ...(wife === undefined ? {} : { wife }),
    ...(child === undefined ? {} : { children: [child] }),
  };
  return { header: { gedcomVersion: '7.0' }, individuals, families: [family] };
}

describe('how wide a box is', () => {
  it('draws a short name in the ordinary box', () => {
    expect(personWidth(named('@I1@', 'Ana Ruiz'))).toBe(GEOMETRY.nodeW);
  });

  it('widens a box that its name would not fit', () => {
    const wide = personWidth(named('@I1@', 'María del Carmen Fernández de la Vega'));
    expect(wide).toBeGreaterThan(GEOMETRY.nodeW);
  });

  it('leaves the name room to breathe on both sides', () => {
    const name = 'María del Carmen Fernández';
    const width = personWidth(named('@I1@', name));
    expect(width).toBeGreaterThanOrEqual(
      measureText(name, GEOMETRY.nameSize) + 2 * GEOMETRY.nodePadX,
    );
  });

  it('grows with the name, so a longer one never gets a narrower box', () => {
    const shorter = personWidth(named('@I1@', 'Bartholomew Fitzwilliam'));
    const longer = personWidth(named('@I2@', 'Bartholomew Fitzwilliam Wodehouse'));
    expect(longer).toBeGreaterThan(shorter);
  });

  it('stops growing, so one unreasonable name cannot stretch a row', () => {
    const absurd = personWidth(named('@I1@', 'A'.repeat(200)));
    expect(absurd).toBe(GEOMETRY.nodeMaxW);
  });

  it('sizes an unnamed person to their identifier, which is what is drawn', () => {
    expect(personWidth({ xref: '@I1@' })).toBe(GEOMETRY.nodeW);
  });

  it('makes room for the years where they are longer than the name', () => {
    const dated: Individual = {
      xref: '@I1@',
      names: [{ value: 'Bo' }],
      events: [
        { tag: 'BIRT', date: { value: '1901' } },
        { tag: 'DEAT', date: { value: '1978' } },
      ],
    };
    expect(personWidth(dated)).toBeGreaterThanOrEqual(
      measureText('1901–1978', GEOMETRY.yearsSize) + 2 * GEOMETRY.nodePadX,
    );
  });

  it('measures every person in the document', () => {
    const doc = household({
      '@I1@': 'Ana Ruiz',
      '@I2@': 'María del Carmen Fernández de la Vega',
      '@I3@': 'Leo Ruiz',
    });
    const widths = personWidths(doc);
    expect([...widths.keys()].sort()).toEqual(['@I1@', '@I2@', '@I3@']);
    expect(widthOf(widths, '@I2@')).toBeGreaterThan(widthOf(widths, '@I1@'));
  });

  it('falls back to the ordinary box for a person nobody measured', () => {
    expect(widthOf(new Map(), '@I9@')).toBe(GEOMETRY.nodeW);
  });
});

describe('what a wide box does to the drawing', () => {
  const doc = household({
    '@I1@': 'María del Carmen Fernández de la Vega',
    '@I2@': 'Ana Ruiz',
    '@I3@': 'Leo Ruiz',
  });
  const chart = computeLayout(doc);

  it('carries the widths it packed, so the renderer draws the box it made room for', () => {
    expect(widthOf(chart.widths, '@I1@')).toBeGreaterThan(GEOMETRY.nodeW);
  });

  it('leaves the couple the gap between them, and no less', () => {
    const wide = chart.positions.get('@I1@');
    const beside = chart.positions.get('@I2@');
    expect(wide).toBeDefined();
    expect(beside).toBeDefined();
    const apart = (beside?.x ?? 0) - (wide?.x ?? 0);
    expect(apart).toBe(widthOf(chart.widths, '@I1@') + GEOMETRY.gapX);
  });

  it('overlaps no two boxes on a row', () => {
    const rows = new Map<number, Xref[]>();
    for (const [person, at] of chart.positions) {
      const row = rows.get(at.y);
      if (row === undefined) rows.set(at.y, [person]);
      else row.push(person);
    }
    for (const row of rows.values()) {
      const sorted = row.sort(
        (left, right) =>
          (chart.positions.get(left)?.x ?? 0) - (chart.positions.get(right)?.x ?? 0),
      );
      sorted.forEach((person, index) => {
        const before = sorted[index - 1];
        if (before === undefined) return;
        const ends = (chart.positions.get(before)?.x ?? 0) + widthOf(chart.widths, before);
        expect(chart.positions.get(person)?.x ?? 0).toBeGreaterThanOrEqual(ends);
      });
    }
  });

  it('joins a connector to the middle of the box it belongs to', () => {
    // The centre is what every connector is drawn to, so a centre computed from the wrong width
    // puts the line off the box entirely.
    for (const [person, at] of chart.positions) {
      expect(chart.centres.get(person)).toBe(at.x + widthOf(chart.widths, person) / 2);
    }
  });

  it('hangs the union dot between its own spouses', () => {
    const dot = chart.unions.get('@F1@');
    const left = chart.centres.get('@I1@') ?? 0;
    const right = chart.centres.get('@I2@') ?? 0;
    expect(dot?.x).toBeGreaterThanOrEqual(Math.min(left, right));
    expect(dot?.x).toBeLessThanOrEqual(Math.max(left, right));
  });
});
