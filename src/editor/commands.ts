/**
 * Edits, as things that can be named, applied, refused and undone.
 *
 * A command is a label and a pure function from document to document. It is the layer between a
 * form and `model/ops`, and it exists for two reasons.
 *
 * **A user's edit is not always one operation.** "Add parents" is two people, a family, and three
 * links; "delete" withdraws a person from every family that named them. A command is the unit the
 * user thinks in, so it is also the unit undo works in -- half of an add-parents is not a state
 * anyone asked for and not one they should have to step back through.
 *
 * **Both gates run before anything is recorded.** `apply` runs the command, then checks the result
 * against the schema and against `audit()`; if either refuses, the edit does not happen and the
 * caller still holds the document it had. That is what "never allowed into an invalid state" means
 * in practice: not that the user is warned afterwards, but that the state never exists. The
 * operations already refuse impossible links; this is the outer belt.
 */
import { audit, auditErrors } from '../model/audit.js';
import { sortByBirth } from '../model/sort.js';
import { validateDoc } from '../model/validate.js';
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
  type FamilyPatch,
  type IndividualFields,
  type IndividualPatch,
  type PartnerRole,
} from '../model/ops.js';
import { ref, type MessageRef } from '../i18n/keys.js';
import { commit, type History } from './history.js';
import type { GedcomDoc, Xref } from '../model/types.js';

export interface CommandResult {
  readonly doc: GedcomDoc;
  /** A record the command brought into being, so the caller can select it. */
  readonly created?: Xref;
}

/** One named edit. Pure: it returns a new document and touches nothing. */
export interface Command {
  /** Phrased for an undo menu, in the imperative: "Add a child". Named, so it can be re-read. */
  readonly label: MessageRef;
  readonly run: (doc: GedcomDoc) => CommandResult;
}

/**
 * Why an edit did not happen, in parts rather than as one sentence.
 *
 * **Nothing is translated here.** The obvious shape -- one `MessageRef` whose params hold the
 * already-rendered command name and cause -- would bake the language in at the moment of refusal,
 * so a reader who switched to Catalan afterwards would meet a Catalan sentence with English
 * clauses inside it. Keeping the pieces apart lets the UI render all three together, in whatever
 * language is current when they are read.
 */
export interface Refusal {
  /** The refusal itself: what went wrong. */
  readonly say: MessageRef;
  /** The edit that was attempted, where naming it helps. */
  readonly label?: MessageRef;
  /** The underlying finding, where one caused the refusal. */
  readonly cause?: MessageRef;
}

export type Applied =
  | { readonly ok: true; readonly history: History; readonly created?: Xref }
  /** The edit did not happen. `problem` is addressed to the user, not to a log. */
  | { readonly ok: false; readonly problem: Refusal };

/**
 * Run a command, check it, and record it -- or refuse it and change nothing.
 *
 * The order matters: the schema first, because an audit over a malformed document reports
 * confusing things; then referential integrity. Warnings never block, since a person joined to
 * nobody is the ordinary result of adding one.
 */
export function apply(history: History, command: Command): Applied {
  let result: CommandResult;
  try {
    result = command.run(history.present.doc);
  } catch (error) {
    /* The operation refused in its own words, which are already addressed to the user and need
       nothing wrapped around them. */
    if (error instanceof OperationError) return { ok: false, problem: { say: error.ref } };
    throw error;
  }

  const validation = validateDoc(result.doc);
  if (!validation.ok) {
    const first = validation.errors[0];
    const detail = first === undefined ? '' : `: ${first.path} ${first.message}`;
    return {
      ok: false,
      problem: { say: ref('command.refusedInvalid', { detail }), label: command.label },
    };
  }

  const broken = auditErrors(audit(result.doc));
  const firstBroken = broken[0];
  if (firstBroken !== undefined) {
    return {
      ok: false,
      problem: {
        say: ref('command.refusedBroken'),
        label: command.label,
        cause: firstBroken.message,
      },
    };
  }

  return {
    ok: true,
    history: commit(history, result.doc, command.label),
    ...(result.created === undefined ? {} : { created: result.created }),
  };
}

