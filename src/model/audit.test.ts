/**
 * Referential integrity: everything the schema cannot see.
 *
 * `validateDoc()` checks that each record is well-formed on its own. Every fault below passes
 * that check and is still wrong -- a family naming a person who does not exist, a link recorded
 * on one side only, a person who is their own ancestor. The two gates are separate on purpose and
 * export waits for both.
 *
 * **Severity is the load-bearing distinction.** An error is a document this editor would write
 * out incorrectly. A warning is something a genealogist might want to look at and might equally
 * have meant: a person with no family yet, or a child linked to both a birth and an adoptive
 * family. Making those errors would mean `addIndividual` produced a document the tool refused to
 * save, so they are reported and do not block.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { audit, auditErrors, isAuditClean } from './audit.js';
import { validateDoc } from './validate.js';
import type { Family, GedcomDoc, Individual } from './types.js';

const doc = (individuals: Individual[], families: Family[]): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals,
  families,
});

/** A sound two-generation document: both sides of every link agree. */
const sound = doc(
  [
    { xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }] },
    { xref: '@I2@', familiesAsSpouse: [{ xref: '@F1@' }] },
    { xref: '@I3@', familiesAsChild: [{ xref: '@F1@' }] },
  ],
  [{ xref: '@F1@', husband: '@I1@', wife: '@I2@', children: ['@I3@'] }],
);

const codes = (document: GedcomDoc) => audit(document).map((finding) => finding.code);

describe('a sound document', () => {
  it('reports nothing at all', () => {
    expect(audit(sound)).toEqual([]);
    expect(isAuditClean(sound)).toBe(true);
  });

  it('is the same document the schema accepts', () => {
    // The two gates are independent, so the fixture has to satisfy both or the tests below are
    // measuring the wrong thing.
    expect(validateDoc(sound).ok).toBe(true);
  });

  it('reports nothing for an empty document', () => {
    expect(audit(doc([], []))).toEqual([]);
  });
});

describe('dangling pointers', () => {
  it('finds a family naming a person who does not exist', () => {
    const broken = doc([], [{ xref: '@F1@', husband: '@I9@' }]);
    const [finding] = audit(broken);
    expect(finding).toMatchObject({
      code: 'DANGLING_POINTER',
      severity: 'error',
      xref: '@F1@',
    });
    expect(finding?.message).toContain('@I9@');
  });

  it('finds a child pointer with no record behind it', () => {
    expect(codes(doc([], [{ xref: '@F1@', children: ['@I9@'] }]))).toContain(
      'DANGLING_POINTER',
    );
  });

  it('finds a person pointing at a family that does not exist', () => {
    const broken = doc([{ xref: '@I1@', familiesAsChild: [{ xref: '@F9@' }] }], []);
    expect(audit(broken)[0]).toMatchObject({ code: 'DANGLING_POINTER', xref: '@I1@' });
  });

  it('accepts @VOID@, which names no record on purpose', () => {
    // Reporting this would flag every file that uses the standard correctly.
    const voided = doc(
      [{ xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }] }],
      [{ xref: '@F1@', husband: '@I1@', wife: '@VOID@' }],
    );
    expect(audit(voided)).toEqual([]);
  });
});

describe('duplicate identifiers', () => {
  it('finds a person recorded twice', () => {
    const broken = doc([{ xref: '@I1@' }, { xref: '@I1@' }], []);
    expect(codes(broken)).toContain('DUPLICATE_XREF');
  });

  it('finds an identifier shared by records of different kinds', () => {
    // Identifiers are unique across the whole dataset, not within a record type.
    const broken: GedcomDoc = {
      ...doc([{ xref: '@X1@' }], [{ xref: '@X1@' }]),
      otherRecords: [{ xref: '@X1@', tag: 'SOUR' }],
    };
    const finding = audit(broken).find((f) => f.code === 'DUPLICATE_XREF');
    expect(finding).toMatchObject({ severity: 'error', xref: '@X1@' });
  });
});

