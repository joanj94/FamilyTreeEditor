/**
 * The editing operations: document in, new document out.
 *
 * Nothing here mutates. Every operation returns a fresh document and leaves the one it was given
 * exactly as it was, which is what makes undo a matter of keeping a list rather than of computing
 * an inverse for each edit.
 *
 * **Both halves of a link move together.** GEDCOM records every relationship twice -- the family
 * lists `CHIL` and `HUSB`/`WIFE`, the person lists `FAMC` and `FAMS` -- and the two agreeing is
 * not something a caller should have to remember. So there is no operation that writes one side:
 * `linkChild` writes both, `removeIndividual` withdraws the person from every family that named
 * them, and `setPartner` unlinks whoever it displaced. Where a document arrives with only one
 * side recorded, these operations repair the pair rather than adding a second copy of it.
 *
 * **An operation applies or refuses.** A refusal throws an `OperationError` and returns nothing,
 * so the caller still holds the document it started with; there is no half-applied edit to undo.
 * The refusals are deliberate and few: a record that does not exist, a link that already exists,
 * and -- the one that matters -- an edit that would make someone their own ancestor. That last
 * check belongs here because a cycle written into the document is a cycle in the user's file, and
 * every consumer downstream, layout first among them, would then have to cope with it.
 *
 * Field edits and link edits are kept apart on purpose: `updateIndividual` cannot touch
 * `familiesAsChild` or `familiesAsSpouse`, because those have operations that keep the other side
 * in step. The type says so, so it is not a convention anyone has to hold in mind.
 */
import { makeTranslate } from '../i18n/catalog.js';
import {
  EN,
  ref as messageRef,
  type MessageKey,
  type MessageParams,
  type MessageRef,
} from '../i18n/keys.js';
import { indexDoc, isAncestorOf, isVoid, partnersOf } from './graph.js';
import { nextFamilyXref, nextIndividualXref } from './xref.js';
import type {
  Family,
  FamilyLinkAsChild,
  FamilyLinkAsSpouse,
  GedcomDoc,
  Individual,
  Xref,
} from './types.js';

/* What `Error.message` is written in. Fixed to English rather than following the user, because a
   stack trace and a test failure are read by whoever maintains this, wherever they are. */
const inEnglish = makeTranslate('en', EN);

export type OperationErrorCode =
  /** The document contains no record with that identifier. */
  | 'UNKNOWN_RECORD'
  /** The link being added is already there. */
  | 'DUPLICATE_LINK'
  /** The link being removed is not there. */
  | 'NOT_LINKED'
  /** The edit would make someone their own ancestor. */
  | 'WOULD_CREATE_CYCLE'
  /** The edit is contradictory in some other way. */
  | 'INVALID_ARGUMENT';

/**
 * A refused edit. The document the caller holds is unchanged.
 *
 * **It carries the refusal twice, on purpose.** `message` is English and is what a stack trace, a
 * console and a test failure show -- an `Error` with no readable message is a bad `Error`. `ref` is
 * the same refusal addressed to the user, rendered in whatever language they are reading, and is
 * what the editor puts on screen. Neither substitutes for the other: one is for whoever is
 * debugging this, the other for whoever is doing genealogy.
 */
export class OperationError extends Error {
  readonly code: OperationErrorCode;

  /** The refusal as a message the UI can render in the current language. */
  readonly ref: MessageRef;

  constructor(code: OperationErrorCode, key: MessageKey, params?: MessageParams) {
    const named = messageRef(key, params);
    super(inEnglish(named));
    this.name = 'OperationError';
    this.code = code;
    this.ref = named;
  }
}

/** The fields of a person that are theirs alone. Family links are edited through their own ops. */
export type IndividualFields = Omit<
  Individual,
  'xref' | 'familiesAsChild' | 'familiesAsSpouse'
>;

/** A change to those fields. A key present and undefined clears the field. */
export type IndividualPatch = {
  [K in keyof IndividualFields]?: IndividualFields[K] | undefined;
};

/** The fields of a family that are not links. */
export type FamilyFields = Omit<Family, 'xref' | 'husband' | 'wife' | 'children'>;

export type FamilyPatch = { [K in keyof FamilyFields]?: FamilyFields[K] | undefined };

/** The standard's two partner slots. Role names inherited from earlier versions. */
export type PartnerRole = 'HUSB' | 'WIFE';

/** A new family, described by who is in it. */
export interface UnionDraft {
  readonly husband?: Xref;
  readonly wife?: Xref;
  readonly children?: readonly Xref[];
}

/** The result of an operation that creates a record: the document, and what it was called. */
export interface AddResult {
  readonly doc: GedcomDoc;
  readonly xref: Xref;
}

function requireIndividual(doc: GedcomDoc, xref: Xref): Individual {
  const found = doc.individuals.find((individual) => individual.xref === xref);
  if (found === undefined) {
    throw new OperationError('UNKNOWN_RECORD', 'ops.noPerson', { xref });
  }
  return found;
}