/**
 * Put the whole document in the order things happened.
 *
 * One command rather than one per family, because it is one thing the user asked for: stepping
 * back through a hundred reordered sibling lists is not an undo anybody wants. It reorders lists
 * whose order GEDCOM attaches no meaning to and rewrites no pointer, so the gates in `apply` have
 * nothing to object to -- they run anyway, since a sort that somehow broke a link is exactly the
 * fault worth catching before it reaches the undo stack rather than after.
 *
 * The sort runs again here rather than closing over a document computed elsewhere. It is
 * idempotent, so the second run costs a comparison per record and buys the command the property
 * every other one in this file has: it is a pure function of the document it is handed.
 */
export function sortByBirthDate(): Command {
  return {
    label: ref('command.sortByBirth'),
    run: (doc) => ({ doc: sortByBirth(doc).doc }),
  };
}

/** Change a person's own fields. */
export function editPerson(
  xref: Xref,
  patch: IndividualPatch,
  label: MessageRef = ref('command.editPerson'),
): Command {
  return { label, run: (doc) => ({ doc: updateIndividual(doc, xref, patch) }) };
}

/** Change a family's own fields. */
export function editUnion(
  xref: Xref,
  patch: FamilyPatch,
  label: MessageRef = ref('command.editUnion'),
): Command {
  return { label, run: (doc) => ({ doc: updateFamily(doc, xref, patch) }) };
}

/** Add a person who is joined to nobody yet. */
export function addPerson(fields: IndividualFields = {}): Command {
  return {
    label: ref('command.addPerson'),
    run: (doc) => {
      const { doc: next, xref } = addIndividual(doc, fields);
      return { doc: next, created: xref };
    },
  };
}

/** Add a child to a family: a new person, and both sides of the link. */
export function addChild(family: Xref, fields: IndividualFields = {}): Command {
  return {
    label: ref('command.addChild'),
    run: (doc) => {
      const { doc: withPerson, xref } = addIndividual(doc, fields);
      return { doc: linkChild(withPerson, family, xref), created: xref };
    },
  };
}

/**
 * Add a partner for someone.
 *
 * A new family is created rather than a free slot being filled in an existing one: a second
 * partner in the same family would mean two marriages recorded as one, which is exactly the shape
 * this chart exists to keep apart.
 */
export function addSpouse(person: Xref, fields: IndividualFields = {}): Command {
  return {
    label: ref('command.addPartner'),
    run: (doc) => {
      const { doc: withPerson, xref } = addIndividual(doc, fields);
      const union = createUnion(withPerson, { husband: person, wife: xref });
      return { doc: union.doc, created: xref };
    },
  };
}

/**
 * Give someone parents: two people, and a family they are the child of.
 *
 * Both parents are created even where only one is known. A family with one partner and a family
 * whose second partner is not yet filled in are the same thing to a reader, and the second can be
 * named later without restructuring anything.
 */
export function addParents(person: Xref): Command {
  return {
    label: ref('command.addParents'),
    run: (doc) => {
      const father = addIndividual(doc, { sex: 'M' });
      const mother = addIndividual(father.doc, { sex: 'F' });
      const union = createUnion(mother.doc, {
        husband: father.xref,
        wife: mother.xref,
        children: [person],
      });
      return { doc: union.doc, created: father.xref };
    },
  };
}

/** Put an existing person into a partner slot, or empty it. */
export function setPartnerTo(family: Xref, role: PartnerRole, person: Xref | null): Command {
  return {
    label: person === null ? ref('command.removePartner') : ref('command.setPartner'),
    run: (doc) => ({ doc: setPartner(doc, family, role, person) }),
  };
}

/** Link an existing person to a family as a child. */
export function attachChild(family: Xref, child: Xref): Command {
  return {
    label: ref('command.attachChild'),
    run: (doc) => ({ doc: linkChild(doc, family, child) }),
  };
}

/** Take a child out of a family. The person stays; only the link goes. */
export function detachChild(family: Xref, child: Xref): Command {
  return {
    label: ref('command.detachChild'),
    run: (doc) => ({ doc: unlinkChild(doc, family, child) }),
  };
}

/** Remove a person, and every reference to them. */
export function deletePerson(xref: Xref): Command {
  return {
    label: ref('command.deletePerson'),
    run: (doc) => ({ doc: removeIndividual(doc, xref) }),
  };
}

/** Remove a family. The people in it stay. */
export function deleteUnion(xref: Xref): Command {
  return {
    label: ref('command.deleteUnion'),
    run: (doc) => ({ doc: removeFamily(doc, xref) }),
  };
}
