/**
 * Identifier allocation.
 *
 * The property under test throughout is collision-freedom against *the whole document*, not
 * against the list being appended to. A GEDCOM identifier is unique across the file, and nothing
 * in the standard says `@I1@` must be an individual -- so an allocator that only looks at
 * `individuals` will eventually hand out an identifier that a family, or a source record this
 * editor keeps verbatim, already owns.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { collectXrefs, nextFamilyXref, nextIndividualXref, nextXref } from './xref.js';
import { XREF_PATTERN, type GedcomDoc } from './types.js';

const empty: GedcomDoc = {
  header: { gedcomVersion: '7.0' },
  individuals: [],
  families: [],
};

const withRecords = (individuals: string[], families: string[]): GedcomDoc => ({
  ...empty,
  individuals: individuals.map((xref) => ({ xref })),
  families: families.map((xref) => ({ xref })),
});

describe('collectXrefs', () => {
  it('gathers identifiers from every kind of record, not just the modelled ones', () => {
    // otherRecords holds SOUR, OBJE, SUBM and anything else kept verbatim. Those identifiers are
    // as real as an individual's, and an allocator that cannot see them will collide with one.
    const doc: GedcomDoc = {
      ...withRecords(['@I1@'], ['@F1@']),
      otherRecords: [{ xref: '@S1@', tag: 'SOUR' }],
    };
    expect(collectXrefs(doc)).toEqual(new Set(['@I1@', '@F1@', '@S1@']));
  });

  it('is empty for a document with no records', () => {
    expect(collectXrefs(empty).size).toBe(0);
  });
});

describe('nextXref', () => {
  it('starts at 1 when nothing is in use', () => {
    expect(nextXref(new Set(), 'I')).toBe('@I1@');
  });

  it('continues past the highest number in use rather than filling the first gap', () => {
    // Reuse is the dangerous option. An undo stack holds documents that still point at @I2@, and
    // handing that identifier to a different person would silently rewrite history.
    expect(nextXref(new Set(['@I1@', '@I3@']), 'I')).toBe('@I4@');
  });

  it('counts only identifiers with the requested prefix', () => {
    expect(nextXref(new Set(['@F9@', '@S7@']), 'I')).toBe('@I1@');
  });

  it('keeps the zero padding a file already uses', () => {
    // GDS writes @I0001@. Appending @I2@ to that file would work, but it would look like a
    // different tool had been at it -- and the user reads these identifiers.
    expect(nextXref(new Set(['@I0001@', '@I0007@']), 'I')).toBe('@I0008@');
  });

  it('widens past the padding when the number no longer fits', () => {
    expect(nextXref(new Set(['@I999@']), 'I')).toBe('@I1000@');
  });

  it('ignores identifiers that share the prefix but carry no number', () => {
    // @INDIVIDUAL@ is a legal identifier and says nothing about numbering.
    expect(nextXref(new Set(['@INDIVIDUAL@', '@I4@']), 'I')).toBe('@I5@');
  });

  it('refuses a prefix that would produce an identifier the standard rejects', () => {
    expect(() => nextXref(new Set(), 'i')).toThrow(/prefix/i);
    expect(() => nextXref(new Set(), '')).toThrow(/prefix/i);
    expect(() => nextXref(new Set(), 'I-')).toThrow(/prefix/i);
  });
});

describe('the document-level allocators', () => {
  it('allocate an unused identifier of the conventional shape', () => {
    const doc = withRecords(['@I1@', '@I2@'], ['@F1@']);
    expect(nextIndividualXref(doc)).toBe('@I3@');
    expect(nextFamilyXref(doc)).toBe('@F2@');
  });

  it('do not collide with a record of another kind that took the identifier first', () => {
    // A family called @I2@ is unusual and entirely legal.
    const doc = withRecords(['@I1@'], ['@I2@']);
    expect(nextIndividualXref(doc)).toBe('@I3@');
  });
});

describe('the allocation property', () => {
  it('never returns an identifier already in use, whatever is in use', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[A-Z0-9_]{1,8}$/), { maxLength: 40 }),
        fc.constantFrom('I', 'F', 'S', 'X1'),
        (bodies, prefix) => {
          const used = new Set(bodies.map((body) => `@${body}@`));
          const allocated = nextXref(used, prefix);
          expect(used.has(allocated)).toBe(false);
          expect(allocated).toMatch(XREF_PATTERN);
        },
      ),
    );
  });

  it('stays collision-free when allocations are threaded through one growing set', () => {
    // The batch case: a caller adding several records before writing any of them back.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 25 }), (count) => {
        const used = new Set<string>(['@I1@', '@I0009@']);
        for (let i = 0; i < count; i += 1) {
          const allocated = nextXref(used, 'I');
          expect(used.has(allocated)).toBe(false);
          used.add(allocated);
        }
        expect(used.size).toBe(count + 2);
      }),
    );
  });
});
