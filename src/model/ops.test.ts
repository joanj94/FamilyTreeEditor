/**
 * The editing operations.
 *
 * Three properties are asserted over and over below, because they are what the rest of the editor
 * is allowed to assume:
 *
 * 1. **The document handed in is never touched.** Undo is holding it.
 * 2. **Both sides of every link move together.** GEDCOM writes each relationship down twice, and
 *    an operation that updates only one side produces a file that fails `audit()` -- so the
 *    operations, not the caller, are where that pairing is kept.
 * 3. **An operation either applies or refuses.** There is no half-applied edit: a refusal throws
 *    and returns nothing, so the caller still holds the document it started with.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  OperationError,
  addIndividual,
  createUnion,
  linkChild,
  removeFamily,
  removeIndividual,
  setPartner,
  unlinkChild,
  updateFamily,
  updateIndividual,
} from './ops.js';
import { audit, auditErrors, isAuditClean } from './audit.js';
import { validateDoc } from './validate.js';
import type { GedcomDoc, Xref } from './types.js';

const empty: GedcomDoc = {
  header: { gedcomVersion: '7.0' },
  individuals: [],
  families: [],
};

/** Two partners, one child, both sides of every link written down. */
function household(): { doc: GedcomDoc; husband: Xref; wife: Xref; child: Xref; family: Xref } {
  const first = addIndividual(empty, { sex: 'M' });
  const second = addIndividual(first.doc, { sex: 'F' });
  const third = addIndividual(second.doc, { sex: 'U' });
  const union = createUnion(third.doc, {
    husband: first.xref,
    wife: second.xref,
    children: [third.xref],
  });
  return {
    doc: union.doc,
    husband: first.xref,
    wife: second.xref,
    child: third.xref,
    family: union.xref,
  };
}

/** Both gates at once: the schema and referential integrity. */
function expectSound(doc: GedcomDoc): void {
  const validation = validateDoc(doc);
  expect(validation.ok ? [] : validation.errors).toEqual([]);
  expect(auditErrors(audit(doc))).toEqual([]);
}

describe('addIndividual', () => {
  it('returns a new document and leaves the old one alone', () => {
    const { doc, xref } = addIndividual(empty);
    expect(empty.individuals).toEqual([]);
    expect(doc.individuals.map((i) => i.xref)).toEqual([xref]);
  });

  it('allocates an identifier that is free in the whole document', () => {
    const first = addIndividual(empty);
    const second = addIndividual(first.doc);
    expect(second.xref).not.toBe(first.xref);
    expectSound(second.doc);
  });

  it('keeps the fields it was given', () => {
    const { doc } = addIndividual(empty, { sex: 'F', names: [{ value: 'GivenA /SurnameB/' }] });
    expect(doc.individuals[0]).toMatchObject({ sex: 'F' });
    expect(doc.individuals[0]?.names?.[0]?.value).toBe('GivenA /SurnameB/');
  });

  it('produces a document the schema accepts, with a warning and no error', () => {
    // The new person is joined to nobody yet. That is the ordinary first step, so it is a
    // warning: an editor that refused to save here would be refusing its own output.
    const { doc } = addIndividual(empty);
    expectSound(doc);
    expect(audit(doc).map((f) => f.code)).toEqual(['UNCONNECTED_PERSON']);
    expect(isAuditClean(doc)).toBe(true);
  });

  it('keeps the header, the origin and the records it does not touch', () => {
    const rich: GedcomDoc = {
      ...empty,
      header: { gedcomVersion: '5.5.1', sourceSystem: 'GDS' },
      origin: { dialect: '5.5.1', encoding: 'ANSEL' },
      otherRecords: [{ xref: '@S1@', tag: 'SOUR' }],
    };
    const { doc } = addIndividual(rich);
    expect(doc.header).toEqual(rich.header);
    expect(doc.origin).toEqual(rich.origin);
    expect(doc.otherRecords).toEqual(rich.otherRecords);
  });
});

describe('updateIndividual', () => {
  it('replaces the fields named and leaves the others', () => {
    const { doc, xref } = addIndividual(empty, { sex: 'U', names: [{ value: 'GivenA' }] });
    const updated = updateIndividual(doc, xref, { sex: 'F' });
    expect(updated.individuals[0]).toMatchObject({ sex: 'F' });
    expect(updated.individuals[0]?.names?.[0]?.value).toBe('GivenA');
  });

  it('clears a field asked for explicitly', () => {
    const { doc, xref } = addIndividual(empty, { sex: 'U' });
    expect(updateIndividual(doc, xref, { sex: undefined }).individuals[0]).not.toHaveProperty(
      'sex',
    );
  });

  it('leaves the family links alone', () => {
    // Links are not editable through here: they have their own operations, which is what keeps
    // the two sides in step.
    const { doc, husband, family } = household();
    const updated = updateIndividual(doc, husband, { sex: 'X' });
    expect(updated.individuals[0]?.familiesAsSpouse).toEqual([{ xref: family }]);
    expectSound(updated);
  });

  it('refuses a person the document does not contain', () => {
    expect(() => updateIndividual(empty, '@I9@', { sex: 'M' })).toThrow(OperationError);
    expect(() => updateIndividual(empty, '@I9@', { sex: 'M' })).toThrow(/@I9@/);
  });

  it('does not touch the document it was given', () => {
    const { doc, xref } = addIndividual(empty, { sex: 'U' });
    updateIndividual(doc, xref, { sex: 'M' });
    expect(doc.individuals[0]?.sex).toBe('U');
  });
});

