/**
 * Document to GEDCOM: the inverse of `mapper.ts`.
 *
 * The mapper's rule was that keeping is the default and understanding the exception. This is the
 * same rule read backwards: everything the model describes is written from its field, and
 * everything it does not is written back out of `extensions` and `otherRecords`, verbatim, in the
 * order it arrived. A tag this editor has never heard of leaves the tool exactly as it entered.
 *
 * The property the whole project rests on is that `import(export(import(file)))` equals
 * `import(file)`. Note what it does and does not claim. It is about the *document*, not the bytes:
 * a value split across `CONC` lines at different points, or attributes written before events where
 * the source interleaved them, says the same thing and compares equal. It would be a worse
 * guarantee if it were about bytes, because meeting it would then mean recording the previous
 * program's formatting habits instead of the family's data.
 *
 * **Two things about the file rather than about anybody in it are written by this module, not
 * copied from the document.** The version declaration states the dialect actually being written,
 * and -- in 5.5.1, which requires the tag -- `CHAR` states the encoding actually being produced,
 * which is always UTF-8. A file whose header claims ANSEL while its bytes are UTF-8 reads back as
 * mojibake, so these two are the serializer's to own. Both are reported.
 *
 * **On 5.5.1 as a target.** Going back to the older dialect is a downgrade and it loses things:
 * `SEX X` has no 5.5.1 spelling, and `PHRASE` is a GEDCOM 7 structure. Nothing is dropped
 * silently -- every loss is returned as a note for the caller to show, because a user choosing an
 * export format is entitled to know what that choice costs them.
 */
import type {
  Family,
  FamilyAttribute,
  FamilyEvent,
  FamilyLinkAsChild,
  FamilyLinkAsSpouse,
  GedcomDoc,
  GenDate,
  GenName,
  Header,
  Individual,
  IndividualAttribute,
  IndividualEvent,
  Place,
  Structure,
} from '../model/types.js';

import type { ParsedRecord } from './parse.js';
import { MAX_LINE_5551, writeLines } from './write.js';

export type ExportDialect = '7.0' | '5.5.1';

/** Something the export could not carry across, or decided on the document's behalf. */
export interface ExportNote {
  readonly message: string;
  readonly observed: string;
  /** The record it happened in, where it can be traced to one. */
  readonly xref?: string;
}

export interface ExportResult {
  readonly text: string;
  readonly notes: readonly ExportNote[];
}

export interface ExportOptions {
  /** GEDCOM 7 unless asked otherwise, which is what the standard's own migration advice says. */
  readonly dialect?: ExportDialect;
}

/** What the writer produces, whatever a header may say. Both dialects permit it. */
const OUTPUT_ENCODING = 'UTF-8';

interface Context {
  readonly dialect: ExportDialect;
  readonly note: (note: ExportNote) => void;
}

const node = (
  tag: string,
  payload?: string | null,
  children: readonly Structure[] = [],
): Structure => ({
  tag,
  ...(payload === undefined ? {} : { payload }),
  ...(children.length === 0 ? {} : { children }),
});

/** `undefined` in, nothing out: the shape every optional field is written through. */
const optional = (tag: string, payload: string | undefined): readonly Structure[] =>
  payload === undefined ? [] : [node(tag, payload)];

const each = <T>(items: readonly T[] | undefined, write: (item: T) => Structure): Structure[] =>
  (items ?? []).map(write);

/**
 * A `PHRASE` substructure, where the dialect has one.
 *
 * 5.5.1 does not, so the phrase is reported and dropped rather than written as a tag that version
 * never defined. The caller passes what the phrase belongs to, so the note names it.
 */
function phraseNodes(
  phrase: string | undefined,
  under: string,
  context: Context,
  xref?: string,
): readonly Structure[] {
  if (phrase === undefined) return [];
  if (context.dialect === '7.0') return [node('PHRASE', phrase)];
  context.note({
    message: `GEDCOM 5.5.1 has no PHRASE structure; the phrase under ${under} was not written.`,
    observed: phrase,
    ...(xref === undefined ? {} : { xref }),
  });
  return [];
}

