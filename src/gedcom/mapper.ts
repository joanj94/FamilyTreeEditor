/**
 * Parse tree to document.
 *
 * This is where tags acquire meaning, and therefore the only stage that can lose anything. Its
 * governing rule is the inverse of what a mapper usually does: **the default is to keep, and
 * understanding is the exception.** Every substructure is offered to a handler, and anything no
 * handler claims goes to `extensions` exactly as it was parsed. Whole records the model does not
 * describe go to `otherRecords` the same way.
 *
 * That inversion is what makes the round trip safe. A mapper written the usual way -- read the
 * fields you know, ignore the rest -- destroys the parts of a user's file that its author never
 * thought about, which for a genealogy tool is the worst failure available.
 *
 * **On dialects.** GEDCOM 7 is the document's shape, and 5.5.1 is translated into it on the way
 * in. The two differ less than their version numbers suggest once `CONC`/`CONT` and the calendar
 * escapes are handled below this layer: what remains is `SEX` gaining `X`, the header's `CHAR`,
 * and enumeration values that 5.5.1 left unconstrained. Each is handled by keeping what does not
 * fit rather than by discarding it.
 */
import type {
  ChildStatus,
  Family,
  FamilyAttribute,
  FamilyAttributeTag,
  FamilyEvent,
  FamilyEventTag,
  FamilyLinkAsChild,
  FamilyLinkAsSpouse,
  GedcomDoc,
  GedcomRecord,
  GenDate,
  GenName,
  Header,
  Individual,
  IndividualAttribute,
  IndividualAttributeTag,
  IndividualEvent,
  IndividualEventTag,
  NameType,
  Origin,
  Pedigree,
  Place,
  Restriction,
  Sex,
  Structure,
} from '../model/types.js';

import { decodeGedcom } from './encoding.js';
import { parseDateValue } from './dates.js';
import { parseGedcom, type ParsedRecord } from './parse.js';

export interface ImportIssue {
  readonly message: string;
  readonly observed: string;
  /** The record the problem was found in, when it can be traced to one. */
  readonly xref?: string;
}

export interface ImportResult {
  readonly doc: GedcomDoc;
  readonly issues: readonly ImportIssue[];
}

const INDIVIDUAL_EVENTS = new Set<string>([
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
]);

const INDIVIDUAL_ATTRIBUTES = new Set<string>([
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
]);

const FAMILY_EVENTS = new Set<string>([
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
]);

const FAMILY_ATTRIBUTES = new Set<string>(['NCHI', 'RESI', 'FACT']);

const SEXES = new Set<string>(['M', 'F', 'X', 'U']);
const NAME_TYPES = new Set<string>([
  'AKA',
  'BIRTH',
  'IMMIGRANT',
  'MAIDEN',
  'MARRIED',
  'PROFESSIONAL',
  'OTHER',
]);
const PEDIGREES = new Set<string>(['ADOPTED', 'BIRTH', 'FOSTER', 'SEALING', 'OTHER']);
const CHILD_STATUSES = new Set<string>(['CHALLENGED', 'DISPROVEN', 'PROVEN']);
const RESTRICTIONS = new Set<string>(['CONFIDENTIAL', 'LOCKED', 'PRIVACY']);

const childrenOf = (node: Structure | undefined): readonly Structure[] => node?.children ?? [];

const find = (node: Structure | undefined, tag: string): Structure | undefined =>
  childrenOf(node).find((child) => child.tag === tag);

const payloadOf = (node: Structure | undefined): string | undefined =>
  node === undefined || node.payload === null ? undefined : node.payload;

/**
 * Offer every substructure to a handler and return what nothing claimed.
 *
 * This is the mechanism that makes preservation the default rather than a feature somebody has to
 * remember. Unclaimed structures keep their source order.
 */
function route(
  node: Structure | undefined,
  claim: (child: Structure) => boolean,
): readonly Structure[] {
  return childrenOf(node).filter((child) => !claim(child));
}

