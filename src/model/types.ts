/**
 * The document model, mirroring FamilySearch GEDCOM 7.0.
 *
 * Tag names, enumerations and date grammar are the standard's, not this project's. Where GEDCOM
 * says `BIRT`, so does this file; where it allows a name to carry several `SURN` pieces, so does
 * `GenName.surname`. The gain is that no translation table sits between the file on disk and the
 * document in memory, so there is nowhere for a mapping to quietly lose something.
 *
 * `schema/gedcom7.schema.json` is the contract and this file is a hand-maintained mirror of it;
 * `tests/schema.test.ts` pins the two together, so a change to one that is not made to the other
 * fails the suite rather than drifting.
 *
 * Two rules run through the whole model:
 *
 * 1. **The payload as written is authoritative.** `GenDate.value` and `GenName.value` hold what
 *    the file said; the parsed fields beside them are a reading of it. Export writes the payload
 *    back, so anything this parser misunderstands still leaves the tool as it arrived.
 * 2. **Nothing is discarded.** Every structure this model does not describe is kept verbatim in
 *    an `extensions` list, and whole records it does not describe in `otherRecords`. Losslessness
 *    is therefore a property of the type, not a promise made by the serializer.
 *
 * Every type is `readonly` throughout. Edits are pure functions returning a new document, so the
 * compiler refuses in-place assignment -- cheaper than catching an aliasing bug once an undo/redo
 * stack is holding references to past states.
 */

/**
 * A record's own identifier. The standard's grammar is `@` + one or more of A-Z, 0-9 and `_` +
 * `@`. Note what it does not say: nothing requires `@I1@` to be an individual. Any code that
 * infers a record's type from the shape of its identifier is reading a convention, not the
 * standard, and will be wrong on somebody's file.
 */
export type Xref = string;

/** A reference to a record, which unlike an identifier may be `@VOID@`. */
export type Pointer = string;

export const XREF_PATTERN = /^@[A-Z0-9_]+@$/;

/** The standard's deliberate reference to no record. Valid as a pointer, never as an identifier. */
export const VOID_POINTER = '@VOID@';

/**
 * One GEDCOM line and everything nested beneath it, exactly as parsed.
 *
 * This is the preservation form. It models nothing, so it loses nothing, and it is where every
 * structure the typed model does not cover ends up -- `NOTE`, `SOUR` and `OBJE` as much as a
 * vendor's `_UID`. A tag being unmodelled is a statement about this editor's scope, never a
 * licence to drop it.
 */
export interface Structure {
  readonly tag: string;
  /** Null where the line had no payload, which is not the same as an empty one. */
  readonly payload?: string | null;
  readonly children?: readonly Structure[];
}

/** A top-level record kept verbatim, identifier included. */
export interface GedcomRecord extends Structure {
  readonly xref: Xref;
}

/** Substructures of the enclosing record that this model does not describe, in source order. */
export type Extensions = readonly Structure[];

/**
 * One parsed date point.
 *
 * Precision is carried by which fields are present. A date known only to its year has no `month`
 * and no `day`, so writing `1901-01-01` for `ABT 1901` is not merely discouraged, it cannot be
 * expressed -- the difference between a genealogy tool and a lossy one.
 */
export interface CalendarDate {
  /** `GREGORIAN`, `JULIAN`, `FRENCH_R`, `HEBREW`, or an extension calendar tag. */
  readonly calendar?: string;
  readonly year?: number;
  /** 1-13: the standard's Hebrew and French Republican calendars have a thirteenth month. */
  readonly month?: number;
  readonly day?: number;
  /** `BCE`, or an extension epoch tag. */
  readonly epoch?: string;
}

/** Which `DateValue` production the payload matched. `UNPARSED` means none of them did. */
export type DateKind = 'EXACT' | 'APPROXIMATE' | 'RANGE' | 'PERIOD' | 'UNPARSED';

/**
 * The keyword a date payload opened with. The standard groups them: `ABT`, `CAL` and `EST` form
 * a `dateApprox`; `BEF`, `AFT` and `BET` a `dateRange`; `FROM` and `TO` a `DatePeriod`.
 */
export type DateModifier = 'ABT' | 'CAL' | 'EST' | 'BEF' | 'AFT' | 'BET' | 'FROM' | 'TO';

/**
 * A `DATE` payload and this tool's reading of it.
 *
 * `value` is what the file said and is authoritative. Everything else is best-effort, which is
 * why an unparseable date is not an error: it is `kind: 'UNPARSED'` with the payload intact, and
 * it exports byte-identical.
 */
export interface GenDate {
  readonly value: string;
  readonly kind?: DateKind;
  readonly modifier?: DateModifier;
  readonly start?: CalendarDate;
  /** The second date of a `BET x AND y` range or a `FROM x TO y` period. */
  readonly end?: CalendarDate;
  /** The `PHRASE` substructure: what the source said, where the grammar could not express it. */
  readonly phrase?: string;
}