describe('links recorded on one side only', () => {
  it('finds a family that claims a child who does not claim it back', () => {
    const broken = doc([{ xref: '@I1@' }], [{ xref: '@F1@', children: ['@I1@'] }]);
    const finding = audit(broken).find((f) => f.code === 'ASYMMETRIC_LINK');
    expect(finding).toMatchObject({ severity: 'error' });
    expect(finding?.message).toMatch(/FAMC/);
  });

  it('finds a child who claims a family that does not list them', () => {
    const broken = doc(
      [{ xref: '@I1@', familiesAsChild: [{ xref: '@F1@' }] }],
      [{ xref: '@F1@' }],
    );
    expect(audit(broken).find((f) => f.code === 'ASYMMETRIC_LINK')?.message).toMatch(/CHIL/);
  });

  it('finds a partner link recorded by the family alone', () => {
    const broken = doc([{ xref: '@I1@' }], [{ xref: '@F1@', husband: '@I1@' }]);
    expect(audit(broken).find((f) => f.code === 'ASYMMETRIC_LINK')?.message).toMatch(/FAMS/);
  });

  it('finds a partner link recorded by the person alone', () => {
    const broken = doc(
      [{ xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }] }],
      [{ xref: '@F1@' }],
    );
    const finding = audit(broken).find((f) => f.code === 'ASYMMETRIC_LINK');
    expect(finding?.message).toMatch(/HUSB|WIFE|partner/i);
  });
});

describe('duplicate links', () => {
  it('finds the same child listed twice by one family', () => {
    const broken = doc(
      [{ xref: '@I1@', familiesAsChild: [{ xref: '@F1@' }] }],
      [{ xref: '@F1@', children: ['@I1@', '@I1@'] }],
    );
    expect(codes(broken)).toContain('DUPLICATE_LINK');
  });

  it('finds the same family linked twice by one person', () => {
    const broken = doc(
      [{ xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }, { xref: '@F1@' }] }],
      [{ xref: '@F1@', husband: '@I1@' }],
    );
    expect(codes(broken)).toContain('DUPLICATE_LINK');
  });
});

describe('descent cycles', () => {
  it('finds a person who is their own ancestor', () => {
    const cyclic = doc(
      [
        {
          xref: '@I1@',
          familiesAsSpouse: [{ xref: '@F1@' }],
          familiesAsChild: [{ xref: '@F2@' }],
        },
        {
          xref: '@I2@',
          familiesAsChild: [{ xref: '@F1@' }],
          familiesAsSpouse: [{ xref: '@F2@' }],
        },
      ],
      [
        { xref: '@F1@', husband: '@I1@', children: ['@I2@'] },
        { xref: '@F2@', husband: '@I2@', children: ['@I1@'] },
      ],
    );
    const cycles = audit(cyclic).filter((f) => f.code === 'DESCENT_CYCLE');
    expect(cycles).toHaveLength(2);
    expect(cycles.every((f) => f.severity === 'error')).toBe(true);
    expect(cycles.map((f) => f.xref).sort()).toEqual(['@I1@', '@I2@']);
  });

  it('finds a person recorded as their own parent', () => {
    const cyclic = doc(
      [
        {
          xref: '@I1@',
          familiesAsSpouse: [{ xref: '@F1@' }],
          familiesAsChild: [{ xref: '@F1@' }],
        },
      ],
      [{ xref: '@F1@', husband: '@I1@', children: ['@I1@'] }],
    );
    expect(codes(cyclic)).toContain('DESCENT_CYCLE');
  });

  it('does not mistake a long line of descent for a cycle', () => {
    const deep = doc(
      [
        { xref: '@I1@', familiesAsSpouse: [{ xref: '@F1@' }] },
        {
          xref: '@I2@',
          familiesAsChild: [{ xref: '@F1@' }],
          familiesAsSpouse: [{ xref: '@F2@' }],
        },
        { xref: '@I3@', familiesAsChild: [{ xref: '@F2@' }] },
      ],
      [
        { xref: '@F1@', husband: '@I1@', children: ['@I2@'] },
        { xref: '@F2@', husband: '@I2@', children: ['@I3@'] },
      ],
    );
    expect(codes(deep)).not.toContain('DESCENT_CYCLE');
  });

  it('does not report the descendants of a cycle as cyclic themselves', () => {
    // A child of a cyclic pair is not their own ancestor. Reporting them would bury the two
    // records that actually need fixing under everyone below them.
    const cyclic = doc(
      [
        {
          xref: '@I1@',
          familiesAsSpouse: [{ xref: '@F1@' }],
          familiesAsChild: [{ xref: '@F2@' }],
        },
        {
          xref: '@I2@',
          familiesAsChild: [{ xref: '@F1@' }],
          familiesAsSpouse: [{ xref: '@F2@' }],
        },
        { xref: '@I3@', familiesAsChild: [{ xref: '@F2@' }] },
      ],
      [
        { xref: '@F1@', husband: '@I1@', children: ['@I2@'] },
        { xref: '@F2@', husband: '@I2@', children: ['@I1@', '@I3@'] },
      ],
    );
    const cyclic3 = audit(cyclic).filter(
      (f) => f.code === 'DESCENT_CYCLE' && f.xref === '@I3@',
    );
    expect(cyclic3).toEqual([]);
  });
});