const withExtensions = <T extends object>(base: T, extras: readonly Structure[]): T =>
  extras.length === 0 ? base : { ...base, extensions: extras };

/** `RESN` is a comma-separated list; values outside the enumeration are reported, not silently kept. */
function parseRestriction(
  raw: string | undefined,
  report: (issue: ImportIssue) => void,
  xref: string | undefined,
): readonly Restriction[] | undefined {
  if (raw === undefined) return undefined;
  const values = raw
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter((part) => part !== '');
  for (const value of values) {
    if (!RESTRICTIONS.has(value)) {
      report({
        message: 'Unknown restriction value; ignored.',
        observed: value,
        ...(xref === undefined ? {} : { xref }),
      });
    }
  }
  const kept = values.filter((value): value is Restriction => RESTRICTIONS.has(value));
  return kept.length === 0 ? undefined : kept;
}

function mapPlace(node: Structure): Place {
  const form = payloadOf(find(node, 'FORM'));
  const language = payloadOf(find(node, 'LANG'));
  const extras = route(node, (child) => child.tag === 'FORM' || child.tag === 'LANG');
  return withExtensions(
    {
      text: payloadOf(node) ?? '',
      ...(form === undefined ? {} : { form }),
      ...(language === undefined ? {} : { language }),
    },
    extras,
  );
}

function mapName(node: Structure, report: (issue: ImportIssue) => void): GenName {
  const pieces: Record<string, string[]> = {};
  const tagToField: Readonly<Record<string, string>> = {
    NPFX: 'prefix',
    GIVN: 'given',
    NICK: 'nickname',
    SPFX: 'surnamePrefix',
    SURN: 'surname',
    NSFX: 'suffix',
  };

  let type: NameType | undefined;
  let typePhrase: string | undefined;

  const extras = route(node, (child) => {
    const field = tagToField[child.tag];
    if (field !== undefined) {
      // Each piece may repeat, which is how a name carrying two surnames is expressed.
      (pieces[field] ??= []).push(payloadOf(child) ?? '');
      return true;
    }
    if (child.tag === 'TYPE') {
      const value = (payloadOf(child) ?? '').toUpperCase();
      if (NAME_TYPES.has(value)) {
        type = value as NameType;
        typePhrase = payloadOf(find(child, 'PHRASE'));
        return true;
      }
      // 5.5.1 left NAME.TYPE unconstrained, so a value outside the 7 set is expected rather than
      // exceptional. Keeping the structure loses nothing; forcing it to OTHER would lose wording.
      report({ message: 'Unknown name type; kept verbatim.', observed: value });
      return false;
    }
    return false;
  });

  const value = payloadOf(node);
  return withExtensions(
    {
      ...(value === undefined ? {} : { value }),
      ...(type === undefined ? {} : { type }),
      ...(typePhrase === undefined ? {} : { typePhrase }),
      ...pieces,
    },
    extras,
  );
}

/**
 * A `DATE` line and its `PHRASE`.
 *
 * The payload is authoritative and `parseDateValue` reads it. `PHRASE` is separate: GEDCOM 7 made
 * it a substructure, where 5.5.1 folded the same idea into the payload as `INT <date> (<phrase>)`.
 * Both end up in `GenDate.phrase`, and an explicit `PHRASE` wins over one inferred from an `INT`
 * payload, because it is the writer saying so rather than this parser deducing it.
 */
function mapDate(node: Structure): GenDate {
  const parsed = parseDateValue(payloadOf(node) ?? '');
  const phrase = payloadOf(find(node, 'PHRASE'));
  return phrase === undefined ? parsed : { ...parsed, phrase };
}

/** The substructures every event and attribute shares. */
interface EventDetail {
  date?: GenDate;
  place?: Place;
  age?: string;
  agePhrase?: string;
  type?: string;
  cause?: string;
}