export interface Place {
  /** The `PLAC` payload: comma-separated jurisdictions, smallest first. */
  readonly text: string;
  /** The `FORM` substructure naming those jurisdictions. */
  readonly form?: string;
  readonly language?: string;
  readonly extensions?: Extensions;
}

export type NameType =
  'AKA' | 'BIRTH' | 'IMMIGRANT' | 'MAIDEN' | 'MARRIED' | 'PROFESSIONAL' | 'OTHER';

/**
 * A `NAME` structure and its personal name pieces.
 *
 * Every piece is a list because the standard allows each of them more than once. That is worth
 * stating plainly: a name carrying two surnames needs no special field and no convention about
 * which half goes where, because GEDCOM already expresses it as two `SURN` pieces. Modelling the
 * standard faithfully removed a problem rather than adding one.
 */
export interface GenName {
  /** The `NAME` payload as written, surname delimited by slashes. Authoritative. */
  readonly value?: string;
  readonly type?: NameType;
  /** `PHRASE` under `TYPE`, which the standard requires when `TYPE` is `OTHER`. */
  readonly typePhrase?: string;
  /** `NPFX` */
  readonly prefix?: readonly string[];
  /** `GIVN` */
  readonly given?: readonly string[];
  /** `NICK` */
  readonly nickname?: readonly string[];
  /** `SPFX` */
  readonly surnamePrefix?: readonly string[];
  /** `SURN` */
  readonly surname?: readonly string[];
  /** `NSFX` */
  readonly suffix?: readonly string[];
  readonly extensions?: Extensions;
}

export type IndividualEventTag =
  | 'BIRT'
  | 'CHR'
  | 'DEAT'
  | 'BURI'
  | 'CREM'
  | 'ADOP'
  | 'BAPM'
  | 'BARM'
  | 'BASM'
  | 'BLES'
  | 'CHRA'
  | 'CONF'
  | 'FCOM'
  | 'ORDN'
  | 'NATU'
  | 'EMIG'
  | 'IMMI'
  | 'CENS'
  | 'PROB'
  | 'WILL'
  | 'GRAD'
  | 'RETI'
  | 'EVEN';

export type IndividualAttributeTag =
  | 'CAST'
  | 'DSCR'
  | 'EDUC'
  | 'IDNO'
  | 'NATI'
  | 'NCHI'
  | 'NMR'
  | 'OCCU'
  | 'PROP'
  | 'RELI'
  | 'RESI'
  | 'TITL'
  | 'FACT';

export type FamilyEventTag =
  | 'ANUL'
  | 'CENS'
  | 'DIV'
  | 'DIVF'
  | 'ENGA'
  | 'MARB'
  | 'MARC'
  | 'MARL'
  | 'MARR'
  | 'MARS'
  | 'EVEN';

export type FamilyAttributeTag = 'NCHI' | 'RESI' | 'FACT';

export interface IndividualEvent {
  readonly tag: IndividualEventTag;
  readonly date?: GenDate;
  readonly place?: Place;
  /** The `AGE` payload, in the standard's age grammar. */
  readonly age?: string;
  readonly agePhrase?: string;
  /** The `TYPE` substructure, which the standard requires for `EVEN`. */
  readonly type?: string;
  /** `CAUS` */
  readonly cause?: string;
  /**
   * True where the payload was `Y`: the event is asserted to have happened, with no further
   * detail. Absent where detail was given, since the assertion is then implied.
   */
  readonly occurred?: boolean;
  /** The `FAMC` substructure the standard allows on `BIRT`, `CHR` and `ADOP`. */
  readonly familyAsChild?: Pointer;
  /** `ADOP` under `FAMC`: which parent of that family adopted. */
  readonly adoptedBy?: 'HUSB' | 'WIFE' | 'BOTH';
  readonly extensions?: Extensions;
}

/**
 * An individual attribute.
 *
 * The standard keeps these apart from events, and the distinction is real: an attribute states a
 * value -- an occupation, a title, a number of children -- where an event states that something
 * happened. Collapsing the two would mean inventing a rule about where the value goes.
 */
export interface IndividualAttribute {
  readonly tag: IndividualAttributeTag;
  readonly value?: string;
  readonly date?: GenDate;
  readonly place?: Place;
  readonly age?: string;
  readonly agePhrase?: string;
  /** The `TYPE` substructure, which the standard requires for `FACT`. */
  readonly type?: string;
  readonly cause?: string;
  readonly extensions?: Extensions;
}

export interface FamilyEvent {
  readonly tag: FamilyEventTag;
  readonly date?: GenDate;
  readonly place?: Place;
  readonly type?: string;
  readonly cause?: string;
  readonly occurred?: boolean;
  /** `HUSB.AGE` */
  readonly husbandAge?: string;
  /** `WIFE.AGE` */
  readonly wifeAge?: string;
  readonly extensions?: Extensions;
}