describe('createUnion', () => {
  it('records the partners on both sides', () => {
    const { doc, husband, wife, family } = household();
    expect(doc.families[0]).toMatchObject({ xref: family, husband, wife });
    expect(doc.individuals[0]?.familiesAsSpouse).toEqual([{ xref: family }]);
    expect(doc.individuals[1]?.familiesAsSpouse).toEqual([{ xref: family }]);
    expectSound(doc);
  });

  it('records the children on both sides', () => {
    const { doc, child, family } = household();
    expect(doc.families[0]?.children).toEqual([child]);
    expect(doc.individuals[2]?.familiesAsChild).toEqual([{ xref: family }]);
  });

  it('creates an empty family when asked for one', () => {
    const { doc, xref } = createUnion(empty);
    expect(doc.families).toEqual([{ xref }]);
  });

  it('refuses a partner the document does not contain, changing nothing', () => {
    expect(() => createUnion(empty, { husband: '@I9@' })).toThrow(OperationError);
    expect(empty.families).toEqual([]);
  });

  it('numbers families apart from people', () => {
    const { doc } = addIndividual(empty);
    const union = createUnion(doc);
    expect(union.xref).toBe('@F1@');
  });
});

describe('linkChild', () => {
  it('writes the link on both sides', () => {
    const { doc, family } = household();
    const added = addIndividual(doc, { sex: 'M' });
    const linked = linkChild(added.doc, family, added.xref);
    expect(linked.families[0]?.children).toContain(added.xref);
    expect(linked.individuals.find((i) => i.xref === added.xref)?.familiesAsChild).toEqual([
      { xref: family },
    ]);
    expectSound(linked);
  });

  it('keeps the pedigree it was given', () => {
    const { doc, family } = household();
    const added = addIndividual(doc, {});
    const linked = linkChild(added.doc, family, added.xref, { pedigree: 'ADOPTED' });
    expect(linked.individuals.find((i) => i.xref === added.xref)?.familiesAsChild).toEqual([
      { xref: family, pedigree: 'ADOPTED' },
    ]);
    expectSound(linked);
  });

  it('refuses to link the same child twice', () => {
    const { doc, child, family } = household();
    expect(() => linkChild(doc, family, child)).toThrow(OperationError);
  });

  it('refuses a family or a person the document does not contain', () => {
    const { doc, child, family } = household();
    expect(() => linkChild(doc, '@F9@', child)).toThrow(/@F9@/);
    expect(() => linkChild(doc, family, '@I9@')).toThrow(/@I9@/);
  });

  it('refuses to make someone a child of their own descendants', () => {
    // The check is what stops layout being handed a graph it cannot draw, and it has to happen
    // here: once written, the cycle is in the user's document.
    const { doc, husband, child } = household();
    const second = createUnion(doc, { husband: child });
    expect(() => linkChild(second.doc, second.xref, husband)).toThrow(/cycle|ancestor/i);
  });

  it('refuses to make a partner of a family its own child', () => {
    const { doc, husband, family } = household();
    expect(() => linkChild(doc, family, husband)).toThrow(/cycle|ancestor|partner/i);
  });
});

describe('unlinkChild', () => {
  it('removes the link from both sides', () => {
    const { doc, child, family } = household();
    const unlinked = unlinkChild(doc, family, child);
    expect(unlinked.families[0]).not.toHaveProperty('children');
    expect(unlinked.individuals[2]).not.toHaveProperty('familiesAsChild');
    expectSound(unlinked);
  });

  it('drops the empty list rather than leaving one behind', () => {
    // An empty CHIL list is not a family with no children; it is a leftover. Export should not
    // have to know the difference.
    const { doc, child, family } = household();
    expect(unlinkChild(doc, family, child).families[0]?.children).toBeUndefined();
  });

  it('refuses when the person is not a child of that family', () => {
    const { doc, husband, family } = household();
    expect(() => unlinkChild(doc, family, husband)).toThrow(OperationError);
  });
});