function requireFamily(doc: GedcomDoc, xref: Xref): Family {
  const found = doc.families.find((family) => family.xref === xref);
  if (found === undefined) {
    throw new OperationError('UNKNOWN_RECORD', 'ops.noFamily', { xref });
  }
  return found;
}

/**
 * Rebuild a person with the links given.
 *
 * An empty list is dropped rather than kept: `familiesAsChild: []` is not "a person known to be
 * nobody's child", it is a leftover, and the serializer should not have to tell them apart.
 */
function withLinks(
  individual: Individual,
  asChild: readonly FamilyLinkAsChild[],
  asSpouse: readonly FamilyLinkAsSpouse[],
): Individual {
  const { familiesAsChild: _asChild, familiesAsSpouse: _asSpouse, ...rest } = individual;
  return {
    ...rest,
    ...(asChild.length > 0 ? { familiesAsChild: asChild } : {}),
    ...(asSpouse.length > 0 ? { familiesAsSpouse: asSpouse } : {}),
  };
}

/** Rebuild a family with the members given, dropping the slots and lists that are now empty. */
function withMembers(
  family: Family,
  members: {
    readonly husband?: Xref | undefined;
    readonly wife?: Xref | undefined;
    readonly children: readonly Xref[];
  },
): Family {
  const { husband: _husband, wife: _wife, children: _children, ...rest } = family;
  return {
    ...rest,
    ...(members.husband === undefined ? {} : { husband: members.husband }),
    ...(members.wife === undefined ? {} : { wife: members.wife }),
    ...(members.children.length > 0 ? { children: members.children } : {}),
  };
}

function replaceIndividual(doc: GedcomDoc, individual: Individual): GedcomDoc {
  return {
    ...doc,
    individuals: doc.individuals.map((current) =>
      current.xref === individual.xref ? individual : current,
    ),
  };
}

function replaceFamily(doc: GedcomDoc, family: Family): GedcomDoc {
  return {
    ...doc,
    families: doc.families.map((current) => (current.xref === family.xref ? family : current)),
  };
}

/* A patch is applied key by key, because a key that is present and undefined means "clear this",
   which is not the same as a key that is absent. The cast is confined to this one function: the
   patch types above are what make it sound. */
function applyPatch<T extends object>(record: T, patch: object): T {
  const merged: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged as T;
}

/**
 * Refuse an edge that would close a loop.
 *
 * The edge runs from a parent down to a child. It closes a loop exactly when the child already
 * stands above the parent -- or is the parent. Checked before anything is written, so a refusal
 * leaves nothing behind.
 */
function assertNoCycle(doc: GedcomDoc, parents: readonly Xref[], child: Xref): void {
  const index = indexDoc(doc);
  for (const parent of parents) {
    if (parent === child) {
      throw new OperationError('WOULD_CREATE_CYCLE', 'ops.partnerAndChild', { xref: child });
    }
    if (isAncestorOf(index, child, parent)) {
      throw new OperationError('WOULD_CREATE_CYCLE', 'ops.wouldBeOwnAncestor', {
        xref: child,
        parent,
      });
    }
  }
}

/** Add a person. The identifier is allocated; the fields are whatever the caller supplies. */
export function addIndividual(doc: GedcomDoc, fields: IndividualFields = {}): AddResult {
  const xref = nextIndividualXref(doc);
  const individual: Individual = { xref, ...fields };
  return { doc: { ...doc, individuals: [...doc.individuals, individual] }, xref };
}

/** Change a person's own fields. Family links are not reachable from here, by design. */
export function updateIndividual(
  doc: GedcomDoc,
  xref: Xref,
  patch: IndividualPatch,
): GedcomDoc {
  const individual = requireIndividual(doc, xref);
  return replaceIndividual(doc, applyPatch(individual, patch));
}

/** Remove a person, and withdraw them from every family that named them. */
export function removeIndividual(doc: GedcomDoc, xref: Xref): GedcomDoc {
  requireIndividual(doc, xref);
  return {
    ...doc,
    individuals: doc.individuals.filter((individual) => individual.xref !== xref),
    families: doc.families.map((family) =>
      withMembers(family, {
        husband: family.husband === xref ? undefined : family.husband,
        wife: family.wife === xref ? undefined : family.wife,
        children: (family.children ?? []).filter((child) => child !== xref),
      }),
    ),
  };
}

/** Change a family's own fields. Membership is edited through `setPartner` and `linkChild`. */
export function updateFamily(doc: GedcomDoc, xref: Xref, patch: FamilyPatch): GedcomDoc {
  const family = requireFamily(doc, xref);
  return replaceFamily(doc, applyPatch(family, patch));
}

/** Remove a family, and the links its members held to it. The people themselves stay. */
export function removeFamily(doc: GedcomDoc, xref: Xref): GedcomDoc {
  requireFamily(doc, xref);
  return {
    ...doc,
    families: doc.families.filter((family) => family.xref !== xref),
    individuals: doc.individuals.map((individual) =>
      withLinks(
        individual,
        (individual.familiesAsChild ?? []).filter((link) => link.xref !== xref),
        (individual.familiesAsSpouse ?? []).filter((link) => link.xref !== xref),
      ),
    ),
  };
}