export interface FamilyAttribute {
  readonly tag: FamilyAttributeTag;
  readonly value?: string;
  readonly date?: GenDate;
  readonly place?: Place;
  readonly type?: string;
  readonly extensions?: Extensions;
}

/** The `RESN` payload, which the standard permits as a comma-separated list. */
export type Restriction = 'CONFIDENTIAL' | 'LOCKED' | 'PRIVACY';

export type Pedigree = 'ADOPTED' | 'BIRTH' | 'FOSTER' | 'SEALING' | 'OTHER';

export type ChildStatus = 'CHALLENGED' | 'DISPROVEN' | 'PROVEN';

/**
 * A `FAMC` link: this person as a child of that family.
 *
 * `pedigree` and `status` are the reason parentage is a link with properties rather than a bare
 * pointer. An adoptive link and a birth link are both true, and a link somebody has disproven is
 * not the same as one nobody has examined.
 */
export interface FamilyLinkAsChild {
  readonly xref: Pointer;
  /** `PEDI` */
  readonly pedigree?: Pedigree;
  readonly pedigreePhrase?: string;
  /** `STAT` */
  readonly status?: ChildStatus;
  readonly statusPhrase?: string;
  readonly extensions?: Extensions;
}

/** A `FAMS` link: this person as a partner in that family. */
export interface FamilyLinkAsSpouse {
  readonly xref: Pointer;
  readonly extensions?: Extensions;
}

/**
 * `M` male, `F` female, `X` neither, `U` undetermined. GEDCOM 7 added `X`; 5.5.1 has no such
 * value, so an import from it never yields one and an export to it must decide what to do.
 */
export type Sex = 'M' | 'F' | 'X' | 'U';

/** An `INDI` record. */
export interface Individual {
  readonly xref: Xref;
  readonly restriction?: readonly Restriction[];
  readonly names?: readonly GenName[];
  readonly sex?: Sex;
  readonly events?: readonly IndividualEvent[];
  readonly attributes?: readonly IndividualAttribute[];
  readonly familiesAsChild?: readonly FamilyLinkAsChild[];
  readonly familiesAsSpouse?: readonly FamilyLinkAsSpouse[];
  readonly extensions?: Extensions;
}

/**
 * A `FAM` record.
 *
 * Families are records in their own right, which is what lets the graph express remarriage
 * without lying: a person points at each family they partnered in, rather than carrying one set
 * of parent fields that a second marriage would have to overwrite.
 *
 * `husband` and `wife` are the standard's tags. They are role names inherited from earlier
 * versions and carry no requirement about the partners themselves.
 */
export interface Family {
  readonly xref: Xref;
  readonly restriction?: readonly Restriction[];
  /** `HUSB` */
  readonly husband?: Pointer;
  /** `WIFE` */
  readonly wife?: Pointer;
  /** `CHIL` */
  readonly children?: readonly Pointer[];
  readonly events?: readonly FamilyEvent[];
  readonly attributes?: readonly FamilyAttribute[];
  readonly extensions?: Extensions;
}

/**
 * The `HEAD` record. The standard requires exactly one substructure of it -- `GEDC.VERS`, stating
 * the specification the dataset claims to follow -- which is why it is the only required field.
 */
export interface Header {
  /** `HEAD.GEDC.VERS` */
  readonly gedcomVersion: string;
  /** `HEAD.SOUR`: the application that produced the file. */
  readonly sourceSystem?: string;
  readonly sourceName?: string;
  readonly sourceVersion?: string;
  /** `HEAD.DEST` */
  readonly destination?: string;
  readonly date?: GenDate;
  readonly submitter?: Pointer;
  readonly copyright?: string;
  readonly language?: string;
  /** `HEAD.PLAC.FORM` */
  readonly placeForm?: readonly string[];
  readonly extensions?: Extensions;
}

export type Dialect = '7.0' | '5.5.1';

/**
 * How this document was obtained.
 *
 * Not part of GEDCOM, and deliberately the only part of the model that is not. Writing a 5.5.1
 * file back as 5.5.1, in the encoding it declared, means remembering both -- and neither belongs
 * in a record, because they describe the file rather than anyone in it.
 */
export interface Origin {
  readonly dialect?: Dialect;
  /**
   * True where the version was guessed rather than read from `HEAD.GEDC.VERS`. Recorded so the
   * guess can be surfaced to the user instead of kept quiet.
   */
  readonly dialectInferred?: boolean;
  /** `UTF-8`, `ANSEL`, `ANSI`, `ASCII` or `UNICODE`, as the file declared it. */
  readonly encoding?: string;
  readonly fileName?: string;
}

export interface GedcomDoc {
  readonly header: Header;
  readonly individuals: readonly Individual[];
  readonly families: readonly Family[];
  /** `SOUR`, `REPO`, `OBJE`, `SNOTE`, `SUBM` and extension records, kept verbatim. */
  readonly otherRecords?: readonly GedcomRecord[];
  readonly origin?: Origin;
}