/**
 * Read the shared event detail out of one substructure, or return `undefined` where the
 * substructure is not one of them.
 *
 * Pure, and returning rather than filling in a parameter: the caller merges what comes back into
 * its own value. Mutating through a parameter would put the immutability rule this project runs
 * on at the mercy of whoever reads the function next.
 */
function eventDetailFrom(child: Structure): EventDetail | undefined {
  switch (child.tag) {
    case 'DATE':
      return { date: mapDate(child) };
    case 'PLAC':
      return { place: mapPlace(child) };
    case 'AGE': {
      // The phrase is included only when present: with `exactOptionalPropertyTypes`, an explicit
      // `undefined` is a different thing from an absent property, and the schema means absent.
      const phrase = payloadOf(find(child, 'PHRASE'));
      return {
        age: payloadOf(child) ?? '',
        ...(phrase === undefined ? {} : { agePhrase: phrase }),
      };
    }
    case 'TYPE':
      return { type: payloadOf(child) ?? '' };
    case 'CAUS':
      return { cause: payloadOf(child) ?? '' };
    default:
      return undefined;
  }
}

const detailFields = (detail: EventDetail): Record<string, unknown> => ({
  ...(detail.date === undefined ? {} : { date: detail.date }),
  ...(detail.place === undefined ? {} : { place: detail.place }),
  ...(detail.age === undefined ? {} : { age: detail.age }),
  ...(detail.agePhrase === undefined ? {} : { agePhrase: detail.agePhrase }),
  ...(detail.type === undefined ? {} : { type: detail.type }),
  ...(detail.cause === undefined ? {} : { cause: detail.cause }),
});

/**
 * Read an event's own payload.
 *
 * `Y` asserts that the event happened with no further detail, and is the only payload most event
 * tags take. `EVEN` takes text, and writers put text on the others too -- so anything that is not
 * `Y` is kept as a value rather than being read as an assertion or, worse, dropped.
 */
function eventPayload(node: Structure): { occurred?: true; value?: string } {
  const payload = payloadOf(node);
  if (payload === undefined) return {};
  if (payload.toUpperCase() === 'Y') return { occurred: true };
  return { value: payload };
}

function mapIndividualEvent(node: Structure): IndividualEvent {
  let detail: EventDetail = {};
  let familyAsChild: string | undefined;
  let adoptedBy: 'HUSB' | 'WIFE' | 'BOTH' | undefined;

  const extras = route(node, (child) => {
    const claimed = eventDetailFrom(child);
    if (claimed !== undefined) {
      detail = { ...detail, ...claimed };
      return true;
    }
    if (child.tag === 'FAMC') {
      familyAsChild = payloadOf(child);
      const adop = (payloadOf(find(child, 'ADOP')) ?? '').toUpperCase();
      if (adop === 'HUSB' || adop === 'WIFE' || adop === 'BOTH') adoptedBy = adop;
      return familyAsChild !== undefined;
    }
    return false;
  });

  return withExtensions(
    {
      tag: node.tag as IndividualEventTag,
      ...eventPayload(node),
      ...detailFields(detail),
      ...(familyAsChild === undefined ? {} : { familyAsChild }),
      ...(adoptedBy === undefined ? {} : { adoptedBy }),
    },
    extras,
  );
}

function mapIndividualAttribute(node: Structure): IndividualAttribute {
  let detail: EventDetail = {};
  const extras = route(node, (child) => {
    const claimed = eventDetailFrom(child);
    if (claimed === undefined) return false;
    detail = { ...detail, ...claimed };
    return true;
  });
  const value = payloadOf(node);
  return withExtensions(
    {
      tag: node.tag as IndividualAttributeTag,
      ...(value === undefined ? {} : { value }),
      ...detailFields(detail),
    },
    extras,
  );
}