/**
 * Fill or clear one of a family's partner slots.
 *
 * Whoever occupied the slot loses their link to the family, and whoever takes it gains one. Pass
 * `null` to empty the slot.
 */
export function setPartner(
  doc: GedcomDoc,
  familyXref: Xref,
  role: PartnerRole,
  individualXref: Xref | null,
): GedcomDoc {
  const family = requireFamily(doc, familyXref);
  const occupant = role === 'HUSB' ? family.husband : family.wife;
  const otherSlot = role === 'HUSB' ? family.wife : family.husband;

  if (individualXref !== null) {
    requireIndividual(doc, individualXref);
    if (otherSlot === individualXref) {
      throw new OperationError('INVALID_ARGUMENT', 'ops.partnerSlotTaken', {
        xref: individualXref,
        family: familyXref,
      });
    }
    /* The new partner becomes a parent of everyone the family already lists as a child. */
    for (const child of family.children ?? []) {
      assertNoCycle(doc, [individualXref], child);
    }
  }

  let next = doc;

  if (occupant !== undefined && !isVoid(occupant) && occupant !== individualXref) {
    const previous = next.individuals.find((individual) => individual.xref === occupant);
    if (previous !== undefined) {
      next = replaceIndividual(
        next,
        withLinks(
          previous,
          previous.familiesAsChild ?? [],
          (previous.familiesAsSpouse ?? []).filter((link) => link.xref !== familyXref),
        ),
      );
    }
  }

  if (individualXref !== null) {
    const individual = requireIndividual(next, individualXref);
    const links = individual.familiesAsSpouse ?? [];
    next = replaceIndividual(
      next,
      withLinks(individual, individual.familiesAsChild ?? [], [
        ...links.filter((link) => link.xref !== familyXref),
        { xref: familyXref },
      ]),
    );
  }

  const assigned = individualXref ?? undefined;
  return replaceFamily(
    next,
    withMembers(family, {
      husband: role === 'HUSB' ? assigned : family.husband,
      wife: role === 'WIFE' ? assigned : family.wife,
      children: family.children ?? [],
    }),
  );
}

/** Record a person as a child of a family, on both sides of the link. */
export function linkChild(
  doc: GedcomDoc,
  familyXref: Xref,
  childXref: Xref,
  link: Omit<FamilyLinkAsChild, 'xref'> = {},
): GedcomDoc {
  const family = requireFamily(doc, familyXref);
  const child = requireIndividual(doc, childXref);
  const children = family.children ?? [];

  if (children.includes(childXref)) {
    throw new OperationError('DUPLICATE_LINK', 'ops.alreadyChild', {
      xref: childXref,
      family: familyXref,
    });
  }
  assertNoCycle(doc, partnersOf(family), childXref);

  const nextChild = withLinks(
    child,
    [
      ...(child.familiesAsChild ?? []).filter((existing) => existing.xref !== familyXref),
      { xref: familyXref, ...link },
    ],
    child.familiesAsSpouse ?? [],
  );
  const nextFamily = withMembers(family, {
    husband: family.husband,
    wife: family.wife,
    children: [...children, childXref],
  });

  return replaceFamily(replaceIndividual(doc, nextChild), nextFamily);
}

/** Withdraw a person from a family's children, on both sides of the link. */
export function unlinkChild(doc: GedcomDoc, familyXref: Xref, childXref: Xref): GedcomDoc {
  const family = requireFamily(doc, familyXref);
  const child = requireIndividual(doc, childXref);
  const children = family.children ?? [];
  const linkedFromChild = (child.familiesAsChild ?? []).some(
    (link) => link.xref === familyXref,
  );

  if (!children.includes(childXref) && !linkedFromChild) {
    throw new OperationError('NOT_LINKED', 'ops.notChild', {
      xref: childXref,
      family: familyXref,
    });
  }

  const nextChild = withLinks(
    child,
    (child.familiesAsChild ?? []).filter((link) => link.xref !== familyXref),
    child.familiesAsSpouse ?? [],
  );
  const nextFamily = withMembers(family, {
    husband: family.husband,
    wife: family.wife,
    children: children.filter((current) => current !== childXref),
  });

  return replaceFamily(replaceIndividual(doc, nextChild), nextFamily);
}

/**
 * Create a family.
 *
 * Built by applying the same operations a user would: the partners are set and the children
 * linked, so a draft that would produce a cycle is refused by the same check that guards an edit
 * made later. Nothing is returned until every step has succeeded.
 */
export function createUnion(doc: GedcomDoc, draft: UnionDraft = {}): AddResult {
  const xref = nextFamilyXref(doc);
  let next: GedcomDoc = { ...doc, families: [...doc.families, { xref }] };

  if (draft.husband !== undefined) next = setPartner(next, xref, 'HUSB', draft.husband);
  if (draft.wife !== undefined) next = setPartner(next, xref, 'WIFE', draft.wife);
  for (const child of draft.children ?? []) next = linkChild(next, xref, child);

  return { doc: next, xref };
}