describe('the warnings', () => {
  it('notes a person who belongs to no family, without calling it an error', () => {
    // Adding a person before linking them is the ordinary way to use the editor. If this were an
    // error, the tool would refuse to save the document it had just helped the user create.
    const lone = doc([{ xref: '@I1@' }], []);
    const [finding] = audit(lone);
    expect(finding).toMatchObject({
      code: 'UNCONNECTED_PERSON',
      severity: 'warning',
      xref: '@I1@',
    });
    expect(isAuditClean(lone)).toBe(true);
  });

  it('notes a child of more than one family', () => {
    // Legal in GEDCOM and often correct: a birth family and an adoptive one.
    const adopted = doc(
      [{ xref: '@I1@', familiesAsChild: [{ xref: '@F1@' }, { xref: '@F2@' }] }],
      [
        { xref: '@F1@', children: ['@I1@'] },
        { xref: '@F2@', children: ['@I1@'] },
      ],
    );
    const finding = audit(adopted).find((f) => f.code === 'CHILD_OF_SEVERAL_FAMILIES');
    expect(finding).toMatchObject({ severity: 'warning', xref: '@I1@' });
    expect(finding?.related).toEqual(['@F1@', '@F2@']);
    expect(isAuditClean(adopted)).toBe(true);
  });
});

describe('the report itself', () => {
  it('lists every fault rather than stopping at the first', () => {
    // A user fixing an imported file wants the list, not one problem at a time.
    const broken = doc(
      [{ xref: '@I1@' }, { xref: '@I1@' }],
      [{ xref: '@F1@', husband: '@I9@' }],
    );
    expect(audit(broken).length).toBeGreaterThan(1);
  });

  it('separates the errors from the warnings', () => {
    const mixed = doc([{ xref: '@I1@' }], [{ xref: '@F1@', husband: '@I9@' }]);
    const findings = audit(mixed);
    expect(findings.some((f) => f.severity === 'warning')).toBe(true);
    expect(auditErrors(findings).every((f) => f.severity === 'error')).toBe(true);
    expect(isAuditClean(mixed)).toBe(false);
  });

  it('is deterministic', () => {
    const broken = doc(
      [{ xref: '@I1@' }],
      [{ xref: '@F1@', husband: '@I9@', children: ['@I8@'] }],
    );
    expect(audit(broken)).toEqual(audit(broken));
  });
});
