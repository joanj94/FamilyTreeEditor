/**
 * The dialect mappers: parse tree in, document out.
 *
 * The property that matters most is not that a tag is understood -- it is that a tag which is
 * *not* understood still arrives at the other end. Several tests below check what happens to
 * structures this mapper has no opinion about, because that is where a round trip is lost.
 *
 * Every fixture is written for the case it tests. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { importGedcom, toDocument } from './mapper.js';
import { parseGedcom } from './parse.js';
import { validateDoc } from '../model/validate.js';
import { makeTranslate } from '../i18n/catalog.js';
import { EN } from '../i18n/keys.js';

/* These suites assert English prose. The catalog is asked for it explicitly rather than
   through a provider, so a change of default language never silently rewrites them. */
const say = makeTranslate('en', EN);

const map = (text: string) => toDocument(parseGedcom(text).records);

const HEAD7 = '0 HEAD\n1 GEDC\n2 VERS 7.0\n';

describe('the header', () => {
  it('reads the version the file declares', () => {
    const { doc } = map(`${HEAD7}0 TRLR\n`);
    expect(doc.header.gedcomVersion).toBe('7.0');
    expect(doc.origin?.dialect).toBe('7.0');
    expect(doc.origin?.dialectInferred).toBeUndefined();
  });

  it('recognises 5.5.1', () => {
    const { doc } = map('0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR ANSEL\n0 TRLR\n');
    expect(doc.origin?.dialect).toBe('5.5.1');
  });

  it('infers a dialect when the file declares none, and says that it guessed', () => {
    // A guess is surfaced rather than kept quiet: the user can tell the tool it is wrong, but
    // only if the tool admits it was guessing.
    const { doc, issues } = map('0 HEAD\n1 CHAR ANSEL\n0 TRLR\n');
    expect(doc.origin?.dialect).toBe('5.5.1');
    expect(doc.origin?.dialectInferred).toBe(true);
    expect(issues.some((i) => /version/i.test(say(i.message)))).toBe(true);
  });

  it('reads the source system and its parts', () => {
    const { doc } = map(
      '0 HEAD\n1 GEDC\n2 VERS 7.0\n1 SOUR GDS\n2 NAME Placeholder\n2 VERS 9.0.28\n',
    );
    expect(doc.header).toMatchObject({
      sourceSystem: 'GDS',
      sourceName: 'Placeholder',
      sourceVersion: '9.0.28',
    });
  });

  it('keeps header substructures it does not model', () => {
    // CHAR belongs to 5.5.1 and has no place in the 7 header, but throwing it away would mean a
    // 5.5.1 file could not be written back as it arrived.
    const { doc } = map('0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR ANSEL\n0 TRLR\n');
    expect(doc.header.extensions).toEqual([{ tag: 'CHAR', payload: 'ANSEL' }]);
  });
});