/**
 * A `DATE` line and, in 7, its phrase.
 *
 * `value` is the payload as the file wrote it and is written back untouched, so a date this tool
 * could not parse exports exactly as it arrived. 5.5.1's own way of carrying a phrase is inside
 * that payload -- `INT <date> (<phrase>)` -- so a phrase that came in that way is already written,
 * and reporting it as lost would be false.
 */
function dateNode(tag: string, date: GenDate, context: Context, xref?: string): Structure {
  const carriedInPayload = date.value.toUpperCase().startsWith('INT ');
  const phrase =
    context.dialect === '5.5.1' && carriedInPayload
      ? []
      : phraseNodes(date.phrase, tag, context, xref);
  return node(tag, date.value, phrase);
}

const placeNode = (place: Place): Structure =>
  node('PLAC', place.text, [
    ...optional('FORM', place.form),
    ...optional('LANG', place.language),
    ...(place.extensions ?? []),
  ]);

const ageNodes = (
  age: string | undefined,
  agePhrase: string | undefined,
  context: Context,
  xref?: string,
): readonly Structure[] =>
  age === undefined ? [] : [node('AGE', age, phraseNodes(agePhrase, 'AGE', context, xref))];

/** The detail shared by every event and attribute, in the standard's order. */
const detailNodes = (
  detail: {
    readonly date?: GenDate;
    readonly place?: Place;
    readonly cause?: string;
  },
  context: Context,
  xref?: string,
): readonly Structure[] => [
  ...(detail.date === undefined ? [] : [dateNode('DATE', detail.date, context, xref)]),
  ...(detail.place === undefined ? [] : [placeNode(detail.place)]),
  ...optional('CAUS', detail.cause),
];

/** `Y` where the event is asserted and nothing else is known; the payload otherwise. */
const eventPayload = (event: {
  readonly occurred?: boolean;
  readonly value?: string;
}): string | undefined => (event.occurred === true ? 'Y' : event.value);

const individualEventNode = (
  event: IndividualEvent,
  context: Context,
  xref: string,
): Structure =>
  node(event.tag, eventPayload(event), [
    ...optional('TYPE', event.type),
    ...detailNodes(event, context, xref),
    ...ageNodes(event.age, event.agePhrase, context, xref),
    ...(event.familyAsChild === undefined
      ? []
      : [node('FAMC', event.familyAsChild, optional('ADOP', event.adoptedBy))]),
    ...(event.extensions ?? []),
  ]);

const individualAttributeNode = (
  attribute: IndividualAttribute,
  context: Context,
  xref: string,
): Structure =>
  node(attribute.tag, attribute.value, [
    ...optional('TYPE', attribute.type),
    ...detailNodes(attribute, context, xref),
    ...ageNodes(attribute.age, attribute.agePhrase, context, xref),
    ...(attribute.extensions ?? []),
  ]);

const familyEventNode = (event: FamilyEvent, context: Context, xref: string): Structure =>
  node(event.tag, eventPayload(event), [
    ...optional('TYPE', event.type),
    ...(event.husbandAge === undefined
      ? []
      : [node('HUSB', undefined, [node('AGE', event.husbandAge)])]),
    ...(event.wifeAge === undefined
      ? []
      : [node('WIFE', undefined, [node('AGE', event.wifeAge)])]),
    ...detailNodes(event, context, xref),
    ...(event.extensions ?? []),
  ]);

const familyAttributeNode = (
  attribute: FamilyAttribute,
  context: Context,
  xref: string,
): Structure =>
  node(attribute.tag, attribute.value, [
    ...optional('TYPE', attribute.type),
    ...detailNodes(attribute, context, xref),
    ...(attribute.extensions ?? []),
  ]);

/** Each name piece may repeat, which is how a name carrying two surnames is written. */
const pieceNodes = (tag: string, values: readonly string[] | undefined): readonly Structure[] =>
  (values ?? []).map((value) => node(tag, value));

const nameNode = (name: GenName, context: Context, xref: string): Structure =>
  node('NAME', name.value, [
    ...(name.type === undefined
      ? []
      : [node('TYPE', name.type, phraseNodes(name.typePhrase, 'NAME.TYPE', context, xref))]),
    ...pieceNodes('NPFX', name.prefix),
    ...pieceNodes('GIVN', name.given),
    ...pieceNodes('NICK', name.nickname),
    ...pieceNodes('SPFX', name.surnamePrefix),
    ...pieceNodes('SURN', name.surname),
    ...pieceNodes('NSFX', name.suffix),
    ...(name.extensions ?? []),
  ]);

