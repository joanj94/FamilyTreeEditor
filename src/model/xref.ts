/**
 * Identifier allocation.
 *
 * Two rules, and both of them are about not corrupting a file the user already has.
 *
 * **Uniqueness is document-wide.** GEDCOM identifiers are unique across the whole dataset, and
 * the standard attaches no meaning to their shape: `@I1@` may name a source and `@F3@` a person.
 * Allocation therefore looks at every record in the document -- including the ones this editor
 * keeps verbatim and has no opinion about -- rather than at the list being appended to.
 *
 * **Numbers are never reused.** A freed identifier stays free. The undo stack holds earlier
 * documents whose pointers still name it, and handing it to a different person would turn an undo
 * into a silent rewrite. Continuing past the highest number in use costs nothing and removes the
 * whole class of problem.
 *
 * Padding is preserved because the user reads these identifiers: a file written by GDS numbers
 * its people `@I0001@`, and appending `@I2@` to it advertises that a second tool has been at it.
 */
import { XREF_PATTERN, type GedcomDoc, type Xref } from './types.js';

/** The prefix conventionally given to individuals. A convention, not a rule of the standard. */
export const INDIVIDUAL_PREFIX = 'I';

/** The prefix conventionally given to families. */
export const FAMILY_PREFIX = 'F';

/** The characters the standard allows in an identifier, which a prefix must therefore keep to. */
const PREFIX_PATTERN = /^[A-Z0-9_]+$/;

/** Every identifier the document has issued, of any record type. */
export function collectXrefs(doc: GedcomDoc): ReadonlySet<Xref> {
  const used = new Set<Xref>();
  for (const individual of doc.individuals) used.add(individual.xref);
  for (const family of doc.families) used.add(family.xref);
  for (const record of doc.otherRecords ?? []) used.add(record.xref);
  return used;
}

/**
 * The next free identifier of the form `@{prefix}{number}@`.
 *
 * `used` is read, never written: a caller allocating several identifiers before committing any of
 * them threads its own growing set through successive calls.
 */
export function nextXref(used: ReadonlySet<Xref>, prefix: string): Xref {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `Identifier prefix must be one or more of A-Z, 0-9 and _ so that the result matches the ` +
        `standard's grammar (observed: ${JSON.stringify(prefix)}).`,
    );
  }

  const numbered = new RegExp('^@' + prefix + '([0-9]+)@$');
  let highest = 0;
  let width = 1;
  for (const xref of used) {
    const digits = numbered.exec(xref)?.[1];
    if (digits === undefined) continue;
    highest = Math.max(highest, Number(digits));
    width = Math.max(width, digits.length);
  }

  const allocated = `@${prefix}${String(highest + 1).padStart(width, '0')}@`;
  /* Unreachable by construction -- the number is strictly greater than every number in use -- but
     an identifier collision would corrupt a user's file quietly, so it is asserted rather than
     assumed. */
  if (used.has(allocated) || !XREF_PATTERN.test(allocated)) {
    throw new Error(`Allocated an unusable identifier ${allocated}. This is a bug.`);
  }
  return allocated;
}

/** The next free identifier for a new individual. */
export function nextIndividualXref(doc: GedcomDoc): Xref {
  return nextXref(collectXrefs(doc), INDIVIDUAL_PREFIX);
}

/** The next free identifier for a new family. */
export function nextFamilyXref(doc: GedcomDoc): Xref {
  return nextXref(collectXrefs(doc), FAMILY_PREFIX);
}