describe('setPartner', () => {
  it('fills an empty slot and links back', () => {
    const { doc, xref } = addIndividual(empty);
    const union = createUnion(doc);
    const set = setPartner(union.doc, union.xref, 'WIFE', xref);
    expect(set.families[0]?.wife).toBe(xref);
    expect(set.individuals[0]?.familiesAsSpouse).toEqual([{ xref: union.xref }]);
    expectSound(set);
  });

  it('clears a slot and removes the link the other way', () => {
    const { doc, husband, family } = household();
    const cleared = setPartner(doc, family, 'HUSB', null);
    expect(cleared.families[0]).not.toHaveProperty('husband');
    expect(cleared.individuals.find((i) => i.xref === husband)).not.toHaveProperty(
      'familiesAsSpouse',
    );
    expectSound(cleared);
  });

  it('replaces an occupied slot, unlinking the partner it displaced', () => {
    const { doc, husband, family } = household();
    const added = addIndividual(doc, { sex: 'M' });
    const replaced = setPartner(added.doc, family, 'HUSB', added.xref);
    expect(replaced.families[0]?.husband).toBe(added.xref);
    expect(replaced.individuals.find((i) => i.xref === husband)).not.toHaveProperty(
      'familiesAsSpouse',
    );
    expectSound(replaced);
  });

  it('refuses to make someone the parent of their own ancestor', () => {
    const { doc, husband, child } = household();
    const union = createUnion(doc, { children: [husband] });
    expect(() => setPartner(union.doc, union.xref, 'HUSB', child)).toThrow(/cycle|ancestor/i);
  });

  it('refuses a person the document does not contain', () => {
    const { doc, family } = household();
    expect(() => setPartner(doc, family, 'WIFE', '@I9@')).toThrow(/@I9@/);
  });
});

describe('removeIndividual', () => {
  it('takes the record and every reference to it', () => {
    const { doc, husband, family } = household();
    const removed = removeIndividual(doc, husband);
    expect(removed.individuals.map((i) => i.xref)).not.toContain(husband);
    expect(removed.families.find((f) => f.xref === family)).not.toHaveProperty('husband');
    expectSound(removed);
  });

  it('takes a child out of the family that listed them', () => {
    const { doc, child, family } = household();
    const removed = removeIndividual(doc, child);
    expect(removed.families.find((f) => f.xref === family)?.children).toBeUndefined();
    expectSound(removed);
  });

  it('refuses a person the document does not contain', () => {
    expect(() => removeIndividual(empty, '@I9@')).toThrow(OperationError);
  });
});

describe('removeFamily', () => {
  it('takes the record and the links its members held to it', () => {
    const { doc, family } = household();
    const removed = removeFamily(doc, family);
    expect(removed.families).toEqual([]);
    expect(removed.individuals.every((i) => i.familiesAsSpouse === undefined)).toBe(true);
    expect(removed.individuals.every((i) => i.familiesAsChild === undefined)).toBe(true);
    expectSound(removed);
  });

  it('leaves the people themselves in place', () => {
    const { doc, family } = household();
    expect(removeFamily(doc, family).individuals).toHaveLength(3);
  });

  it('refuses a family the document does not contain', () => {
    expect(() => removeFamily(empty, '@F9@')).toThrow(OperationError);
  });
});

describe('updateFamily', () => {
  it('replaces the fields named and leaves the links alone', () => {
    const { doc, family, husband } = household();
    const updated = updateFamily(doc, family, {
      events: [{ tag: 'MARR', date: { value: '1 JAN 1900' } }],
    });
    expect(updated.families[0]?.events?.[0]?.tag).toBe('MARR');
    expect(updated.families[0]?.husband).toBe(husband);
    expectSound(updated);
  });

  it('refuses a family the document does not contain', () => {
    expect(() => updateFamily(empty, '@F9@', {})).toThrow(OperationError);
  });
});

describe('the invariant every operation holds', () => {
  it('leaves the document schema-valid and free of audit errors, whatever the sequence', () => {
    // The gate for this phase, stated as a property rather than as a list of cases. A refusal is
    // a legitimate outcome -- the point is that the document is never left broken either way.
    const step = fc.constantFrom(
      'addIndividual',
      'createUnion',
      'linkChild',
      'unlinkChild',
      'setPartner',
      'clearPartner',
      'removeIndividual',
      'removeFamily',
    );

    fc.assert(
      fc.property(
        fc.array(fc.tuple(step, fc.nat(6), fc.nat(6)), { maxLength: 30 }),
        (steps) => {
          let doc = empty;
          for (const [operation, a, b] of steps) {
            const person = doc.individuals[a % Math.max(doc.individuals.length, 1)]?.xref;
            const other = doc.individuals[b % Math.max(doc.individuals.length, 1)]?.xref;
            const family = doc.families[a % Math.max(doc.families.length, 1)]?.xref;
            try {
              if (operation === 'addIndividual') doc = addIndividual(doc).doc;
              else if (operation === 'createUnion') doc = createUnion(doc).doc;
              else if (family === undefined) continue;
              else if (operation === 'clearPartner')
                doc = setPartner(doc, family, 'HUSB', null);
              else if (person === undefined || other === undefined) continue;
              else if (operation === 'linkChild') doc = linkChild(doc, family, person);
              else if (operation === 'unlinkChild') doc = unlinkChild(doc, family, person);
              else if (operation === 'setPartner') doc = setPartner(doc, family, 'WIFE', other);
              else if (operation === 'removeIndividual') doc = removeIndividual(doc, person);
              else if (operation === 'removeFamily') doc = removeFamily(doc, family);
            } catch (error) {
              // A refusal leaves the previous document untouched, which the next loop uses.
              if (!(error instanceof OperationError)) throw error;
            }
            expectSound(doc);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