describe('individuals', () => {
  it('maps a name and its pieces', () => {
    const { doc } = map(
      `${HEAD7}0 @I1@ INDI\n1 NAME GivenA /SurnameA/\n2 GIVN GivenA\n2 SURN SurnameA\n2 TYPE BIRTH\n`,
    );
    expect(doc.individuals[0]?.names?.[0]).toEqual({
      value: 'GivenA /SurnameA/',
      type: 'BIRTH',
      given: ['GivenA'],
      surname: ['SurnameA'],
    });
  });

  it('keeps two surnames as two pieces', () => {
    // The standard allows SURN more than once, which is how a two-surname name is expressed. No
    // invented field, and no convention about which half goes where.
    const { doc } = map(
      `${HEAD7}0 @I1@ INDI\n1 NAME GivenC /SurnameA/\n2 SURN SurnameA\n2 SURN SurnameB\n`,
    );
    expect(doc.individuals[0]?.names?.[0]?.surname).toEqual(['SurnameA', 'SurnameB']);
  });

  it('maps sex, including the value GEDCOM 7 added', () => {
    const { doc } = map(`${HEAD7}0 @I1@ INDI\n1 SEX X\n`);
    expect(doc.individuals[0]?.sex).toBe('X');
  });

  it('reports a sex value it does not know, and keeps the line', () => {
    const { doc, issues } = map(`${HEAD7}0 @I1@ INDI\n1 SEX Q\n`);
    expect(doc.individuals[0]?.sex).toBeUndefined();
    expect(issues.some((i) => i.observed === 'Q')).toBe(true);
    expect(doc.individuals[0]?.extensions).toEqual([{ tag: 'SEX', payload: 'Q' }]);
  });

  it('maps an event with its date and place', () => {
    const { doc } = map(
      `${HEAD7}0 @I1@ INDI\n1 BIRT\n2 DATE ABT 1901\n2 PLAC Placeholder, Placeholder\n`,
    );
    expect(doc.individuals[0]?.events?.[0]).toEqual({
      tag: 'BIRT',
      date: {
        value: 'ABT 1901',
        kind: 'APPROXIMATE',
        modifier: 'ABT',
        start: { calendar: 'GREGORIAN', year: 1901 },
      },
      place: { text: 'Placeholder, Placeholder' },
    });
  });

  it('reads a bare Y as the assertion that the event happened', () => {
    const { doc } = map(`${HEAD7}0 @I1@ INDI\n1 DEAT Y\n`);
    expect(doc.individuals[0]?.events?.[0]).toEqual({ tag: 'DEAT', occurred: true });
  });

  it('maps an attribute, which carries a value where an event does not', () => {
    const { doc } = map(`${HEAD7}0 @I1@ INDI\n1 OCCU PlaceholderOccupation\n2 DATE 1901\n`);
    expect(doc.individuals[0]?.attributes?.[0]).toMatchObject({
      tag: 'OCCU',
      value: 'PlaceholderOccupation',
    });
    expect(doc.individuals[0]?.events).toBeUndefined();
  });

  it('maps the links to families, with pedigree and status', () => {
    const { doc } = map(
      `${HEAD7}0 @I1@ INDI\n1 FAMC @F1@\n2 PEDI ADOPTED\n2 STAT PROVEN\n1 FAMS @F2@\n`,
    );
    expect(doc.individuals[0]?.familiesAsChild).toEqual([
      { xref: '@F1@', pedigree: 'ADOPTED', status: 'PROVEN' },
    ]);
    expect(doc.individuals[0]?.familiesAsSpouse).toEqual([{ xref: '@F2@' }]);
  });

  it('reads a restriction list', () => {
    const { doc } = map(`${HEAD7}0 @I1@ INDI\n1 RESN CONFIDENTIAL, LOCKED\n`);
    expect(doc.individuals[0]?.restriction).toEqual(['CONFIDENTIAL', 'LOCKED']);
  });

  it('keeps every structure it does not model, nesting and order intact', () => {
    const { doc } = map(
      `${HEAD7}0 @I1@ INDI\n1 NOTE placeholder\n2 LANG en\n1 _UID PLACEHOLDER\n1 SOUR @S1@\n`,
    );
    expect(doc.individuals[0]?.extensions).toEqual([
      { tag: 'NOTE', payload: 'placeholder', children: [{ tag: 'LANG', payload: 'en' }] },
      { tag: '_UID', payload: 'PLACEHOLDER' },
      { tag: 'SOUR', payload: '@S1@' },
    ]);
  });
});

describe('families', () => {
  it('maps partners, children and an event', () => {
    const { doc } = map(
      `${HEAD7}0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 CHIL @I3@\n1 CHIL @I4@\n1 MARR\n2 DATE 1901\n`,
    );
    expect(doc.families[0]).toMatchObject({
      xref: '@F1@',
      husband: '@I1@',
      wife: '@I2@',
      children: ['@I3@', '@I4@'],
    });
    expect(doc.families[0]?.events?.[0]?.tag).toBe('MARR');
  });

  it('maps the ages recorded against a family event', () => {
    const { doc } = map(`${HEAD7}0 @F1@ FAM\n1 MARR\n2 HUSB\n3 AGE 30y\n2 WIFE\n3 AGE 28y\n`);
    expect(doc.families[0]?.events?.[0]).toMatchObject({ husbandAge: '30y', wifeAge: '28y' });
  });
});

describe('records as a whole', () => {
  it('keeps a record type it does not model, verbatim', () => {
    const { doc } = map(`${HEAD7}0 @S1@ SOUR\n1 TITL placeholder\n0 TRLR\n`);
    expect(doc.otherRecords).toEqual([
      { xref: '@S1@', tag: 'SOUR', children: [{ tag: 'TITL', payload: 'placeholder' }] },
    ]);
  });

  it('drops the trailer, which carries nothing', () => {
    const { doc } = map(`${HEAD7}0 TRLR\n`);
    expect(doc.otherRecords ?? []).toEqual([]);
  });

  it('reports a record with no identifier that is not HEAD or TRLR', () => {
    const { issues } = map(`${HEAD7}0 SOUR\n`);
    expect(issues.some((i) => /identifier/i.test(say(i.message)))).toBe(true);
  });

  it('produces a document that satisfies the schema', () => {
    // The mapper's output is the contract's input. If these two ever disagree, everything
    // downstream inherits the disagreement.
    const { doc } = map(
      `${HEAD7}0 @I1@ INDI\n1 NAME GivenA /SurnameA/\n2 SURN SurnameA\n2 SURN SurnameB\n1 SEX M\n1 BIRT\n2 DATE ABT 1901\n1 FAMS @F1@\n1 _UID X\n` +
        `0 @I2@ INDI\n1 SEX F\n1 FAMS @F1@\n` +
        `0 @F1@ FAM\n1 HUSB @I1@\n1 WIFE @I2@\n1 MARR Y\n` +
        `0 @S1@ SOUR\n1 TITL placeholder\n0 TRLR\n`,
    );
    const result = validateDoc(doc);
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
    expect(result.ok).toBe(true);
  });
});

