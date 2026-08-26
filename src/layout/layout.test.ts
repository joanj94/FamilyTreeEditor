/**
 * The invariants the drawing has to hold, as assertions.
 *
 * Ported from `tests/test_layout.py` in the companion pipeline, where they exist because five
 * layout faults shipped past a comment claiming they had been measured -- and every one was first
 * reported as a *data* error, because a drawing that lies sends the reader hunting in the right
 * place for the wrong reason. The data was right every time.
 *
 * None of this needs a browser: `layout/` is a pure function from document to coordinates, which
 * is exactly what makes the geometry testable at all.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { GEOMETRY, computeLayout } from './layout.js';
import { buildBlocks, depths } from './blocks.js';
import { childBlocks, ordinal, pack, placeUnions, spread } from './pack.js';
import { countCrossings } from './crossings.js';
import { readRelations } from './relations.js';
import type { Family, GedcomDoc, Individual, Xref } from '../model/types.js';

const NODE_W = GEOMETRY.nodeW;
/** Two people drawn side by side inside one block. */
const ADJACENT = GEOMETRY.nodeW + GEOMETRY.gapX;

interface Union {
  readonly spouses: readonly Xref[];
  readonly children: readonly Xref[];
}

/** A document from people and unions, with both sides of every link written down. */
function tree(persons: readonly Xref[], families: Record<Xref, Union>): GedcomDoc {
  const individuals = persons.map<Individual>((xref) => {
    const asSpouse = Object.entries(families)
      .filter(([, union]) => union.spouses.includes(xref))
      .map(([family]) => ({ xref: family }));
    const asChild = Object.entries(families)
      .filter(([, union]) => union.children.includes(xref))
      .map(([family]) => ({ xref: family }));
    return {
      xref,
      ...(asChild.length > 0 ? { familiesAsChild: asChild } : {}),
      ...(asSpouse.length > 0 ? { familiesAsSpouse: asSpouse } : {}),
    };
  });

  const familyRecords = Object.entries(families).map<Family>(([xref, union]) => {
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

const centresOf = (doc: GedcomDoc) => computeLayout(doc).centres;
const at = (doc: GedcomDoc, person: Xref): number => centresOf(doc).get(person) ?? Number.NaN;

describe('generations', () => {
  it('takes depth from the longest path to a root, not the shortest', () => {
    // A person sits below both parents even where the two sides of the family run to different
    // lengths.
    const doc = tree(['@GRAN@', '@GRANSP@', '@PARENT@', '@SHALLOW@', '@CHILD@'], {
      '@F1@': { spouses: ['@GRAN@', '@GRANSP@'], children: ['@PARENT@'] },
      '@F2@': { spouses: ['@PARENT@', '@SHALLOW@'], children: ['@CHILD@'] },
    });
    const found = depths(readRelations(doc));
    expect(found.get('@GRAN@')).toBe(0);
    expect(found.get('@PARENT@')).toBe(1);
    expect(found.get('@CHILD@')).toBe(2);
    // SHALLOW married in and has no ancestry, but must not be drawn a generation above the
    // person they married.
    expect(found.get('@SHALLOW@')).toBe(1);
  });

  it('pulls a married-in spouse down to their partner', () => {
    const doc = tree(['@ROOT@', '@KID@', '@JOINED@'], {
      '@F1@': { spouses: ['@ROOT@'], children: ['@KID@'] },
      '@F2@': { spouses: ['@KID@', '@JOINED@'], children: [] },
    });
    const found = depths(readRelations(doc));
    expect(found.get('@JOINED@')).toBe(1);
    expect(found.get('@KID@')).toBe(1);
  });

  it('does not write the levelled rows back into the depths it was given', () => {
    // Levelling a block onto one row is a fact about the block, not about descent, so it comes
    // back as a new map.
    const doc = tree(['@ROOT@', '@KID@', '@JOINED@'], {
      '@F1@': { spouses: ['@KID@', '@JOINED@'], children: [] },
    });
    const relations = readRelations(doc);
    const found = depths(relations);
    const before = new Map(found);
    buildBlocks(relations, found);
    expect([...found]).toEqual([...before]);
  });
});

describe('blocks', () => {
  it('lets a spouse with no ancestry join their partner', () => {
    const doc = tree(['@A@', '@B@'], { '@F1@': { spouses: ['@A@', '@B@'], children: [] } });
    const relations = readRelations(doc);
    const group = buildBlocks(relations, depths(relations));
    expect(group.members.get('@A@')).toEqual(['@A@', '@B@']);
    expect(group.of.get('@B@')).toBe('@A@');
  });

  it('makes a spouse who has parents anchor their own block', () => {
    // The oldest generations of the source chart draw each spouse as a separate box joined by a
    // couple bar. Absorbing one into the other made them vanish from the tree their own parents
    // belong to.
    const doc = tree(['@HISDAD@', '@HERDAD@', '@HIM@', '@HER@', '@KID@'], {
      '@F1@': { spouses: ['@HISDAD@'], children: ['@HIM@'] },
      '@F2@': { spouses: ['@HERDAD@'], children: ['@HER@'] },
      '@F3@': { spouses: ['@HIM@', '@HER@'], children: ['@KID@'] },
    });
    const relations = readRelations(doc);
    const group = buildBlocks(relations, depths(relations));
    expect(group.of.get('@HIM@')).toBe('@HIM@');
    expect(group.of.get('@HER@')).toBe('@HER@');
    expect(group.members.get('@HIM@')).toEqual(['@HIM@']);
    expect(group.members.get('@HER@')).toEqual(['@HER@']);
  });

  it('draws a twice-married person between their spouses', () => {
    // [anchor, first, second] made the second union reach back over the first -- measured at
    // 296px across an unrelated box on all three remarriages of the source chart.
    const doc = tree(['@ANCHOR@', '@SPOUSEA@', '@SPOUSEB@'], {
      '@F1@': { spouses: ['@ANCHOR@', '@SPOUSEA@'], children: [] },
      '@F2@': { spouses: ['@ANCHOR@', '@SPOUSEB@'], children: [] },
    });
    const relations = readRelations(doc);
    const group = buildBlocks(relations, depths(relations));
    expect(group.members.get('@ANCHOR@')).toEqual(['@SPOUSEA@', '@ANCHOR@', '@SPOUSEB@']);
  });

  it('draws a once-married person beside their spouse', () => {
    const doc = tree(['@HUB@', '@ONLY@'], {
      '@F1@': { spouses: ['@HUB@', '@ONLY@'], children: [] },
    });
    const relations = readRelations(doc);
    const group = buildBlocks(relations, depths(relations));
    expect(group.members.get('@HUB@')).toEqual(['@HUB@', '@ONLY@']);
  });

  it('leaves both unions of a remarriage joining a neighbour', () => {
    const doc = tree(['@ANCHOR@', '@SPOUSEA@', '@SPOUSEB@'], {
      '@F1@': { spouses: ['@ANCHOR@', '@SPOUSEA@'], children: [] },
      '@F2@': { spouses: ['@ANCHOR@', '@SPOUSEB@'], children: [] },
    });
    expect(Math.abs(at(doc, '@ANCHOR@') - at(doc, '@SPOUSEA@'))).toBeCloseTo(ADJACENT, 6);
    expect(Math.abs(at(doc, '@ANCHOR@') - at(doc, '@SPOUSEB@'))).toBeCloseTo(ADJACENT, 6);
  });
});

describe('union placement', () => {
  it('sits a union dot between its own spouses', () => {
    const doc = tree(['@A@', '@B@'], { '@F1@': { spouses: ['@A@', '@B@'], children: [] } });
    const layout = computeLayout(doc);
    expect(layout.unions.get('@F1@')?.x).toBeCloseTo((at(doc, '@A@') + at(doc, '@B@')) / 2, 6);
  });

  it('never lets the sibling bar reach past its children', () => {
    // A bar passing over a box reads as a line joining it. Clamping the dot into the children's
    // span used to be the fix, and it pushed the dot outside its own couple instead.
    const doc = tree(['@A@', '@B@', '@KID@'], {
      '@F1@': { spouses: ['@A@', '@B@'], children: ['@KID@'] },
    });
    const union = computeLayout(doc).unions.get('@F1@');
    expect(union?.barFrom).toBeCloseTo(at(doc, '@KID@'), 6);
    expect(union?.barTo).toBeCloseTo(at(doc, '@KID@'), 6);
  });

  it('doglegs the stem into the children span', () => {
    const doc = tree(['@A@', '@B@', '@ONE@', '@TWO@', '@THREE@'], {
      '@F1@': { spouses: ['@A@', '@B@'], children: ['@ONE@', '@TWO@', '@THREE@'] },
    });
    const layout = computeLayout(doc);
    const union = layout.unions.get('@F1@');
    const kids = ['@ONE@', '@TWO@', '@THREE@'].map((kid) => layout.centres.get(kid) ?? 0);
    expect(union?.stemX).toBeGreaterThanOrEqual(Math.min(...kids));
    expect(union?.stemX).toBeLessThanOrEqual(Math.max(...kids));
    expect(union?.stemY).toBeLessThan(union?.barY ?? 0);
  });

  it('runs two overlapping unions on a row in different lanes', () => {
    // Two unions whose sideways runs share a height drew one unbroken stroke that read as a
    // single union joining four people. A remarriage forces the case: both unions meet at the
    // shared spouse.
    const doc = tree(['@ANCHOR@', '@SPOUSEA@', '@SPOUSEB@'], {
      '@F1@': { spouses: ['@ANCHOR@', '@SPOUSEA@'], children: [] },
      '@F2@': { spouses: ['@ANCHOR@', '@SPOUSEB@'], children: [] },
    });
    const layout = computeLayout(doc);
    expect(layout.unions.get('@F1@')?.lane).not.toBe(layout.unions.get('@F2@')?.lane);
    expect(layout.unions.get('@F1@')?.runY).not.toBe(layout.unions.get('@F2@')?.runY);
  });

  it('hangs both dots of a remarriage at the same height', () => {
    // Reported from a screenshot: one dot 30px below the other, each with a fold box under it,
    // reads as two generations rather than as one person married twice. A generation is a row.
    const doc = tree(['@ANCHOR@', '@SPOUSEA@', '@SPOUSEB@'], {
      '@F1@': { spouses: ['@ANCHOR@', '@SPOUSEA@'], children: [] },
      '@F2@': { spouses: ['@ANCHOR@', '@SPOUSEB@'], children: [] },
    });
    const layout = computeLayout(doc);
    expect(layout.unions.get('@F1@')?.y).toBe(layout.unions.get('@F2@')?.y);
  });

  it('drops a lane down to the dot rather than moving the dot up to the lane', () => {
    // The run is what a lane moves. A dot that followed its lane is what made the chart look
    // incoherent; a dot that stays put and is reached by one more corner does not.
    const doc = tree(['@ANCHOR@', '@SPOUSEA@', '@SPOUSEB@'], {
      '@F1@': { spouses: ['@ANCHOR@', '@SPOUSEA@'], children: [] },
      '@F2@': { spouses: ['@ANCHOR@', '@SPOUSEB@'], children: [] },
    });
    const layout = computeLayout(doc);
    for (const union of layout.unions.values()) expect(union.runY).toBeLessThanOrEqual(union.y);
  });

  it('keeps two separated couples on one tidy line', () => {
    // Lanes are for connectors that would otherwise abut. A row needing no separation should not
    // be spread over four heights for nothing.
    const doc = tree(['@P1@', '@S1@', '@P2@', '@S2@'], {
      '@F1@': { spouses: ['@P1@', '@S1@'], children: [] },
      '@F2@': { spouses: ['@P2@', '@S2@'], children: [] },
    });
    const layout = computeLayout(doc);
    expect(layout.unions.get('@F1@')?.lane).toBe(0);
    expect(layout.unions.get('@F2@')?.lane).toBe(0);
  });

  it('takes the ordinal from position, never from anything written in the file', () => {
    const doc = tree(['@HUB@', '@FIRST@', '@SECOND@', '@KID1@', '@KID2@'], {
      '@F1@': { spouses: ['@HUB@', '@FIRST@'], children: ['@KID1@'] },
      '@F2@': { spouses: ['@HUB@', '@SECOND@'], children: ['@KID2@'] },
    });
    const relations = readRelations(doc);
    expect(ordinal('@F1@', relations)).toBe(1);
    expect(ordinal('@F2@', relations)).toBe(2);
  });

  it('gives a single union no ordinal', () => {
    const doc = tree(['@HUB@', '@ONLY@', '@KID@'], {
      '@F1@': { spouses: ['@HUB@', '@ONLY@'], children: ['@KID@'] },
    });
    expect(ordinal('@F1@', readRelations(doc))).toBe(0);
  });

  it('draws no descent from a folded union', () => {
    // Folding has to close the tree up, so a shut union keeps its dot and loses its bar rather
    // than leaving a stub hanging into empty space.
    const doc = tree(['@A@', '@B@', '@KID@'], {
      '@F1@': { spouses: ['@A@', '@B@'], children: ['@KID@'] },
    });
    const layout = computeLayout(doc);
    const shut = placeUnions(
      layout.relations,
      layout.groups.personDepth,
      layout.centres,
      new Set(['@F1@']),
    );
    expect(shut.get('@F1@')?.barY).toBeUndefined();
    expect(shut.get('@F1@')?.x).toBeCloseTo(layout.unions.get('@F1@')?.x ?? 0, 6);
  });
});

describe('packing', () => {
  it('leaves no two families on a row overlapping', () => {
    const doc = tree(['@A1@', '@A2@', '@B1@', '@B2@', '@KA@', '@KB@'], {
      '@F1@': { spouses: ['@A1@', '@A2@'], children: ['@KA@'] },
      '@F2@': { spouses: ['@B1@', '@B2@'], children: ['@KB@'] },
    });
    const rows = new Map<number, number[]>();
    for (const point of computeLayout(doc).positions.values()) {
      const row = rows.get(point.y);
      if (row === undefined) rows.set(point.y, [point.x]);
      else row.push(point.x);
    }
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a - b);
      sorted.forEach((x, index) => {
        if (index > 0) expect(x).toBeGreaterThanOrEqual((sorted[index - 1] ?? 0) + NODE_W);
      });
    }
  });

  it('centres a parent over its children', () => {
    const doc = tree(['@P@', '@S@', '@K1@', '@K2@'], {
      '@F1@': { spouses: ['@P@', '@S@'], children: ['@K1@', '@K2@'] },
    });
    expect((at(doc, '@P@') + at(doc, '@S@')) / 2).toBeCloseTo(
      (at(doc, '@K1@') + at(doc, '@K2@')) / 2,
      6,
    );
  });
});

describe('the packing order', () => {
  // Ordering is separable from placement: the pack decides where a block goes, never who it goes
  // next to. These hold that seam open, because everything that reduces crossings happens on one
  // side of it and every geometric invariant is defended on the other.
  const cousins = tree(['@A@', '@B@', '@KA@', '@C@', '@D@', '@KC@'], {
    '@F1@': { spouses: ['@A@', '@B@'], children: ['@KA@'] },
    '@F2@': { spouses: ['@C@', '@D@'], children: ['@KC@'] },
  });
  const relations = readRelations(cousins);
  const groups = buildBlocks(relations, depths(relations));
  const asBuilt = (anchor: Xref) => childBlocks(groups, relations, anchor);

  it('places everything exactly as before when handed the order it would have used', () => {
    const before = pack(groups, relations);
    const after = pack(groups, relations, new Set(), {
      roots: groups.roots,
      childrenOf: asBuilt,
    });
    expect([...after.left]).toEqual([...before.left]);
  });

  it('lays the roots down in the order it is given', () => {
    const reversed = pack(groups, relations, new Set(), {
      roots: [...groups.roots].reverse(),
      childrenOf: asBuilt,
    });
    const before = pack(groups, relations);
    const first = groups.roots[0] ?? '';
    const last = groups.roots[groups.roots.length - 1] ?? '';
    expect(before.left.get(first)).toBeLessThan(before.left.get(last) ?? 0);
    expect(reversed.left.get(first)).toBeGreaterThan(reversed.left.get(last) ?? 0);
  });

  it('still places a block the order forgot to mention', () => {
    // An order is a preference. A block dropped from the drawing because nobody named it would be
    // a missing person, which reads as a data error and is the most expensive fault here.
    const partial = pack(groups, relations, new Set(), { roots: [], childrenOf: () => [] });
    expect([...partial.visible].sort()).toEqual([...pack(groups, relations).visible].sort());
  });

  it('places a block the order names twice only once', () => {
    const doubled = pack(groups, relations, new Set(), {
      roots: [...groups.roots, ...groups.roots],
      childrenOf: (anchor) => [...asBuilt(anchor), ...asBuilt(anchor)],
    });
    const plain = pack(groups, relations);
    expect([...doubled.left]).toEqual([...plain.left]);
  });
});

describe('connectors crossing each other', () => {
  // The shape the chart was reported for. Both partners have parents, so neither can join the
  // other's block -- each must anchor its own or it could not hang from its own family -- and the
  // pack, knowing nothing of the marriage, put a stranger between them. Their connector then ran
  // the width of the row, under every box in the way.
  const marriedApart = tree(
    [
      '@HISDAD@',
      '@HISMUM@',
      '@HERDAD@',
      '@HERMUM@',
      '@HIM@',
      '@SIB@',
      '@HER@',
      '@INLAW@',
      '@KID@',
    ],
    {
      '@F1@': { spouses: ['@HISDAD@', '@HISMUM@'], children: ['@SIB@', '@HIM@'] },
      '@F2@': { spouses: ['@HERDAD@', '@HERMUM@'], children: ['@HER@'] },
      '@F3@': { spouses: ['@HIM@', '@HER@'], children: [] },
      '@F4@': { spouses: ['@SIB@', '@INLAW@'], children: ['@KID@'] },
    },
  );

  it('crosses nothing, on the shape that used to cross everything', () => {
    expect(countCrossings(computeLayout(marriedApart))).toBe(0);
  });

  it('would cross, packed in the order the block tree gives', () => {
    // Without this the invariant above could pass because the tree is easy rather than because
    // the ordering pass earned it, and would go on passing if the pass were deleted.
    const relations = readRelations(marriedApart);
    const groups = buildBlocks(relations, depths(relations));
    const packing = pack(groups, relations);
    const { positions, centres } = spread(groups, packing);
    const unions = placeUnions(relations, groups.personDepth, centres);
    expect(countCrossings({ relations, positions, centres, unions })).toBeGreaterThan(0);
  });
});

describe('a document with nothing in it', () => {
  it('lays out to an empty chart rather than failing', () => {
    const layout = computeLayout({
      header: { gedcomVersion: '7.0' },
      individuals: [],
      families: [],
    });
    expect(layout.positions.size).toBe(0);
    expect(layout.unions.size).toBe(0);
    expect(layout.blocks).toEqual([]);
  });

  it('places a person who belongs to no family', () => {
    const doc = tree(['@LONE@'], {});
    expect(computeLayout(doc).positions.get('@LONE@')).toEqual({ x: 0, y: 0 });
  });
});