const childLinkNode = (link: FamilyLinkAsChild, context: Context, xref: string): Structure =>
  node('FAMC', link.xref, [
    ...(link.pedigree === undefined
      ? []
      : [node('PEDI', link.pedigree, phraseNodes(link.pedigreePhrase, 'PEDI', context, xref))]),
    ...(link.status === undefined
      ? []
      : [node('STAT', link.status, phraseNodes(link.statusPhrase, 'STAT', context, xref))]),
    ...(link.extensions ?? []),
  ]);

const spouseLinkNode = (link: FamilyLinkAsSpouse): Structure =>
  node('FAMS', link.xref, link.extensions ?? []);

/** `RESN` is one line carrying a comma-separated list, which is how the mapper reads it back. */
const restrictionNodes = (values: readonly string[] | undefined): readonly Structure[] =>
  values === undefined || values.length === 0 ? [] : [node('RESN', values.join(', '))];

/**
 * `SEX`, downgraded where it must be.
 *
 * GEDCOM 7 added `X` for a person who is neither male nor female. 5.5.1 has no such value, and the
 * closest thing it can say is `U` -- which means undetermined, and is therefore a different
 * statement. The substitution is made because the alternative is writing a value the target
 * version does not define, and it is reported because it changes what the record says.
 */
function sexNodes(
  sex: Individual['sex'],
  context: Context,
  xref: string,
): readonly Structure[] {
  if (sex === undefined) return [];
  if (sex !== 'X' || context.dialect === '7.0') return [node('SEX', sex)];
  context.note({
    message: 'GEDCOM 5.5.1 has no SEX value X; U was written, which says less.',
    observed: 'X',
    xref,
  });
  return [node('SEX', 'U')];
}

function individualRecord(individual: Individual, context: Context): ParsedRecord {
  const xref = individual.xref;
  return {
    xref,
    tag: 'INDI',
    children: [
      ...restrictionNodes(individual.restriction),
      ...each(individual.names, (name) => nameNode(name, context, xref)),
      ...sexNodes(individual.sex, context, xref),
      ...each(individual.attributes, (item) => individualAttributeNode(item, context, xref)),
      ...each(individual.events, (item) => individualEventNode(item, context, xref)),
      ...each(individual.familiesAsChild, (link) => childLinkNode(link, context, xref)),
      ...each(individual.familiesAsSpouse, spouseLinkNode),
      ...(individual.extensions ?? []),
    ],
  };
}

function familyRecord(family: Family, context: Context): ParsedRecord {
  const xref = family.xref;
  return {
    xref,
    tag: 'FAM',
    children: [
      ...restrictionNodes(family.restriction),
      ...each(family.attributes, (item) => familyAttributeNode(item, context, xref)),
      ...each(family.events, (item) => familyEventNode(item, context, xref)),
      ...optional('HUSB', family.husband),
      ...optional('WIFE', family.wife),
      ...(family.children ?? []).map((child) => node('CHIL', child)),
      ...(family.extensions ?? []),
    ],
  };
}

/**
 * The version to declare.
 *
 * The document's own declaration is kept where it already belongs to the dialect being written, so
 * a file declaring `7.0.14` is not quietly rounded to `7.0` by a round trip. Where it does not, the
 * dialect's version is written, because the declaration has to describe the file being produced.
 */
function versionFor(header: Header, context: Context): string {
  const declared = header.gedcomVersion.trim();
  const family = context.dialect === '7.0' ? '7' : '5.5';
  if (declared.startsWith(family)) return header.gedcomVersion;
  if (declared !== '') {
    context.note({
      message: `The header declared GEDCOM ${declared}; ${context.dialect} was written instead.`,
      observed: declared,
    });
  }
  return context.dialect;
}

/**
 * `HEAD`, including the two declarations this module owns.
 *
 * `CHAR` is filtered out of whatever the document is carrying and then reissued, or dropped:
 * GEDCOM 7 removed the tag, and 5.5.1 requires it and has to be told the truth about the bytes.
 * Letting an inherited `1 CHAR ANSEL` through onto a UTF-8 file would corrupt every accented name
 * in it the next time it was opened, which is the exact failure this project exists to avoid.
 */
