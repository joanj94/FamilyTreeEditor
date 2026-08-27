/**
 * The read-only view of the document as a graph.
 *
 * Two decisions are worth stating, because both are tested here and neither is obvious.
 *
 * **Parentage is read from both directions.** GEDCOM records the same fact twice -- a family
 * lists `CHIL`, the person lists `FAMC` -- and a file can arrive with only one of them. `audit()`
 * reports that asymmetry, but traversal must not depend on it having been fixed: a cycle
 * expressed through a one-sided link is still a cycle, and a layout that walks only one side
 * would hang on it.
 *
 * **`@VOID@` is not a missing pointer.** The standard's word for "deliberately no record" is a
 * value, not an absence, and treating it as a dangling reference would report every file that
 * uses it correctly.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import {
  ancestorsOf,
  indexDoc,
  parentFamiliesOf,
  isAncestorOf,
  isVoid,
  membersOf,
  parentsOf,
  partnersOf,
} from './graph.js';
import type { Family, GedcomDoc, Individual } from './types.js';

const doc = (individuals: Individual[], families: Family[]): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals,
  families,
});

/** Grandparents @I1@ and @I2@, their child @I3@, and @I3@'s child @I5@ by @I4@. */
const threeGenerations = doc(
  [
    { xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }] },
    { xref: '@I2@', familiesAsSpouse: [{ xref: '@F1@' }] },
    {
      xref: '@I3@',
      familiesAsChild: [{ xref: '@F1@' }],
      familiesAsSpouse: [{ xref: '@F2@' }],
    },
    { xref: '@I4@', familiesAsSpouse: [{ xref: '@F2@' }] },
    { xref: '@I5@', familiesAsChild: [{ xref: '@F2@' }] },
  ],
  [
    { xref: '@F1@', husband: '@I1@', wife: '@I2@', children: ['@I3@'] },
    { xref: '@F2@', husband: '@I3@', wife: '@I4@', children: ['@I5@'] },
  ],
);

describe('indexDoc', () => {
  it('looks records up by identifier', () => {
    const index = indexDoc(threeGenerations);
    expect(index.individuals.get('@I3@')?.xref).toBe('@I3@');
    expect(index.families.get('@F2@')?.children).toEqual(['@I5@']);
    expect(index.individuals.get('@I9@')).toBeUndefined();
  });

  it('keeps the first record when a document carries an identifier twice', () => {
    // Duplicates are a fault, reported by audit(). The index still has to answer, and answering
    // with the first occurrence at least makes the reading deterministic.
    const duplicated = doc(
      [
        { xref: '@I1@', sex: 'M' },
        { xref: '@I1@', sex: 'F' },
      ],
      [],
    );
    expect(indexDoc(duplicated).individuals.get('@I1@')?.sex).toBe('M');
  });
});

describe('isVoid', () => {
  it('recognises the standard reference to no record', () => {
    expect(isVoid('@VOID@')).toBe(true);
    expect(isVoid('@I1@')).toBe(false);
  });
});

describe('partnersOf and membersOf', () => {
  it('list the partners a family names', () => {
    expect(partnersOf(threeGenerations.families[0]!)).toEqual(['@I1@', '@I2@']);
  });

  it('omit a partner slot that is absent or deliberately void', () => {
    expect(partnersOf({ xref: '@F9@', husband: '@VOID@', wife: '@I2@' })).toEqual(['@I2@']);
    expect(partnersOf({ xref: '@F9@' })).toEqual([]);
  });

  it('include the children among the members', () => {
    expect(membersOf(threeGenerations.families[0]!)).toEqual(['@I1@', '@I2@', '@I3@']);
  });
});

describe('parentsOf', () => {
  it('reads parents through the family the person is a child of', () => {
    const index = indexDoc(threeGenerations);
    expect(parentsOf(index, '@I5@').slice().sort()).toEqual(['@I3@', '@I4@']);
  });

  it('is empty for a person no family claims', () => {
    expect(parentsOf(indexDoc(threeGenerations), '@I1@')).toEqual([]);
  });

  it('sees a parent named by only one side of the link', () => {
    // The family lists the child; the child's record was never updated to say so.
    const halfLinked = doc(
      [{ xref: '@I1@' }, { xref: '@I2@' }],
      [{ xref: '@F1@', husband: '@I1@', children: ['@I2@'] }],
    );
    expect(parentsOf(indexDoc(halfLinked), '@I2@')).toEqual(['@I1@']);
  });

  it('sees a parent named by the other side alone', () => {
    const halfLinked = doc(
      [{ xref: '@I1@' }, { xref: '@I2@', familiesAsChild: [{ xref: '@F1@' }] }],
      [{ xref: '@F1@', husband: '@I1@' }],
    );
    expect(parentsOf(indexDoc(halfLinked), '@I2@')).toEqual(['@I1@']);
  });

  it('names each parent once even when both sides record the link', () => {
    expect(parentsOf(indexDoc(threeGenerations), '@I3@').slice().sort()).toEqual([
      '@I1@',
      '@I2@',
    ]);
  });
});

describe('ancestorsOf', () => {
  it('walks every generation upwards', () => {
    const ancestors = ancestorsOf(indexDoc(threeGenerations), '@I5@');
    expect([...ancestors].sort()).toEqual(['@I1@', '@I2@', '@I3@', '@I4@']);
  });

  it('does not count the person as their own ancestor in a sound document', () => {
    expect(ancestorsOf(indexDoc(threeGenerations), '@I5@').has('@I5@')).toBe(false);
  });

  it('terminates on a document that already contains a cycle', () => {
    // A cycle can arrive in an imported file. Reporting it is audit()'s job; not hanging while
    // walking it is this function's, and every caller depends on that.
    const cyclic = doc(
      [{ xref: '@I1@' }, { xref: '@I2@' }],
      [
        { xref: '@F1@', husband: '@I1@', children: ['@I2@'] },
        { xref: '@F2@', husband: '@I2@', children: ['@I1@'] },
      ],
    );
    const ancestors = ancestorsOf(indexDoc(cyclic), '@I1@');
    expect([...ancestors].sort()).toEqual(['@I1@', '@I2@']);
  });
});

