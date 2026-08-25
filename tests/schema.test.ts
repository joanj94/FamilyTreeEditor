/**
 * The contract is present, it compiles, and the types in `src/model/types.ts` describe the same
 * document `schema/gedcom7.schema.json` accepts.
 *
 * The types are a hand-maintained mirror of the schema, so something has to hold the two
 * together. These tests are that something: a tag renamed in one and not the other, or an
 * enumeration that gains a member on only one side, fails here rather than surfacing as a runtime
 * surprise much later. Since both sides mirror GEDCOM 7, a divergence between them is usually a
 * divergence from the standard.
 *
 * Values here are structural placeholders -- `@I1@`, `GivenA`, `SurnameB`. Real genealogy data
 * does not enter this repository, down to the single record, and neither do real dates or real
 * record counts.
 */
import { describe, expect, it } from 'vitest';

import { assertValidDoc, schema, validateDoc } from '../src/model/validate.js';
import type {
  ChildStatus,
  DateKind,
  DateModifier,
  FamilyAttributeTag,
  FamilyEventTag,
  GedcomDoc,
  IndividualAttributeTag,
  IndividualEventTag,
  NameType,
  Pedigree,
  Restriction,
  Sex,
} from '../src/model/types.js';
import { VOID_POINTER, XREF_PATTERN } from '../src/model/types.js';

/** The smallest document the schema accepts: a header stating the version, and nothing else. */
const minimalDoc: GedcomDoc = {
  header: { gedcomVersion: '7.0' },
  individuals: [],
  families: [],
};

describe('the contract', () => {
  it('is this repository’s own schema', () => {
    expect(schema.$id).toContain('/FamilyTreeEditor/');
    expect(schema.$id).toMatch(/gedcom7\.schema\.json$/);
  });

  it('requires only what the standard requires of a header', () => {
    // GEDCOM 7 mandates exactly one substructure of HEAD: GEDC.VERS. Requiring more here would
    // reject files the standard calls valid.
    expect(schema.$defs.header.required).toEqual(['gedcomVersion']);
  });
});