function headerRecord(doc: GedcomDoc, context: Context): ParsedRecord {
  const header = doc.header;
  const inherited = header.extensions ?? [];
  const declaredCharset = inherited.find((child) => child.tag === 'CHAR');
  const extras = inherited.filter((child) => child.tag !== 'CHAR');

  if (declaredCharset !== undefined) {
    const observed = declaredCharset.payload ?? '(none)';
    if (context.dialect === '7.0') {
      context.note({
        message:
          'GEDCOM 7 removed HEAD.CHAR; the declaration was dropped and the file is UTF-8.',
        observed,
      });
    } else if (observed !== OUTPUT_ENCODING) {
      context.note({
        message: `HEAD.CHAR was rewritten to ${OUTPUT_ENCODING}, which is what the bytes are.`,
        observed,
      });
    }
  }

  if (context.dialect === '5.5.1' && header.submitter === undefined) {
    context.note({
      message:
        'GEDCOM 5.5.1 requires HEAD.SUBM and this document has no submitter. None was invented.',
      observed: '(absent)',
    });
  }

  const hasSource =
    header.sourceSystem !== undefined ||
    header.sourceName !== undefined ||
    header.sourceVersion !== undefined;

  return {
    tag: 'HEAD',
    children: [
      node('GEDC', undefined, [
        node('VERS', versionFor(header, context)),
        // 5.5.1 requires the form; 7 removed it.
        ...(context.dialect === '5.5.1' ? [node('FORM', 'LINEAGE-LINKED')] : []),
      ]),
      ...(context.dialect === '5.5.1' ? [node('CHAR', OUTPUT_ENCODING)] : []),
      ...(hasSource
        ? [
            node('SOUR', header.sourceSystem, [
              ...optional('VERS', header.sourceVersion),
              ...optional('NAME', header.sourceName),
            ]),
          ]
        : []),
      ...optional('DEST', header.destination),
      ...(header.date === undefined ? [] : [dateNode('DATE', header.date, context)]),
      ...optional('SUBM', header.submitter),
      ...optional('COPR', header.copyright),
      ...optional('LANG', header.language),
      ...(header.placeForm === undefined
        ? []
        : [node('PLAC', undefined, [node('FORM', header.placeForm.join(', '))])]),
      ...extras,
    ],
  };
}

/**
 * The document as records, header and trailer included.
 *
 * Exposed because it is the useful unit to test against: a record list can be compared structure
 * by structure, where text can only be compared as text.
 */
export function toRecords(
  doc: GedcomDoc,
  options: ExportOptions = {},
): { readonly records: readonly ParsedRecord[]; readonly notes: readonly ExportNote[] } {
  const notes: ExportNote[] = [];
  const context: Context = {
    dialect: options.dialect ?? '7.0',
    note: (item) => {
      notes.push(item);
    },
  };

  return {
    records: [
      headerRecord(doc, context),
      ...doc.individuals.map((individual) => individualRecord(individual, context)),
      ...doc.families.map((family) => familyRecord(family, context)),
      ...(doc.otherRecords ?? []),
      // The trailer carries nothing and is the one structure the mapper drops on purpose. It is
      // written fresh rather than remembered, because it says only "the file ends here".
      { tag: 'TRLR' },
    ],
    notes,
  };
}

/** Write a document as GEDCOM text, in the dialect asked for. */
export function exportGedcom(doc: GedcomDoc, options: ExportOptions = {}): ExportResult {
  const dialect = options.dialect ?? '7.0';
  const { records, notes } = toRecords(doc, { dialect });
  return {
    text: writeLines(records, dialect === '5.5.1' ? { maxLineLength: MAX_LINE_5551 } : {}),
    notes,
  };
}

/**
 * The document as JSON.
 *
 * The same object the schema describes, so what comes out validates against
 * `schema/gedcom7.schema.json` and reads back as an identical document. It is the lossless form:
 * where GEDCOM has to be told which dialect to speak, this has nothing to translate.
 */
export const exportJson = (doc: GedcomDoc): string => `${JSON.stringify(doc, null, 2)}\n`;
