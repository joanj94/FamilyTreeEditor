/**
 * The ordering pass, held to the one promise it can keep.
 *
 * **Zero crossings is not on offer.** A family graph is not a tree: a cousin marriage, or two
 * siblings marrying two siblings, forces a crossing in any layered layout, and minimising
 * crossings is NP-hard besides. What is promised, and asserted here, is that the pass never
 * returns a chart worse than the one it was given, that it materially improves the one chart this
 * project was reported for, and that it answers the same way twice.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { buildBlocks, depths } from './blocks.js';
import { GEOMETRY } from './geometry.js';
import { countCrossings } from './crossings.js';
import { orderBlocks } from './ordering.js';
import { pack, placeUnions, spread, type BlockOrder } from './pack.js';
import { readRelations } from './relations.js';
import type { Family, GedcomDoc, Individual, Xref } from '../model/types.js';

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

/**
 * The crossings of a document packed in a given order.
 *
 * Built here from the parts rather than through `computeLayout`, which is what lets the ordered
 * chart be compared against the unordered one -- the thing the whole pass has to be measured by.
 */
function crossingsWith(
  doc: GedcomDoc,
  choose?: (
    blocks: ReturnType<typeof buildBlocks>,
    relations: ReturnType<typeof readRelations>,
  ) => BlockOrder,
): number {
  const relations = readRelations(doc);
  const groups = buildBlocks(relations, depths(relations));
  const order = choose?.(groups, relations);
  const packing = pack(groups, relations, new Set(), order);
  const { positions, centres } = spread(groups, packing);
  const unions = placeUnions(relations, groups.personDepth, centres, new Set());
  return countCrossings({ relations, positions, centres, unions });
}

const ordered = (
  blocks: ReturnType<typeof buildBlocks>,
  relations: ReturnType<typeof readRelations>,
) => orderBlocks(blocks, relations);

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

const fixture = tree(oracle.tree.persons, oracle.tree.families);

describe('the chart this was reported for', () => {
  it('crosses fewer connectors than the order the block tree gave', () => {
    expect(crossingsWith(fixture, ordered)).toBeLessThan(crossingsWith(fixture));
  });

  it('leaves the couple that caused it drawn side by side', () => {
    // Every one of the seven crossings measured before this pass belonged to @F003@, whose
    // partners each have parents and so anchor separate blocks. Putting those two blocks next to
    // each other is the whole of the fix; the rest is making sure nothing else got worse.
    const relations = readRelations(fixture);
    const groups = buildBlocks(relations, depths(relations));
    const packing = pack(groups, relations, new Set(), orderBlocks(groups, relations));
    const { centres } = spread(groups, packing);
    /* Two blocks standing next to each other are `nodeW + blockGap` apart, which is what
       adjacent means for a couple who cannot share a block. */
    const apart = Math.abs((centres.get('@I005@') ?? 0) - (centres.get('@I008@') ?? 0));
    expect(apart).toBe(GEOMETRY.nodeW + GEOMETRY.blockGap);
  });
});

describe('what it promises', () => {
  it('answers the same way twice', () => {
    const relations = readRelations(fixture);
    const groups = buildBlocks(relations, depths(relations));
    const first = orderBlocks(groups, relations);
    const second = orderBlocks(groups, relations);
    expect([...first.roots]).toEqual([...second.roots]);
    for (const anchor of groups.members.keys()) {
      expect({ [anchor]: [...first.childrenOf(anchor)] }).toEqual({
        [anchor]: [...second.childrenOf(anchor)],
      });
    }
  });

  it('names every root exactly once', () => {
    const relations = readRelations(fixture);
    const groups = buildBlocks(relations, depths(relations));
    expect([...orderBlocks(groups, relations).roots].sort()).toEqual([...groups.roots].sort());
  });

  it('leaves a chart that already crosses nothing crossing nothing', () => {
    const doc = tree(['@A@', '@B@', '@K1@', '@K2@', '@K3@'], {
      '@F1@': { spouses: ['@A@', '@B@'], children: ['@K1@', '@K2@', '@K3@'] },
    });
    expect(crossingsWith(doc, ordered)).toBe(0);
  });

  it('does not hang on a tree whose crossings cannot all be removed', () => {
    // Two brothers marrying two sisters. Whichever way the four blocks are ordered, one marriage
    // reaches over the other -- so the pass has to stop rather than search for a zero that is not
    // there.
    const doc = tree(
      ['@GA@', '@GB@', '@GC@', '@GD@', '@B1@', '@B2@', '@S1@', '@S2@', '@K1@', '@K2@'],
      {
        '@FA@': { spouses: ['@GA@', '@GB@'], children: ['@B1@', '@B2@'] },
        '@FB@': { spouses: ['@GC@', '@GD@'], children: ['@S1@', '@S2@'] },
        '@FC@': { spouses: ['@B1@', '@S2@'], children: ['@K1@'] },
        '@FD@': { spouses: ['@B2@', '@S1@'], children: ['@K2@'] },
      },
    );
    expect(crossingsWith(doc, ordered)).toBeLessThanOrEqual(crossingsWith(doc));
  });

  it('leaves the chart alone above the size it is allowed to search', () => {
    const relations = readRelations(fixture);
    const groups = buildBlocks(relations, depths(relations));
    const skipped = orderBlocks(groups, relations, new Set(), { sweep: 1 });
    expect([...skipped.roots]).toEqual([...groups.roots]);
  });

  it('still sweeps above the size the hill-climb is allowed on', () => {
    // The sweep costs a handful of re-packs whatever the size; only the climb is quadratic. A big
    // chart should lose the expensive half of the search, not the whole of it.
    expect(
      crossingsWith(fixture, (blocks, relations) =>
        orderBlocks(blocks, relations, new Set(), { climb: 1 }),
      ),
    ).toBeLessThan(crossingsWith(fixture));
  });
});

/** A document from a list of `[spouse, spouse, child]` index triples, with the invalid dropped. */
function treeFrom(
  count: number,
  links: readonly (readonly [number, number, number])[],
): GedcomDoc {
  const person = (index: number): Xref => `@I${index}@`;
  const families: Record<Xref, Union> = {};
  const claimed = new Set<Xref>();
  links.forEach(([left, right, kid], at) => {
    const [husband, wife] = left < right ? [left, right] : [right, left];
    if (husband === wife || husband >= count || wife >= count) return;
    /* A child below both parents keeps the graph acyclic, and one parent family each keeps it a
       tree of descent -- which is what the document model means by a family anyway. */
    const children =
      kid > wife && kid < count && !claimed.has(person(kid)) ? [person(kid)] : [];
    for (const child of children) claimed.add(child);
    families[`@F${at}@`] = { spouses: [person(husband), person(wife)], children };
  });
  return tree(
    Array.from({ length: count }, (_, index) => person(index)),
    families,
  );
}

describe('over trees it has never seen', () => {
  it('never returns a chart that crosses more than the one it was given', () => {
    // The pass keeps a candidate only where the count drops, so this holds by construction. It is
    // asserted anyway: "by construction" is what was said about the five faults this project
    // shipped, every one of which was reported as a data error.
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        fc.array(fc.tuple(fc.nat(9), fc.nat(9), fc.nat(9)), { maxLength: 8 }),
        (count, links) => {
          const doc = treeFrom(count, links);
          expect(crossingsWith(doc, ordered)).toBeLessThanOrEqual(crossingsWith(doc));
        },
      ),
      { numRuns: 200 },
    );
  });
});
