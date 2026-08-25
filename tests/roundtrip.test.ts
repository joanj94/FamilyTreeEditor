/**
 * The spine of the project: `import(export(import(file)))` equals `import(file)`.
 *
 * Everything else this tool does is a convenience. This is the promise -- that opening someone's
 * file and saving it back does not quietly take anything out of it. A genealogy file is often the
 * only copy of work that took years, and the user has no way to notice a missing `_UID` or a
 * dropped source record until long after the original is gone.
 *
 * **What the equality is over.** The *document*, not the bytes. A value split across `CONC` lines
 * at different points says the same thing; attributes written before events where the source
 * interleaved them says the same thing. Insisting on bytes would mean reproducing the previous
 * program's formatting habits, which is a different and much less useful promise.
 *
 * **The two exclusions, both about the file rather than about anybody in it.** `origin` records
 * how the document was obtained -- the name and encoding of the file it came from -- and a file
 * written here is a different file. `HEAD.CHAR` declares the encoding of the bytes, and the
 * serializer owns it because it is the thing that produced them. Neither describes a person, and
 * both are asserted directly in `serialize.test.ts` rather than waved away here.
 *
 * Every fixture is invented. No real genealogy data enters this repository.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { parseDateValue } from '../src/gedcom/dates.js';
import { importGedcom } from '../src/gedcom/mapper.js';
import { exportGedcom, exportJson, type ExportDialect } from '../src/gedcom/serialize.js';
import { addChild, apply, editPerson } from '../src/editor/commands.js';
import { begin } from '../src/editor/history.js';
import { audit } from '../src/model/audit.js';
import { validateDoc } from '../src/model/validate.js';
import type {
  GedcomDoc,
  Individual,
  IndividualEvent,
  IndividualEventTag,
  GenName,
  Sex,
  Structure,
} from '../src/model/types.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

/**
 * The part of a document a round trip has to preserve exactly: everybody in the file.
 *
 * `origin` and `HEAD.CHAR` are dropped for the reasons in the module comment. Nothing else is.
 */
function content(doc: GedcomDoc): unknown {
  const { extensions, ...header } = doc.header;
  const kept = (extensions ?? []).filter((child) => child.tag !== 'CHAR');
  return {
    header: { ...header, ...(kept.length === 0 ? {} : { extensions: kept }) },
    individuals: doc.individuals,
    families: doc.families,
    otherRecords: doc.otherRecords ?? [],
  };
}

interface Trip {
  readonly after: GedcomDoc;
  readonly text: string;
  readonly notes: readonly { readonly message: string }[];
  readonly issues: readonly { readonly message: string }[];
}

/** Export a document and read the result back. */
function trip(doc: GedcomDoc, dialect: ExportDialect): Trip {
  const exported = exportGedcom(doc, { dialect });
  const reread = importGedcom(bytes(exported.text));
  return {
    after: reread.doc,
    text: exported.text,
    notes: exported.notes,
    issues: reread.issues,
  };
}

const FIXTURES: readonly { readonly file: string; readonly dialect: ExportDialect }[] = [
  { file: 'minimal7.ged', dialect: '7.0' },
  { file: 'awkward7.ged', dialect: '7.0' },
  { file: 'awkward551.ged', dialect: '5.5.1' },
];

describe('the round trip, over the fixture corpus', () => {
  for (const { file, dialect } of FIXTURES) {
    describe(file, () => {
      const first = importGedcom(fixture(file), file);
      const round = trip(first.doc, dialect);

      it('says exactly the same thing after a round trip', () => {
        expect(content(round.after)).toEqual(content(first.doc));
      });

      it('writes a file that reads back with the same issues and no new ones', () => {
        // A round trip that is faithful but produces a file the next reader complains about has
        // solved half the problem. Equality rather than emptiness, because a fixture may contain
        // something the importer is right to remark on -- 5.5.1 left NAME.TYPE unconstrained, and
        // a value outside the 7 enumeration is reported and kept, on the way in and again on the
        // way back. What must not appear is a complaint this serializer caused.
        expect(round.issues).toEqual(first.issues);
      });

      it('is stable: a second round trip changes nothing further', () => {
        expect(content(trip(round.after, dialect).after)).toEqual(content(round.after));
      });

      it('still declares the dialect it was written in', () => {
        expect(round.after.origin?.dialect).toBe(dialect);
      });

      it('loses nothing worth reporting when written in its own dialect', () => {
        expect(round.notes).toEqual([]);
      });

      it('round-trips through JSON as well, and the JSON validates', () => {
        const parsed: unknown = JSON.parse(exportJson(first.doc));
        expect(validateDoc(parsed).ok).toBe(true);
        expect(parsed).toEqual(first.doc);
      });
    });
  }
});