function mapFamilyEvent(node: Structure): FamilyEvent {
  let detail: EventDetail = {};
  let husbandAge: string | undefined;
  let wifeAge: string | undefined;

  const extras = route(node, (child) => {
    const claimed = eventDetailFrom(child);
    if (claimed !== undefined) {
      detail = { ...detail, ...claimed };
      return true;
    }
    if (child.tag === 'HUSB') {
      husbandAge = payloadOf(find(child, 'AGE'));
      return husbandAge !== undefined;
    }
    if (child.tag === 'WIFE') {
      wifeAge = payloadOf(find(child, 'AGE'));
      return wifeAge !== undefined;
    }
    return false;
  });

  return withExtensions(
    {
      tag: node.tag as FamilyEventTag,
      ...eventPayload(node),
      ...detailFields(detail),
      ...(husbandAge === undefined ? {} : { husbandAge }),
      ...(wifeAge === undefined ? {} : { wifeAge }),
    },
    extras,
  );
}

function mapFamilyAttribute(node: Structure): FamilyAttribute {
  let detail: EventDetail = {};
  const extras = route(node, (child) => {
    const claimed = eventDetailFrom(child);
    if (claimed === undefined) return false;
    detail = { ...detail, ...claimed };
    return true;
  });
  const value = payloadOf(node);
  return withExtensions(
    {
      tag: node.tag as FamilyAttributeTag,
      ...(value === undefined ? {} : { value }),
      ...detailFields(detail),
    },
    extras,
  );
}

function mapFamilyLinkAsChild(node: Structure): FamilyLinkAsChild {
  let pedigree: Pedigree | undefined;
  let pedigreePhrase: string | undefined;
  let status: ChildStatus | undefined;
  let statusPhrase: string | undefined;

  const extras = route(node, (child) => {
    if (child.tag === 'PEDI') {
      const value = (payloadOf(child) ?? '').toUpperCase();
      if (!PEDIGREES.has(value)) return false;
      pedigree = value as Pedigree;
      pedigreePhrase = payloadOf(find(child, 'PHRASE'));
      return true;
    }
    if (child.tag === 'STAT') {
      const value = (payloadOf(child) ?? '').toUpperCase();
      if (!CHILD_STATUSES.has(value)) return false;
      status = value as ChildStatus;
      statusPhrase = payloadOf(find(child, 'PHRASE'));
      return true;
    }
    return false;
  });

  return withExtensions(
    {
      xref: payloadOf(node) ?? '',
      ...(pedigree === undefined ? {} : { pedigree }),
      ...(pedigreePhrase === undefined ? {} : { pedigreePhrase }),
      ...(status === undefined ? {} : { status }),
      ...(statusPhrase === undefined ? {} : { statusPhrase }),
    },
    extras,
  );
}

function mapIndividual(record: ParsedRecord, report: (issue: ImportIssue) => void): Individual {
  const names: GenName[] = [];
  const events: IndividualEvent[] = [];
  const attributes: IndividualAttribute[] = [];
  const familiesAsChild: FamilyLinkAsChild[] = [];
  const familiesAsSpouse: FamilyLinkAsSpouse[] = [];
  let sex: Sex | undefined;
  let restriction: readonly Restriction[] | undefined;

  const extras = route(record, (child) => {
    switch (child.tag) {
      case 'NAME':
        names.push(mapName(child, report));
        return true;
      case 'SEX': {
        const value = (payloadOf(child) ?? '').toUpperCase();
        if (SEXES.has(value)) {
          sex = value as Sex;
          return true;
        }
        // Keeping the line costs nothing, and means a value this tool cannot interpret is still
        // the user's to correct rather than something it silently deleted.
        report({
          message: 'Unknown sex value; kept verbatim.',
          observed: value,
          ...(record.xref === undefined ? {} : { xref: record.xref }),
        });
        return false;
      }
      case 'RESN':
        restriction = parseRestriction(payloadOf(child), report, record.xref);
        return restriction !== undefined;
      case 'FAMC':
        familiesAsChild.push(mapFamilyLinkAsChild(child));
        return true;
      case 'FAMS':
        familiesAsSpouse.push(
          withExtensions({ xref: payloadOf(child) ?? '' }, childrenOf(child)),
        );
        return true;
      default:
        if (INDIVIDUAL_EVENTS.has(child.tag)) {
          events.push(mapIndividualEvent(child));
          return true;
        }
        if (INDIVIDUAL_ATTRIBUTES.has(child.tag)) {
          attributes.push(mapIndividualAttribute(child));
          return true;
        }
        return false;
    }
  });

  return withExtensions(
    {
      xref: record.xref ?? '',
      ...(restriction === undefined ? {} : { restriction }),
      ...(names.length === 0 ? {} : { names }),
      ...(sex === undefined ? {} : { sex }),
      ...(events.length === 0 ? {} : { events }),
      ...(attributes.length === 0 ? {} : { attributes }),
      ...(familiesAsChild.length === 0 ? {} : { familiesAsChild }),
      ...(familiesAsSpouse.length === 0 ? {} : { familiesAsSpouse }),
    },
    extras,
  );
}

