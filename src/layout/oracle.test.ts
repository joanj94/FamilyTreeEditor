/**
 * The port, diffed against the code it was ported from.
 *
 * The invariants in `layout.test.ts` say the drawing is sane. They do not say it is the *same*
 * drawing: an off-by-one in a lane or a sign error in the stagger passes every one of them and
 * still moves every connector. So the numbers are pinned against an oracle -- coordinates computed
 * by the companion pipeline's own `layout.py`, on a tree laid out by that code and not by this.
 *
 * **The oracle is synthetic, and deliberately so.** The obvious oracle would be
 * `familytree.view.json`, the coordinates Python computed for the source chart. That file holds
 * real names, real dates and one family's real structure, and the rule for this repository is that
 * no real genealogy data enters it. So the same `layout.py`, with the same constants, was run over
 * invented people instead, and `tests/fixtures/layout-oracle.json` is what it produced -- the tree
 * it was given alongside the coordinates it returned. Same algorithm, same arithmetic, nobody's
 * family.
 *
 * The real chart is still checked, by the last suite here, by reading the sibling project in
 * place. It skips when that project is not next door, which is what CI sees.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GEOMETRY, computeLayout, type Layout } from './layout.js';
import { childrenOf, spousesOf } from './relations.js';
import type { Family, GedcomDoc, Individual, Xref } from '../model/types.js';

/** How far the port may drift from the oracle before it counts as a change. Measured drift is 0. */
const TOLERANCE = 0.5;

interface OracleUnion {
  readonly x: number;
  readonly y: number;
  readonly lane: number;
  readonly ordinal?: number;
  readonly barY?: number;
  readonly barFrom?: number;
  readonly barTo?: number;
  readonly stemX?: number;
  readonly stemY?: number;
  readonly children?: readonly Xref[];
}

interface Oracle {
  readonly tree: {
    readonly persons: readonly Xref[];
    readonly families: Record<Xref, { readonly spouses: Xref[]; readonly children: Xref[] }>;
  };
  readonly layout: {
    readonly positions: Record<Xref, [number, number]>;
    readonly unions: Record<Xref, OracleUnion>;
    readonly depth: Record<Xref, number>;
    readonly roots: readonly Xref[];
    readonly blocks: readonly { id: Xref; depth: number; members: Xref[]; families: Xref[] }[];
    readonly geometry: Record<string, number>;
  };
}

const oracle = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../tests/fixtures/layout-oracle.json', import.meta.url)),
    { encoding: 'utf-8' },
  ),
) as Oracle;

