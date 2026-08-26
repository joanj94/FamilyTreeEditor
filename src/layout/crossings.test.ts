/**
 * The crossing metric, checked against cases whose answer can be counted by eye.
 *
 * This is the objective function the ordering pass optimises and the regression guard that keeps
 * it optimised, so it is written first and pinned before anything is changed. A metric that
 * miscounts by one would be indistinguishable from an ordering pass that works, which is the kind
 * of fault this project has already paid for once.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  connectorSegments,
  countCrossings,
  countSegmentCrossings,
  crossingPairs,
  segment,
} from './crossings.js';
import { computeLayout } from './layout.js';
import type { Family, GedcomDoc, Individual, Xref } from '../model/types.js';

describe('two segments', () => {
  it('counts a plain crossing', () => {
    const across = segment('a', [0, 5], [10, 5]);
    const down = segment('b', [5, 0], [5, 10]);
    expect(countSegmentCrossings([across, down])).toBe(1);
  });

  it('counts a crossing once, however the pair is ordered', () => {
    const across = segment('a', [0, 5], [10, 5]);
    const down = segment('b', [5, 10], [5, 0]);
    expect(countSegmentCrossings([down, across])).toBe(1);
  });

  it('counts nothing for two parallel segments', () => {
    expect(
      countSegmentCrossings([segment('a', [0, 0], [10, 0]), segment('b', [0, 4], [10, 4])]),
    ).toBe(0);
  });

  it('counts nothing for two segments sharing an endpoint', () => {
    // An elbow. Every connector on the chart is made of these, so counting one would count the
    // drawing itself.
    expect(
      countSegmentCrossings([segment('a', [0, 0], [10, 0]), segment('b', [10, 0], [10, 8])]),
    ).toBe(0);
  });

  it('counts nothing for a T-junction', () => {
    // A descent meeting its own sibling bar touches it and stops. That is a join, not a crossing,
    // and the whole fan of children below a union is drawn this way.
    expect(
      countSegmentCrossings([segment('a', [0, 0], [10, 0]), segment('b', [5, 0], [5, 9])]),
    ).toBe(0);
  });

  it('counts nothing for two collinear segments lying on each other', () => {
    // Children of one union overdraw the shared run of the bar. They lie on top of one another,
    // which is how the bar is drawn at all.
    expect(
      countSegmentCrossings([segment('a', [0, 0], [10, 0]), segment('b', [4, 0], [20, 0])]),
    ).toBe(0);
  });

  it('counts nothing where a segment has no length', () => {
    expect(
      countSegmentCrossings([segment('a', [5, 5], [5, 5]), segment('b', [0, 5], [10, 5])]),
    ).toBe(0);
  });

  it('counts a crossing that is not at right angles', () => {
    // Nothing on the chart is drawn this way, but a metric that only understood right angles
    // would silently stop counting the day one was.
    expect(
      countSegmentCrossings([segment('a', [0, 0], [10, 10]), segment('b', [0, 10], [10, 0])]),
    ).toBe(1);
  });

  it('names the pair it counted', () => {
    const pairs = crossingPairs([
      segment('spouse', [0, 5], [10, 5]),
      segment('descent', [5, 0], [5, 10]),
    ]);
    expect(pairs).toEqual([['descent', 'spouse']]);
  });
});

interface Union {
  readonly spouses: readonly Xref[];
  readonly children: readonly Xref[];
}

/** A document from people and unions, with both sides of every link written down. */
function tree(persons: readonly Xref[], families: Record<Xref, Union>): GedcomDoc {
  const entries = Object.entries(families);
  const individuals = persons.map<Individual>((xref) => {
    const asChild = entries
      .filter(([, union]) => union.children.includes(xref))
      .map(([family]) => ({ xref: family }));
    const asSpouse = entries
      .filter(([, union]) => union.spouses.includes(xref))
      .map(([family]) => ({ xref: family }));
    return {
      xref,
      ...(asChild.length > 0 ? { familiesAsChild: asChild } : {}),
      ...(asSpouse.length > 0 ? { familiesAsSpouse: asSpouse } : {}),
    };
  });
  const familyRecords = entries.map<Family>(([xref, union]) => {
    const [husband, wife] = union.spouses;
    return {
      xref,
      ...(husband === undefined ? {} : { husband }),
      ...(wife === undefined ? {} : { wife }),
      ...(union.children.length > 0 ? { children: union.children } : {}),
    };
  });
  return { header: { gedcomVersion: '7.0' }, individuals, families: familyRecords };
}

describe('a whole chart', () => {
  it('crosses nothing on a single family', () => {
    const doc = tree(['@A@', '@B@', '@K1@', '@K2@', '@K3@'], {
      '@F1@': { spouses: ['@A@', '@B@'], children: ['@K1@', '@K2@', '@K3@'] },
    });
    expect(countCrossings(computeLayout(doc))).toBe(0);
  });

  it('crosses nothing on two unrelated families side by side', () => {
    const doc = tree(['@A@', '@B@', '@KA@', '@C@', '@D@', '@KC@'], {
      '@F1@': { spouses: ['@A@', '@B@'], children: ['@KA@'] },
      '@F2@': { spouses: ['@C@', '@D@'], children: ['@KC@'] },
    });
    expect(countCrossings(computeLayout(doc))).toBe(0);
  });

  it('counts nothing on an empty chart', () => {
    expect(
      countCrossings(
        computeLayout({ header: { gedcomVersion: '7.0' }, individuals: [], families: [] }),
      ),
    ).toBe(0);
  });

  it('gives the same count twice for the same document', () => {
    const doc = tree(['@A@', '@B@', '@K1@', '@K2@'], {
      '@F1@': { spouses: ['@A@', '@B@'], children: ['@K1@', '@K2@'] },
    });
    expect(countCrossings(computeLayout(doc))).toBe(countCrossings(computeLayout(doc)));
  });
});

interface Oracle {
  readonly tree: {
    readonly persons: readonly Xref[];
    readonly families: Record<Xref, { readonly spouses: Xref[]; readonly children: Xref[] }>;
  };
}

const oracle = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../tests/fixtures/layout-oracle.json', import.meta.url)),
    {
      encoding: 'utf-8',
    },
  ),
) as Oracle;

/**
 * The count this whole exercise exists to bring down.
 *
 * Measured 2026-08-26 in the order the block tree gave: **7**, every one of them belonging to
 * `@F003@` -- the couple whose partners both have parents, so neither joins the other's block and
 * the packer was free to put three unrelated blocks between them. Their spouse connectors then ran
 * the width of the row and crossed everything dropping out of the boxes in between. With the
 * ordering pass choosing who sits next to whom: **0**.
 *
 * A browser harness on the app's own chart reported 8 that same day. The numbers here are what
 * this metric measures on this fixture; the two are different trees and are not expected to agree.
 */
describe('the fixture chart', () => {
  const doc = tree(oracle.tree.persons, oracle.tree.families);

  it('crosses nothing over anything', () => {
    expect(crossingPairs(connectorSegments(computeLayout(doc)))).toEqual([]);
  });

  it('counts the same twice over, so the metric cannot drift under the optimiser', () => {
    expect(countCrossings(computeLayout(doc))).toBe(countCrossings(computeLayout(doc)));
  });
});