describe('what the awkward corners actually contain', () => {
  // Guards against the corpus quietly losing its teeth: a round trip over a file with nothing
  // difficult in it proves nothing, and fixtures get trimmed by people tidying up.
  const doc = importGedcom(fixture('awkward7.ged'), 'awkward7.ged').doc;
  const person = doc.individuals[0];

  it('has a name carrying two surnames', () => {
    expect(person?.names?.[0]?.surname).toEqual(['Primera', 'Segona']);
  });

  it('has structures the model does not describe, kept against their record', () => {
    expect(person?.extensions?.map((child) => child.tag)).toEqual(['NOTE', '_UID', '_AT']);
  });

  it('has whole records outside the model, kept intact', () => {
    expect(doc.otherRecords?.map((record) => record.tag)).toEqual(['SUBM', 'SOUR']);
  });

  it('has a payload that begins with an at sign', () => {
    const at = person?.extensions?.find((child) => child.tag === '_AT');
    expect(at?.payload).toBe('@this payload begins with an at sign');
  });

  it('has a multi-line value folded out of CONT', () => {
    const note = person?.extensions?.find((child) => child.tag === 'NOTE');
    expect(note?.payload).toContain('\n');
  });

  it('has an event whose payload is text rather than Y', () => {
    const even = person?.events?.find((event) => event.tag === 'EVEN');
    expect(even?.value).toBe('Awarded a prize nobody recorded the date of');
    expect(even?.occurred).toBeUndefined();
  });

  it('has a date carrying a phrase the grammar could not express', () => {
    const birth = person?.events?.find((event) => event.tag === 'BIRT');
    expect(birth?.date?.phrase).toBe('around the turn of the century');
  });
});

describe('the file this tool writes', () => {
  const { text } = exportGedcom(importGedcom(fixture('awkward7.ged')).doc, { dialect: '7.0' });
  const lines = text.split('\n').slice(0, -1);

  it('opens with a header and closes with a trailer', () => {
    expect(lines[0]).toBe('0 HEAD');
    expect(lines.at(-1)).toBe('0 TRLR');
  });

  it('declares the version, which is the one thing GEDCOM 7 requires of a header', () => {
    expect(lines.slice(0, 4)).toContain('2 VERS 7.0');
  });

  it('never skips a level', () => {
    // A level more than one deeper than its parent is the parse issue that costs a substructure
    // its place in the tree, and the reader can only guess where it belonged.
    let previous = -1;
    for (const line of lines) {
      const level = Number.parseInt(line.slice(0, line.indexOf(' ')), 10);
      expect(level).toBeLessThanOrEqual(previous + 1);
      previous = level;
    }
  });

  it('uses no CONC, which GEDCOM 7 removed', () => {
    expect(lines.some((line) => / CONC( |$)/.test(line))).toBe(false);
  });

  it('points only at records the file contains, or at VOID', () => {
    const declared = new Set(
      lines
        .filter((line) => line.startsWith('0 @'))
        .map((line) => line.slice(2, line.indexOf('@', 3) + 1)),
    );
    const pointers = lines
      .map((line) => /^\d+ [A-Z_][A-Z0-9_]* (@[A-Z0-9_]+@)$/.exec(line)?.[1])
      .filter((pointer): pointer is string => pointer !== undefined);
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) {
      if (pointer !== '@VOID@') expect(declared.has(pointer)).toBe(true);
    }
  });
});