/** Build the document a tree spec describes, with both sides of every link. */
function documentFrom(
  persons: readonly Xref[],
  families: Record<Xref, { spouses: readonly Xref[]; children: readonly Xref[] }>,
): GedcomDoc {
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

const layout = computeLayout(documentFrom(oracle.tree.persons, oracle.tree.families));

describe('the port against the oracle', () => {
  it('uses the same geometry constants', () => {
    // A constant that drifted would move everything below it by a consistent amount, which is the
    // one kind of error a coordinate diff alone reports late and confusingly.
    for (const [name, value] of Object.entries(oracle.layout.geometry)) {
      expect({ [name]: GEOMETRY[name as keyof typeof GEOMETRY] }).toEqual({ [name]: value });
    }
  });

  it('places everyone the oracle places, and nobody else', () => {
    expect([...layout.positions.keys()].sort()).toEqual(
      Object.keys(oracle.layout.positions).sort(),
    );
    expect([...layout.unions.keys()].sort()).toEqual(Object.keys(oracle.layout.unions).sort());
  });

  it('puts every box within half a pixel of where Python put it', () => {
    const drift: Record<string, [number, number]> = {};
    for (const [person, [x, y]] of Object.entries(oracle.layout.positions)) {
      const here = layout.positions.get(person);
      const dx = Math.abs((here?.x ?? Number.NaN) - x);
      const dy = Math.abs((here?.y ?? Number.NaN) - y);
      if (!(dx <= TOLERANCE && dy <= TOLERANCE)) drift[person] = [dx, dy];
    }
    expect(drift).toEqual({});
  });

  it('routes every union the same way', () => {
    const drift: Record<string, unknown> = {};
    for (const [family, expected] of Object.entries(oracle.layout.unions)) {
      const here = layout.unions.get(family);
      if (here === undefined) {
        drift[family] = 'missing';
        continue;
      }
      const differences: Record<string, [unknown, unknown]> = {};
      const numbers = ['x', 'y', 'barY', 'barFrom', 'barTo', 'stemX', 'stemY'] as const;
      for (const key of numbers) {
        const mine = here[key];
        const theirs = expected[key];
        if (theirs === undefined && mine === undefined) continue;
        if (mine === undefined || theirs === undefined || Math.abs(mine - theirs) > TOLERANCE) {
          differences[key] = [mine, theirs];
        }
      }
      if (here.lane !== expected.lane) differences['lane'] = [here.lane, expected.lane];
      if ((here.ordinal ?? 0) !== (expected.ordinal ?? 0)) {
        differences['ordinal'] = [here.ordinal, expected.ordinal];
      }
      const kids = (here.children ?? []).join();
      const theirKids = (expected.children ?? []).join();
      if (kids !== theirKids) differences['children'] = [kids, theirKids];
      if (Object.keys(differences).length > 0) drift[family] = differences;
    }
    expect(drift).toEqual({});
  });

  it('agrees on the rows, the roots and the blocks', () => {
    expect(Object.fromEntries(layout.depth)).toEqual(oracle.layout.depth);
    expect(layout.roots).toEqual(oracle.layout.roots);
    expect(
      layout.blocks.map((block) => ({
        id: block.id,
        depth: block.depth,
        members: [...block.members],
        families: [...block.families],
      })),
    ).toEqual(
      oracle.layout.blocks.map((block) => ({
        id: block.id,
        depth: block.depth,
        members: block.members,
        families: block.families,
      })),
    );
  });
});

/**
 * The geometric invariants over a whole chart rather than a two-person fixture. These are the
 * source-chart assertions from `test_layout.py`, applied to the oracle's tree.
 */
function invariants(chart: Layout): void {
  describe('the invariants over a whole chart', () => {
    it('overlaps no two boxes', () => {
      const rows = new Map<number, { x: number; who: Xref }[]>();
      for (const [who, point] of chart.positions) {
        const row = rows.get(point.y);
        if (row === undefined) rows.set(point.y, [{ x: point.x, who }]);
        else row.push({ x: point.x, who });
      }
      const clashes: [Xref, Xref][] = [];
      for (const row of rows.values()) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        sorted.forEach((box, index) => {
          const before = sorted[index - 1];
          if (before !== undefined && box.x < before.x + GEOMETRY.nodeW) {
            clashes.push([before.who, box.who]);
          }
        });
      }
      expect(clashes).toEqual([]);
    });

    it('draws no child above a parent', () => {
      const wrong: [Xref, Xref][] = [];
      for (const family of chart.relations.families) {
        for (const child of childrenOf(chart.relations, family)) {
          for (const spouse of spousesOf(chart.relations, family)) {
            const kid = chart.positions.get(child);
            const parent = chart.positions.get(spouse);
            if (kid !== undefined && parent !== undefined && kid.y <= parent.y) {
              wrong.push([spouse, child]);
            }
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('reaches no sibling bar past its children', () => {
      const past: Xref[] = [];
      for (const [family, union] of chart.unions) {
        if (union.barFrom === undefined || union.children === undefined) continue;
        const xs = union.children.map((child) => chart.centres.get(child) ?? 0);
        if (
          union.barFrom < Math.min(...xs) - 0.01 ||
          (union.barTo ?? 0) > Math.max(...xs) + 0.01
        ) {
          past.push(family);
        }
      }
      expect(past).toEqual([]);
    });

    it('leaves no union dot outside its own couple', () => {
      const outside: Xref[] = [];
      for (const [family, union] of chart.unions) {
        const pair = spousesOf(chart.relations, family);
        if (pair.length === 0) continue;
        const xs = pair.map((spouse) => chart.centres.get(spouse) ?? 0);
        if (union.x < Math.min(...xs) - 0.01 || union.x > Math.max(...xs) + 0.01) {
          outside.push(family);
        }
      }
      expect(outside).toEqual([]);
    });

    it('runs no spouse connector under an unrelated box, where the couple share a block', () => {
      // A connector passing under someone else's box reads as joining them, so a couple drawn
      // side by side must have nothing between them.
      //
      // **The guarantee stops at the block.** Where both partners have parents of their own,
      // neither joins the other -- each must anchor its own block to hang from its own family --
      // and the pack is then free to place other blocks between them. This tree does exactly
      // that with @F003@, and `layout.py` produces the same five crossings from the same input,
      // so it is inherited from the algorithm rather than introduced by the port. The source
      // chart happens not to contain the shape, which is why the original suite could assert
      // this outright. Fixing it means teaching the pack to keep a couple's blocks adjacent,
      // which is a change to the packing order and not to this test.
      const crossed: [Xref, Xref][] = [];
      for (const family of chart.unions.keys()) {
        const pair = spousesOf(chart.relations, family);
        const first = pair[0];
        if (pair.length < 2 || first === undefined) continue;
        const xs = pair.map((spouse) => chart.centres.get(spouse) ?? 0).sort((a, b) => a - b);
        const row = chart.positions.get(first)?.y;
        const low = xs[0] ?? 0;
        const high = xs[xs.length - 1] ?? 0;
        for (const [who, point] of chart.positions) {
          const centre = point.x + GEOMETRY.nodeW / 2;
          if (point.y === row && !pair.includes(who) && centre > low && centre < high) {
            crossed.push([family, who]);
          }
        }
      }

      const sharingABlock = crossed.filter(([family]) => {
        const pair = spousesOf(chart.relations, family);
        const blocks = new Set(pair.map((spouse) => chart.groups.of.get(spouse)));
        return blocks.size === 1;
      });
      expect(sharingABlock).toEqual([]);

      const separated = new Set(crossed.map(([family]) => family));
      expect([...separated]).toEqual(['@F003@']);
    });

    it('interleaves no two families children on a row', () => {
      // One family's children drawn among another's is what made it look as though a woman had
      // her neighbour's children.
      const rows = new Map<number, { x: number; who: Xref }[]>();
      for (const [who, point] of chart.positions) {
        const row = rows.get(point.y);
        if (row === undefined) rows.set(point.y, [{ x: point.x, who }]);
        else row.push({ x: point.x, who });
      }
      const split: Xref[] = [];
      for (const row of rows.values()) {
        const seen = new Set<Xref>();
        let previous: Xref | undefined;
        for (const box of [...row].sort((a, b) => a.x - b.x)) {
          const family = chart.relations.parentFamily.get(box.who);
          if (family === undefined) continue;
          if (family !== previous) {
            if (seen.has(family)) split.push(family);
            seen.add(family);
            previous = family;
          }
        }
      }
      expect(split).toEqual([]);
    });

    it('lands no sibling bar on its own fold box', () => {
      const tight: [Xref, number][] = [];
      for (const [family, union] of chart.unions) {
        if (union.barY === undefined) continue;
        const gap = union.barY - union.y;
        if (gap < GEOMETRY.minBarBelowDot) tight.push([family, gap]);
      }
      expect(tight).toEqual([]);
    });

    it('never touches a bar to the children it feeds', () => {
      // Pushing the bar down to clear the fold box must not push it into the boxes below.
      const gaps: number[] = [];
      for (const union of chart.unions.values()) {
        if (union.barY === undefined || union.children === undefined) continue;
        const top = Math.min(
          ...union.children.map((child) => chart.positions.get(child)?.y ?? Number.NaN),
        );
        gaps.push(top - union.barY);
      }
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(GEOMETRY.barLift / 2);
    });

    it('never lets two overlapping unions share a lane', () => {
      const spans = [...chart.unions].map(([family, union]) => {
        const reach = [
          union.x,
          ...spousesOf(chart.relations, family).map((spouse) => chart.centres.get(spouse) ?? 0),
        ];
        return { family, y: union.y, from: Math.min(...reach), to: Math.max(...reach) };
      });
      const merged: [Xref, Xref][] = [];
      spans.forEach((left, index) => {
        for (const right of spans.slice(index + 1)) {
          if (left.y === right.y && left.from < right.to && right.from < left.to) {
            merged.push([left.family, right.family]);
          }
        }
      });
      expect(merged).toEqual([]);
    });
  });
}

invariants(layout);

/**
 * The real chart, read from the sibling project in place.
 *
 * The strongest check available -- a whole 160-person chart, matched against the coordinates
 * Python computed for it -- without that data being copied here. It skips when the sibling project
 * is not next door, which is what CI sees and what anyone cloning this repository alone sees.
 */
const SOURCE_CHART = fileURLToPath(
  new URL('../../../FamilyTree/data/output/familytree.view.json', import.meta.url),
);

describe.skipIf(!existsSync(SOURCE_CHART))('the source chart, if it is next door', () => {
  interface ViewNode {
    readonly id: string;
    readonly type?: string;
  }
  interface ViewEdge {
    readonly from: string;
    readonly to: string;
    readonly rel?: string;
  }

  it('matches what the pipeline computed, within half a pixel', () => {
    const view = JSON.parse(readFileSync(SOURCE_CHART, { encoding: 'utf-8' })) as {
      nodes: ViewNode[];
      edges: ViewEdge[];
      layout: Oracle['layout'];
    };

    /* Their identifiers carry no delimiters; ours are the standard's. The padding is uniform on
       both sides, so wrapping preserves the ordering the block walk is seeded by. */
    const wrap = (id: string): Xref => `@${id}@`;
    const spouses: Record<Xref, Xref[]> = {};
    const children: Record<Xref, Xref[]> = {};
    for (const node of view.nodes) {
      if (node.type === 'family') {
        spouses[wrap(node.id)] = [];
        children[wrap(node.id)] = [];
      }
    }
    for (const edge of view.edges) {
      if (edge.rel === 'spouse') spouses[wrap(edge.to)]?.push(wrap(edge.from));
      else children[wrap(edge.from)]?.push(wrap(edge.to));
    }
    const persons = view.nodes
      .filter((node) => node.type !== 'family')
      .map((node) => wrap(node.id));
    const families = Object.fromEntries(
      Object.keys(spouses).map((family) => [
        family,
        { spouses: spouses[family] ?? [], children: children[family] ?? [] },
      ]),
    );

    // A partner slot each: GEDCOM has HUSB and WIFE and nothing else, so a family with three
    // spouses could not be expressed and the comparison would be measuring the wrong thing.
    expect(Object.values(families).every((union) => union.spouses.length <= 2)).toBe(true);

    const chart = computeLayout(documentFrom(persons, families));
    const drift: Record<string, [number, number]> = {};
    for (const [id, [x, y]] of Object.entries(view.layout.positions)) {
      const here = chart.positions.get(wrap(id));
      const dx = Math.abs((here?.x ?? Number.NaN) - x);
      const dy = Math.abs((here?.y ?? Number.NaN) - y);
      if (!(dx <= TOLERANCE && dy <= TOLERANCE)) drift[id] = [dx, dy];
    }
    expect(drift).toEqual({});
  });
});