function mapFamily(record: ParsedRecord, report: (issue: ImportIssue) => void): Family {
  const childXrefs: string[] = [];
  const events: FamilyEvent[] = [];
  const attributes: FamilyAttribute[] = [];
  let husband: string | undefined;
  let wife: string | undefined;
  let restriction: readonly Restriction[] | undefined;

  const extras = route(record, (child) => {
    switch (child.tag) {
      case 'HUSB':
        husband = payloadOf(child);
        return husband !== undefined;
      case 'WIFE':
        wife = payloadOf(child);
        return wife !== undefined;
      case 'CHIL':
        childXrefs.push(payloadOf(child) ?? '');
        return true;
      case 'RESN':
        restriction = parseRestriction(payloadOf(child), report, record.xref);
        return restriction !== undefined;
      default:
        // NCHI, RESI and FACT are attributes of a family as well as of a person; the family set
        // is checked first so the family reading wins here.
        if (FAMILY_ATTRIBUTES.has(child.tag)) {
          attributes.push(mapFamilyAttribute(child));
          return true;
        }
        if (FAMILY_EVENTS.has(child.tag)) {
          events.push(mapFamilyEvent(child));
          return true;
        }
        return false;
    }
  });

  return withExtensions(
    {
      xref: record.xref ?? '',
      ...(restriction === undefined ? {} : { restriction }),
      ...(husband === undefined ? {} : { husband }),
      ...(wife === undefined ? {} : { wife }),
      ...(childXrefs.length === 0 ? {} : { children: childXrefs }),
      ...(events.length === 0 ? {} : { events }),
      ...(attributes.length === 0 ? {} : { attributes }),
    },
    extras,
  );
}

const HEADER_CLAIMED = ['GEDC', 'SOUR', 'DEST', 'SUBM', 'COPR', 'LANG', 'PLAC', 'DATE'];

function mapHeader(record: ParsedRecord | undefined): Header {
  if (record === undefined) return { gedcomVersion: '' };

  const sourceNode = find(record, 'SOUR');
  const dateNode = find(record, 'DATE');

  const sourceSystem = payloadOf(sourceNode);
  const sourceName = payloadOf(find(sourceNode, 'NAME'));
  const sourceVersion = payloadOf(find(sourceNode, 'VERS'));
  const destination = payloadOf(find(record, 'DEST'));
  const submitter = payloadOf(find(record, 'SUBM'));
  const copyright = payloadOf(find(record, 'COPR'));
  const language = payloadOf(find(record, 'LANG'));
  const placeForm = payloadOf(find(find(record, 'PLAC'), 'FORM'))
    ?.split(',')
    .map((part) => part.trim());

  const extras = route(record, (child) => HEADER_CLAIMED.includes(child.tag));

  return withExtensions(
    {
      gedcomVersion: payloadOf(find(find(record, 'GEDC'), 'VERS')) ?? '',
      ...(sourceSystem === undefined ? {} : { sourceSystem }),
      ...(sourceName === undefined ? {} : { sourceName }),
      ...(sourceVersion === undefined ? {} : { sourceVersion }),
      ...(destination === undefined ? {} : { destination }),
      ...(dateNode === undefined ? {} : { date: mapDate(dateNode) }),
      ...(submitter === undefined ? {} : { submitter }),
      ...(copyright === undefined ? {} : { copyright }),
      ...(language === undefined ? {} : { language }),
      ...(placeForm === undefined ? {} : { placeForm }),
    },
    extras,
  );
}