describe('importGedcom', () => {
  it('decodes, parses and maps in one call', () => {
    const bytes = new TextEncoder().encode(`${HEAD7}0 @I1@ INDI\n1 SEX M\n0 TRLR\n`);
    const { doc, issues } = importGedcom(bytes, 'placeholder.ged');
    expect(issues).toEqual([]);
    expect(doc.individuals).toHaveLength(1);
    expect(doc.origin).toMatchObject({ encoding: 'UTF-8', fileName: 'placeholder.ged' });
  });

  it('carries an ANSEL name through to the document intact', () => {
    // The end-to-end case the encoding work exists for: bytes in, correct letters out.
    const head = new TextEncoder().encode(
      '0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR ANSEL\n0 @I1@ INDI\n1 NAME ',
    );
    const tail = new TextEncoder().encode('\n0 TRLR\n');
    const bytes = Uint8Array.from([...head, 0xe2, 0x65, ...tail]); // acute, then `e`
    const { doc } = importGedcom(bytes);
    expect(doc.individuals[0]?.names?.[0]?.value).toBe('é');
    expect(doc.origin?.encoding).toBe('ANSEL');
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Tags that collide with Object.prototype.
 *
 * Two separate defences, tested separately because either one could be removed by somebody who
 * believed the other was doing the work.
 *
 * The lexer refuses a tag outside GEDCOM's grammar, so `2 constructor Foo` never becomes a
 * structure at all. And the mapper reads its name-piece table with `Object.hasOwn`, so even a
 * structure that arrives by some other route cannot be mistaken for a `GIVN`.
 *
 * Without the second, a plain object answered `constructor` from its prototype and the mapper
 * built a name carrying a key named after a function -- which failed the schema, and since the
 * editor validates before every command, made every later edit refuse.
 * ------------------------------------------------------------------------------------------- */
const fromText = (text: string) => importGedcom(new TextEncoder().encode(text));

describe('tags that share a name with something on Object.prototype', () => {
  for (const tag of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    it(`refuses ${tag} at the lexer and says so`, () => {
      const { doc, issues } = fromText(
        `${HEAD7}0 @I1@ INDI
1 NAME GivenA /SurnameB/
2 ${tag} Foo
0 TRLR
`,
      );

      expect(issues.some((issue) => issue.observed === tag)).toBe(true);
      // No invented field, and no structure kept under a tag the standard cannot express.
      expect(Object.keys(doc.individuals[0]?.names?.[0] ?? {})).toEqual(['value']);
      expect(validateDoc(doc).ok).toBe(true);
    });
  }

  it('does not mistake one for a name piece even when it reaches the mapper directly', () => {
    // Straight to `toDocument`, so the lexer's guard is not the thing under test here.
    const { doc } = toDocument([
      {
        xref: '@I1@',
        tag: 'INDI',
        children: [
          {
            tag: 'NAME',
            payload: 'GivenA /SurnameB/',
            children: [{ tag: 'constructor', payload: 'Foo' }],
          },
        ],
      },
    ]);

    const name = doc.individuals[0]?.names?.[0];
    expect(Object.keys(name ?? {}).sort()).toEqual(['extensions', 'value']);
    expect(name?.extensions).toEqual([{ tag: 'constructor', payload: 'Foo' }]);
  });

  it('still reads the real name pieces', () => {
    const { doc } = map(
      `${HEAD7}0 @I1@ INDI
1 NAME GivenA /SurnameB/
2 GIVN GivenA
2 SURN SurnameB
0 TRLR
`,
    );
    expect(doc.individuals[0]?.names?.[0]).toMatchObject({
      given: ['GivenA'],
      surname: ['SurnameB'],
    });
  });
});

describe('the tag grammar', () => {
  it('keeps an extension tag, which is what an underscore is for', () => {
    const { doc, issues } = fromText(`${HEAD7}0 @I1@ INDI
1 _UID INVENTED-0001
0 TRLR
`);
    expect(issues).toEqual([]);
    expect(doc.individuals[0]?.extensions).toEqual([{ tag: '_UID', payload: 'INVENTED-0001' }]);
  });

  it('skips a lower-case tag and carries on with the rest of the file', () => {
    // One malformed line should cost that line, not the import.
    const { doc, issues } = fromText(`${HEAD7}0 @I1@ INDI
1 lowercase x
1 SEX F
0 TRLR
`);
    expect(issues).toHaveLength(1);
    expect(doc.individuals[0]?.sex).toBe('F');
  });
});