describe('isAncestorOf', () => {
  it('is true up the line and false down it', () => {
    const index = indexDoc(threeGenerations);
    expect(isAncestorOf(index, '@I1@', '@I5@')).toBe(true);
    expect(isAncestorOf(index, '@I5@', '@I1@')).toBe(false);
  });

  it('is false for a person unrelated to the line', () => {
    const index = indexDoc(threeGenerations);
    expect(isAncestorOf(index, '@I4@', '@I3@')).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Cost.
 *
 * `parentFamiliesOf` used to scan every family to answer one person's question, and `audit()`
 * asks it for every person on every edit -- so the work grew with the square of the file.
 * Measured before the fix: 6 ms at 500 people, 72 ms at 4,000. That is a keystroke's worth of
 * checking becoming a visible pause on a file this tool is meant to handle.
 *
 * Asserting a ratio rather than a duration, because a wall-clock threshold on a shared CI runner
 * is a flaky test waiting to happen. Quadratic growth quadruples the time when the input doubles;
 * linear growth doubles it. The bar is set well clear of both the old behaviour and ordinary
 * noise.
 * ------------------------------------------------------------------------------------------- */
describe('cost as the document grows', () => {
  /** A forest: every five people form a family of two partners and three children. Invented. */
  const forest = (people: number): GedcomDoc => {
    const individuals = [];
    const families = [];
    for (let base = 0; base + 5 <= people; base += 5) {
      const fx = `@F${String(base / 5 + 1)}@`;
      const p = (n: number) => `@I${String(base + n)}@`;
      individuals.push(
        { xref: p(1), familiesAsSpouse: [{ xref: fx }] },
        { xref: p(2), familiesAsSpouse: [{ xref: fx }] },
        { xref: p(3), familiesAsChild: [{ xref: fx }] },
        { xref: p(4), familiesAsChild: [{ xref: fx }] },
        { xref: p(5), familiesAsChild: [{ xref: fx }] },
      );
      families.push({ xref: fx, husband: p(1), wife: p(2), children: [p(3), p(4), p(5)] });
    }
    return { header: { gedcomVersion: '7.0' }, individuals, families };
  };

  /**
   * A map that counts the reads made through it, including the reads a scan would make.
   *
   * Cost is asserted here by counting work rather than by timing it. A stopwatch inside a suite
   * that runs its files in parallel measures the load on the machine as much as the algorithm:
   * timing this walk across a few tenths of a millisecond produced ratios between 1.2 and 4.4 on
   * an idle machine, and widening it to milliseconds still failed under a full run. A count is
   * the same number on every machine.
   */
  class CountingMap<K, V> extends Map<K, V> {
    reads = 0;

    override get(key: K): V | undefined {
      this.reads += 1;
      return super.get(key);
    }

    override has(key: K): boolean {
      this.reads += 1;
      return super.has(key);
    }

    /* Reading the collection whole is the shape this test exists to catch, and it costs one read
       per entry however it is spelled. */
    override [Symbol.iterator](): MapIterator<[K, V]> {
      this.reads += this.size;
      return super[Symbol.iterator]();
    }

    override keys(): MapIterator<K> {
      this.reads += this.size;
      return super.keys();
    }

    override values(): MapIterator<V> {
      this.reads += this.size;
      return super.values();
    }

    override entries(): MapIterator<[K, V]> {
      this.reads += this.size;
      return super.entries();
    }
  }

  /**
   * The reads that walking every person's parent families costs, per person. That walk is the
   * shape `audit()` traverses, and the index is what it has to go through to answer.
   */
  const readsPerPerson = (people: number): number => {
    const doc = forest(people);
    const built = indexDoc(doc);
    const individuals = new CountingMap(built.individuals);
    const families = new CountingMap(built.families);
    const claimedAsChild = new CountingMap(built.claimedAsChild);

    for (const individual of doc.individuals) {
      parentFamiliesOf({ individuals, families, claimedAsChild, doc }, individual.xref);
    }
    return (individuals.reads + families.reads + claimedAsChild.reads) / doc.individuals.length;
  };

  it('grows with the document rather than with its square', () => {
    /* The regression this guards is the one described on `claimedAsChild`: answering "which
       families claim this person" by scanning every family made `audit()` quadratic in the size
       of the file. What keeps the whole walk linear is that one person costs the same handful of
       reads whatever the document around them -- a scan would cost one read per family, which is
       in the hundreds at the smaller size here and twenty times that at the larger. */
    expect(readsPerPerson(2000)).toBeLessThan(10);
    expect(readsPerPerson(40_000)).toBeLessThan(10);
  });

  it('answers from the index rather than by scanning the families', () => {
    const doc = forest(50);
    const index = indexDoc(doc);
    expect(index.claimedAsChild.get('@I3@')).toEqual(['@F1@']);
    expect(index.claimedAsChild.get('@I1@')).toBeUndefined();
  });

  it('claims a child once even where a family lists them twice', () => {
    const doc: GedcomDoc = {
      header: { gedcomVersion: '7.0' },
      individuals: [{ xref: '@I1@' }],
      families: [{ xref: '@F1@', children: ['@I1@', '@I1@'] }],
    };
    expect(parentFamiliesOf(indexDoc(doc), '@I1@')).toEqual(['@F1@']);
  });
});