describe('validateDoc', () => {
  it('accepts a minimal document', () => {
    expect(validateDoc(minimalDoc).ok).toBe(true);
  });

  it('accepts individuals, families and the links between them', () => {
    const doc: GedcomDoc = {
      ...minimalDoc,
      individuals: [
        {
          xref: '@I1@',
          names: [
            {
              value: 'GivenA /SurnameA/',
              type: 'BIRTH',
              given: ['GivenA'],
              surname: ['SurnameA'],
            },
          ],
          sex: 'M',
          events: [
            { tag: 'BIRT', date: { value: 'ABT 1901', kind: 'APPROXIMATE', modifier: 'ABT' } },
          ],
          familiesAsSpouse: [{ xref: '@F1@' }],
        },
        {
          xref: '@I2@',
          names: [{ value: 'GivenB /SurnameB/', given: ['GivenB'], surname: ['SurnameB'] }],
          sex: 'F',
          attributes: [{ tag: 'OCCU', value: 'PlaceholderOccupation' }],
          familiesAsSpouse: [{ xref: '@F1@' }],
        },
        {
          // A name carrying two surnames needs no invented field: the standard allows SURN more
          // than once, so the second surname is simply a second piece.
          xref: '@I3@',
          names: [
            {
              value: 'GivenC /SurnameA/',
              given: ['GivenC'],
              surname: ['SurnameA', 'SurnameB'],
            },
          ],
          familiesAsChild: [{ xref: '@F1@', pedigree: 'BIRTH', status: 'PROVEN' }],
        },
      ],
      families: [
        {
          xref: '@F1@',
          husband: '@I1@',
          wife: '@I2@',
          children: ['@I3@'],
          events: [{ tag: 'MARR', occurred: true }],
        },
      ],
    };
    expect(validateDoc(doc).ok).toBe(true);
  });

  it('rejects an identifier that does not match the standard’s xref grammar', () => {
    // Lower case is outside `tagchar`, which the spec limits to upper-case letters, digits and
    // underscore.
    const result = validateDoc({ ...minimalDoc, individuals: [{ xref: '@i1@' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path === '/individuals/0/xref')).toBe(true);
  });

  it('rejects a record identifying itself as @VOID@, but accepts @VOID@ as a pointer', () => {
    // The standard defines @VOID@ as a deliberate reference to no record, so it is a legitimate
    // pointer and never a legitimate identifier. Conflating the two would let a document claim a
    // record that cannot exist.
    expect(validateDoc({ ...minimalDoc, individuals: [{ xref: VOID_POINTER }] }).ok).toBe(
      false,
    );
    expect(
      validateDoc({
        ...minimalDoc,
        families: [{ xref: '@F1@', husband: VOID_POINTER, children: ['@I1@'] }],
      }).ok,
    ).toBe(true);
  });

  it('rejects an event tag the standard does not define', () => {
    const result = validateDoc({
      ...minimalDoc,
      individuals: [{ xref: '@I1@', events: [{ tag: 'BIRTHDAY' }] }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an individual attribute used as an event', () => {
    // OCCU is an attribute, not an event: it states a value rather than that something happened.
    // The standard separates the two, so the schema does too.
    expect(
      validateDoc({ ...minimalDoc, individuals: [{ xref: '@I1@', events: [{ tag: 'OCCU' }] }] })
        .ok,
    ).toBe(false);
  });

  it('requires a date to carry the payload it was parsed from', () => {
    // Without `value` there is nothing to write back on export, so a parsed date with no payload
    // is a lossy date.
    const result = validateDoc({
      ...minimalDoc,
      individuals: [
        {
          xref: '@I1@',
          events: [{ tag: 'BIRT', date: { kind: 'EXACT', start: { year: 1901 } } }],
        },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts a date it could not parse, so long as the payload survives', () => {
    // An unparseable date is not an error. It exports byte-identical, which is the whole point.
    const doc = {
      ...minimalDoc,
      individuals: [
        {
          xref: '@I1@',
          events: [
            {
              tag: 'BIRT',
              date: {
                value: 'placeholder phrase',
                kind: 'UNPARSED',
                phrase: 'placeholder phrase',
              },
            },
          ],
        },
      ],
    };
    expect(validateDoc(doc).ok).toBe(true);
  });

  it('cannot express a precision the source did not state', () => {
    // A date known only to its year has no month and no day, so `ABT 1901` has no way to become
    // `1901-01-01`. The impossibility is structural rather than a rule someone has to remember.
    const yearOnly = {
      ...minimalDoc,
      individuals: [
        {
          xref: '@I1@',
          events: [{ tag: 'BIRT', date: { value: 'ABT 1901', start: { year: 1901 } } }],
        },
      ],
    };
    expect(validateDoc(yearOnly).ok).toBe(true);
    expect(Object.keys(schema.$defs.calendarDate.properties)).toEqual([
      'calendar',
      'year',
      'month',
      'day',
      'epoch',
    ]);
  });

  it('preserves structures it does not model, nested and in order', () => {
    const doc = {
      ...minimalDoc,
      individuals: [
        {
          xref: '@I1@',
          extensions: [
            { tag: '_UID', payload: 'PLACEHOLDER-UID' },
            { tag: 'NOTE', payload: 'placeholder', children: [{ tag: 'LANG', payload: 'en' }] },
            {
              tag: 'SOUR',
              payload: '@S1@',
              children: [{ tag: 'PAGE', payload: 'placeholder' }],
            },
          ],
        },
      ],
      otherRecords: [
        { xref: '@S1@', tag: 'SOUR', children: [{ tag: 'TITL', payload: 'placeholder' }] },
      ],
    };
    expect(validateDoc(doc).ok).toBe(true);
  });

  it('distinguishes a line with no payload from one whose payload is empty', () => {
    const doc = {
      ...minimalDoc,
      individuals: [{ xref: '@I1@', extensions: [{ tag: '_FLAG', payload: null }] }],
    };
    expect(validateDoc(doc).ok).toBe(true);
  });

  it('rejects unknown properties rather than dropping them', () => {
    // Silently ignoring a property the schema does not know is how a typo becomes data loss.
    expect(validateDoc({ ...minimalDoc, surprise: true }).ok).toBe(false);
    expect(
      validateDoc({ ...minimalDoc, individuals: [{ xref: '@I1@', nickname: 'x' }] }).ok,
    ).toBe(false);
  });

  it('reports the observed value, not just the location', () => {
    // An error that says only "must match pattern" leaves the user guessing which record in a
    // file of hundreds is wrong.
    const result = validateDoc({ ...minimalDoc, individuals: [{ xref: 'nope' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const idError = result.errors.find((e) => e.path === '/individuals/0/xref');
    expect(idError?.observed).toBe('nope');
  });
});

describe('assertValidDoc', () => {
  it('returns the narrowed document when valid', () => {
    expect(assertValidDoc(minimalDoc)).toBe(minimalDoc);
  });

  it('throws with the offending path and value in the message', () => {
    expect(() => assertValidDoc({ ...minimalDoc, individuals: [{ xref: 'nope' }] })).toThrow(
      /\/individuals\/0\/xref.*nope/s,
    );
  });
});

describe('types mirror the schema', () => {
  /**
   * Each case asserts that the union type and the schema enumeration have identical members. The
   * `satisfies` clause makes the compiler check the array against the TypeScript union, and the
   * runtime comparison checks it against the schema -- so the two can only agree.
   */
  const cases: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
    [
      'individual.sex',
      ['M', 'F', 'X', 'U'] satisfies Sex[],
      schema.$defs.individual.properties.sex.enum,
    ],
    [
      'name.type',
      [
        'AKA',
        'BIRTH',
        'IMMIGRANT',
        'MAIDEN',
        'MARRIED',
        'PROFESSIONAL',
        'OTHER',
      ] satisfies NameType[],
      schema.$defs.name.properties.type.enum,
    ],
    [
      'date.kind',
      ['EXACT', 'APPROXIMATE', 'RANGE', 'PERIOD', 'UNPARSED'] satisfies DateKind[],
      schema.$defs.date.properties.kind.enum,
    ],
    [
      'date.modifier',
      ['ABT', 'CAL', 'EST', 'BEF', 'AFT', 'BET', 'FROM', 'TO'] satisfies DateModifier[],
      schema.$defs.date.properties.modifier.enum,
    ],
    [
      'individualEvent.tag',
      [
        'BIRT',
        'CHR',
        'DEAT',
        'BURI',
        'CREM',
        'ADOP',
        'BAPM',
        'BARM',
        'BASM',
        'BLES',
        'CHRA',
        'CONF',
        'FCOM',
        'ORDN',
        'NATU',
        'EMIG',
        'IMMI',
        'CENS',
        'PROB',
        'WILL',
        'GRAD',
        'RETI',
        'EVEN',
      ] satisfies IndividualEventTag[],
      schema.$defs.individualEvent.properties.tag.enum,
    ],
    [
      'individualAttribute.tag',
      [
        'CAST',
        'DSCR',
        'EDUC',
        'IDNO',
        'NATI',
        'NCHI',
        'NMR',
        'OCCU',
        'PROP',
        'RELI',
        'RESI',
        'TITL',
        'FACT',
      ] satisfies IndividualAttributeTag[],
      schema.$defs.individualAttribute.properties.tag.enum,
    ],
    [
      'familyEvent.tag',
      [
        'ANUL',
        'CENS',
        'DIV',
        'DIVF',
        'ENGA',
        'MARB',
        'MARC',
        'MARL',
        'MARR',
        'MARS',
        'EVEN',
      ] satisfies FamilyEventTag[],
      schema.$defs.familyEvent.properties.tag.enum,
    ],
    [
      'familyAttribute.tag',
      ['NCHI', 'RESI', 'FACT'] satisfies FamilyAttributeTag[],
      schema.$defs.familyAttribute.properties.tag.enum,
    ],
    [
      'familyLinkAsChild.pedigree',
      ['ADOPTED', 'BIRTH', 'FOSTER', 'SEALING', 'OTHER'] satisfies Pedigree[],
      schema.$defs.familyLinkAsChild.properties.pedigree.enum,
    ],
    [
      'familyLinkAsChild.status',
      ['CHALLENGED', 'DISPROVEN', 'PROVEN'] satisfies ChildStatus[],
      schema.$defs.familyLinkAsChild.properties.status.enum,
    ],
    [
      'restriction',
      ['CONFIDENTIAL', 'LOCKED', 'PRIVACY'] satisfies Restriction[],
      schema.$defs.restriction.items.enum,
    ],
  ];

  it.each(cases)('%s matches', (_label, fromTypes, fromSchema) => {
    expect([...fromTypes].sort()).toEqual([...fromSchema].sort());
  });

  it('xref grammar matches the schema', () => {
    expect(XREF_PATTERN.source).toBe(schema.$defs.xref.pattern);
    expect(XREF_PATTERN.source).toBe(schema.$defs.pointer.pattern);
  });

  it('names every personal name piece the standard defines', () => {
    // NPFX, GIVN, NICK, SPFX, SURN, NSFX. Each is a list because each may repeat.
    const pieces = [
      'prefix',
      'given',
      'nickname',
      'surnamePrefix',
      'surname',
      'suffix',
    ] as const;
    for (const piece of pieces) {
      expect(schema.$defs.name.properties[piece].type).toBe('array');
    }
  });
});