describe('an edited document', () => {
  // Phase 5's gate meeting Phase 6's: an edit that passed the schema and the audit has to survive
  // being written out and read back, or the editor is only safe until the user saves.
  it('round-trips after a structural edit', () => {
    const opened = importGedcom(fixture('awkward7.ged'), 'awkward7.ged');
    const added = apply(
      begin(opened.doc),
      addChild('@F2@', { names: [{ value: 'Ferran /Sise/' }] }),
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const edited = apply(added.history, editPerson('@I2@', { sex: 'X' }));
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;

    const doc = edited.history.present.doc;
    const round = trip(doc, '7.0');

    expect(content(round.after)).toEqual(content(doc));
    expect(validateDoc(round.after).ok).toBe(true);
    expect(audit(round.after).filter((finding) => finding.severity === 'error')).toEqual([]);
    expect(round.after.individuals).toHaveLength(doc.individuals.length);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * The property.
 *
 * The corpus above covers the corners somebody thought of. This covers the ones nobody did: it
 * builds documents out of the awkward material -- payloads that open with an at sign, values with
 * newlines in them, tags no mapper has an opinion about, names whose pieces repeat -- and asserts
 * the same equality over all of them.
 * ------------------------------------------------------------------------------------------- */

/** Text that survives a GEDCOM line. `\r` is a line terminator to the lexer, so it is excluded. */
const payloadText = fc
  .string({ maxLength: 24, unit: 'grapheme' })
  .filter((text) => !text.includes('\r'));

const pieceText = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((text) => !text.includes('\r'));

/** Tags no mapper claims, so a structure carrying one belongs in `extensions` at both ends. */
const extensionTag = fc.constantFrom('_ALPHA', '_BETA', '_UID', 'NOTE', 'OBJE', 'SNOTE');

const structure = (depth: number): fc.Arbitrary<Structure> =>
  fc
    .tuple(
      extensionTag,
      fc.option(payloadText, { nil: undefined }),
      depth === 0
        ? fc.constant<Structure[]>([])
        : fc.array(structure(depth - 1), { maxLength: 2 }),
    )
    .map(([tag, payload, children]) => ({
      tag,
      ...(payload === undefined ? {} : { payload }),
      ...(children.length === 0 ? {} : { children }),
    }));

const extensions = fc.array(structure(2), { maxLength: 3 });

const name: fc.Arbitrary<GenName> = fc
  .tuple(
    fc.option(payloadText, { nil: undefined }),
    fc.array(pieceText, { maxLength: 2 }),
    fc.array(pieceText, { maxLength: 2 }),
    extensions,
  )
  .map(([value, given, surname, extras]) => ({
    ...(value === undefined ? {} : { value }),
    ...(given.length === 0 ? {} : { given }),
    ...(surname.length === 0 ? {} : { surname }),
    ...(extras.length === 0 ? {} : { extensions: extras }),
  }));

/**
 * A date whose reading is the reading of its own payload.
 *
 * Built by parsing the payload rather than by picking fields, because `value` is authoritative: a
 * document whose parsed fields disagreed with its payload would be testing this suite's
 * imagination rather than the serializer.
 */
const dateValue = fc.constantFrom(
  '1801',
  'ABT 1801',
  '12 JUN 1870',
  'BET 1890 AND 1895',
  'FROM 1820 TO 1835',
  'not a date at all',
  'INT 1830 (as the register put it)',
);

const eventTag = fc.constantFrom<IndividualEventTag>('BIRT', 'DEAT', 'EVEN', 'BURI');

const event: fc.Arbitrary<IndividualEvent> = fc
  .tuple(
    eventTag,
    fc.option(dateValue, { nil: undefined }),
    fc.option(
      payloadText.filter((text) => text.toUpperCase() !== 'Y'),
      { nil: undefined },
    ),
    fc.boolean(),
    extensions,
  )
  .map(([tag, date, value, occurred, extras]) => ({
    tag,
    ...(occurred ? { occurred: true as const } : value === undefined ? {} : { value }),
    ...(date === undefined ? {} : { date: parseDateValue(date) }),
    ...(extras.length === 0 ? {} : { extensions: extras }),
  }));

const person: fc.Arbitrary<Omit<Individual, 'xref'>> = fc
  .tuple(
    fc.array(name, { maxLength: 2 }),
    fc.option(fc.constantFrom<Sex>('M', 'F', 'X', 'U'), { nil: undefined }),
    fc.array(event, { maxLength: 2 }),
    extensions,
  )
  .map(([names, sex, events, extras]) => ({
    ...(names.length === 0 ? {} : { names }),
    ...(sex === undefined ? {} : { sex }),
    ...(events.length === 0 ? {} : { events }),
    ...(extras.length === 0 ? {} : { extensions: extras }),
  }));

const document: fc.Arbitrary<GedcomDoc> = fc
  .array(person, { minLength: 1, maxLength: 4 })
  .map((people) => ({
    header: { gedcomVersion: '7.0' },
    individuals: people.map((body, index) => ({ xref: `@I${String(index + 1)}@`, ...body })),
    families: [],
  }));

describe('the round trip, over documents nobody wrote by hand', () => {
  it('gives back the document it was given', () => {
    fc.assert(
      fc.property(document, (doc) => {
        const round = trip(doc, '7.0');
        expect(round.issues).toEqual([]);
        expect(round.notes).toEqual([]);
        expect(content(round.after)).toEqual(content(doc));
        return true;
      }),
      { numRuns: 300 },
    );
  });

  it('produces documents the schema accepts', () => {
    fc.assert(
      fc.property(document, (doc) => {
        expect(validateDoc(trip(doc, '7.0').after).ok).toBe(true);
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
