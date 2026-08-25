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
import { commit, type History } from './history.js';
import type { GedcomDoc, Xref } from '../model/types.js';

export interface CommandResult {
  readonly doc: GedcomDoc;
  /** A record the command brought into being, so the caller can select it. */
  readonly created?: Xref;
}

/** One named edit. Pure: it returns a new document and touches nothing. */
export interface Command {
  /** Phrased for an undo menu, in the imperative: "Add a child". */
  readonly label: string;
  readonly run: (doc: GedcomDoc) => CommandResult;
}

export type Applied =
  | { readonly ok: true; readonly history: History; readonly created?: Xref }
  /** The edit did not happen. `problem` is addressed to the user, not to a log. */
  | { readonly ok: false; readonly problem: string };

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
    if (error instanceof OperationError) return { ok: false, problem: error.message };
    throw error;
  }

  const validation = validateDoc(result.doc);
  if (!validation.ok) {
    const first = validation.errors[0];
    const detail = first === undefined ? '' : `: ${first.path} ${first.message}`;
    return {
      ok: false,
      problem: `${command.label} would produce an invalid document${detail}.`,
    };
  }

  const broken = auditErrors(audit(result.doc));
  const firstBroken = broken[0];
  if (firstBroken !== undefined) {
    return {
      ok: false,
      problem: `${command.label} would break the tree: ${firstBroken.message}`,
    };
  }

  return {
    ok: true,
    history: commit(history, result.doc, command.label),
    ...(result.created === undefined ? {} : { created: result.created }),
  };
}

/** Change a person's own fields. */
export function editPerson(xref: Xref, patch: IndividualPatch, label = 'Edit person'): Command {
  return { label, run: (doc) => ({ doc: updateIndividual(doc, xref, patch) }) };
}

/** Change a family's own fields. */
export function editUnion(xref: Xref, patch: FamilyPatch, label = 'Edit union'): Command {
  return { label, run: (doc) => ({ doc: updateFamily(doc, xref, patch) }) };
}

/** Add a person who is joined to nobody yet. */
export function addPerson(fields: IndividualFields = {}): Command {
  return {
    label: 'Add a person',
    run: (doc) => {
      const { doc: next, xref } = addIndividual(doc, fields);
      return { doc: next, created: xref };
    },
  };
}

/** Add a child to a family: a new person, and both sides of the link. */
export function addChild(family: Xref, fields: IndividualFields = {}): Command {
  return {
    label: 'Add a child',
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
    label: 'Add a partner',
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
    label: 'Add parents',
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
    label: person === null ? 'Remove a partner' : 'Set a partner',
    run: (doc) => ({ doc: setPartner(doc, family, role, person) }),
  };
}

/** Link an existing person to a family as a child. */
export function attachChild(family: Xref, child: Xref): Command {
  return { label: 'Attach a child', run: (doc) => ({ doc: linkChild(doc, family, child) }) };
}

/** Take a child out of a family. The person stays; only the link goes. */
export function detachChild(family: Xref, child: Xref): Command {
  return { label: 'Detach a child', run: (doc) => ({ doc: unlinkChild(doc, family, child) }) };
}

/** Remove a person, and every reference to them. */
export function deletePerson(xref: Xref): Command {
  return { label: 'Delete a person', run: (doc) => ({ doc: removeIndividual(doc, xref) }) };
}

/** Remove a family. The people in it stay. */
export function deleteUnion(xref: Xref): Command {
  return { label: 'Delete a union', run: (doc) => ({ doc: removeFamily(doc, xref) }) };
}