/**
 * Work out which dialect the file is.
 *
 * `HEAD.GEDC.VERS` settles it when present. When it is not, the presence of `CHAR` is the
 * strongest signal available -- GEDCOM 7 removed the tag -- and the guess is recorded as a guess,
 * so it can be shown to the user rather than assumed correct.
 */
function detectDialect(
  header: Header,
  report: (issue: ImportIssue) => void,
): Pick<Origin, 'dialect' | 'dialectInferred'> {
  const declared = header.gedcomVersion.trim();
  if (declared.startsWith('7')) return { dialect: '7.0' };
  if (declared.startsWith('5.5')) return { dialect: '5.5.1' };

  const looksOld = (header.extensions ?? []).some((child) => child.tag === 'CHAR');
  report({
    message: 'Header declares no GEDCOM version; the dialect was inferred.',
    observed: declared === '' ? '(absent)' : declared,
  });
  return { dialect: looksOld ? '5.5.1' : '7.0', dialectInferred: true };
}

/** Map parsed records into a document. */
export function toDocument(
  records: readonly ParsedRecord[],
  origin: Omit<Origin, 'dialect' | 'dialectInferred'> = {},
): ImportResult {
  const issues: ImportIssue[] = [];
  const report = (issue: ImportIssue): void => {
    issues.push(issue);
  };

  const individuals: Individual[] = [];
  const families: Family[] = [];
  const otherRecords: GedcomRecord[] = [];
  let headerRecord: ParsedRecord | undefined;

  for (const record of records) {
    if (record.tag === 'HEAD') {
      headerRecord = record;
      continue;
    }
    // The trailer marks the end of the file and carries nothing. It is the one structure dropped
    // on purpose; export writes a fresh one.
    if (record.tag === 'TRLR') continue;

    if (record.xref === undefined) {
      // Without an identifier the record cannot be referred to, and the schema cannot hold it.
      // Saying so is better than keeping it somewhere it will not be found again.
      report({
        message: 'Record has no cross-reference identifier and cannot be kept; dropped.',
        observed: record.tag,
      });
      continue;
    }

    if (record.tag === 'INDI') {
      individuals.push(mapIndividual(record, report));
    } else if (record.tag === 'FAM') {
      families.push(mapFamily(record, report));
    } else {
      otherRecords.push(record as GedcomRecord);
    }
  }

  const header = mapHeader(headerRecord);
  const dialect = detectDialect(header, report);

  return {
    doc: {
      header,
      individuals,
      families,
      ...(otherRecords.length === 0 ? {} : { otherRecords }),
      origin: { ...origin, ...dialect },
    },
    issues,
  };
}

/** Decode, parse and map a GEDCOM file in one call. */
export function importGedcom(source: Uint8Array, fileName?: string): ImportResult {
  const decoded = decodeGedcom(source);
  const parsed = parseGedcom(decoded.text);
  const mapped = toDocument(parsed.records, {
    encoding: decoded.encoding,
    ...(fileName === undefined ? {} : { fileName }),
  });

  const issues: ImportIssue[] = [
    ...decoded.issues.map((issue) => ({ message: issue.message, observed: issue.observed })),
    ...parsed.issues.map((issue) => ({
      message: `Line ${issue.line}: ${issue.message}`,
      observed: issue.observed,
    })),
    ...mapped.issues,
  ];

  return { doc: mapped.doc, issues };
}
