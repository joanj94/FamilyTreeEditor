/**
 * Referential integrity: the half of correctness a schema cannot check.
 *
 * `validateDoc()` asks whether each record is well-formed. This asks whether the records agree
 * with each other -- whether a family names a person who exists, whether a link recorded by one
 * side is recorded by the other, whether anyone is their own ancestor. Both gates run before
 * export and neither substitutes for the other. This module is a port of `graph.audit` from the
 * companion pipeline, widened for GEDCOM 7, where every link is written down twice.
 *
 * **Everything is reported; nothing is raised.** Someone repairing an imported file wants the
 * whole list, not the first fault and then another run.
 *
 * **Errors and warnings are different claims.** An error means this editor would write the
 * document back out wrongly: a pointer to nothing, a link only half recorded, a cycle no layout
 * can draw. A warning means a genealogist may want to look, and may equally have meant it -- a
 * person not yet joined to anyone, a child of both a birth family and an adoptive one. The
 * distinction has to exist, because `addIndividual` creates an unconnected person as its ordinary
 * first step, and a tool that then refused to save would be unusable. `isAuditClean` therefore
 * means "no errors", and warnings never block.
 */
import {
  ancestorsOf,
  indexDoc,
  isVoid,
  membersOf,
  parentFamiliesOf,
  parentsOf,
  partnersOf,
  type GedcomIndex,
} from './graph.js';
import type { GedcomDoc, Pointer, Xref } from './types.js';

export type AuditSeverity = 'error' | 'warning';

export type AuditCode =
  /** One identifier issued to more than one record. */
  | 'DUPLICATE_XREF'
  /** A pointer naming a record the document does not contain. */
  | 'DANGLING_POINTER'
  /** A link written down by one side of the pair and not the other. */
  | 'ASYMMETRIC_LINK'
  /** The same link written down twice by the same record. */
  | 'DUPLICATE_LINK'
  /** A person who is their own ancestor. */
  | 'DESCENT_CYCLE'
  /** A child of more than one family: legal, and worth a second look. */
  | 'CHILD_OF_SEVERAL_FAMILIES'
  /** A person no family names. */
  | 'UNCONNECTED_PERSON';

/** One problem, addressed to the record a user would open to fix it. */
export interface AuditFinding {
  readonly code: AuditCode;
  readonly severity: AuditSeverity;
  /** Prose naming the records involved, renderable without knowing the codes. */
  readonly message: string;
  /** The record the problem was found in. */
  readonly xref?: Xref;
  /** The other records the problem involves, in document order. */
  readonly related?: readonly Xref[];
}

const SEVERITY: Record<AuditCode, AuditSeverity> = {
  DUPLICATE_XREF: 'error',
  DANGLING_POINTER: 'error',
  ASYMMETRIC_LINK: 'error',
  DUPLICATE_LINK: 'error',
  DESCENT_CYCLE: 'error',
  CHILD_OF_SEVERAL_FAMILIES: 'warning',
  UNCONNECTED_PERSON: 'warning',
};

/* Optional properties are omitted rather than set to undefined: `exactOptionalPropertyTypes` is
   on, and a key holding undefined is not the same as an absent key to either the compiler or a
   deep-equality assertion. */
function report(
  code: AuditCode,
  message: string,
  xref?: Xref,
  related?: readonly Xref[],
): AuditFinding {
  return {
    code,
    severity: SEVERITY[code],
    message,
    ...(xref === undefined ? {} : { xref }),
    ...(related === undefined ? {} : { related }),
  };
}

/** Identifiers issued more than once, across every kind of record. */
function duplicateXrefs(doc: GedcomDoc): readonly AuditFinding[] {
  const seen = new Set<Xref>();
  const duplicated = new Set<Xref>();
  const all = [
    ...doc.individuals.map((record) => record.xref),
    ...doc.families.map((record) => record.xref),
    ...(doc.otherRecords ?? []).map((record) => record.xref),
  ];
  for (const xref of all) {
    if (seen.has(xref)) duplicated.add(xref);
    seen.add(xref);
  }
  return [...duplicated].map((xref) =>
    report(
      'DUPLICATE_XREF',
      `Identifier ${xref} names more than one record. Identifiers are unique across the whole ` +
        `dataset, not within a record type.`,
      xref,
    ),
  );
}

/** Pointers repeated within one record's list of links. */
function duplicatesIn(pointers: readonly Pointer[]): readonly Pointer[] {
  const seen = new Set<Pointer>();
  const repeated = new Set<Pointer>();
  for (const pointer of pointers) {
    if (isVoid(pointer)) continue;
    if (seen.has(pointer)) repeated.add(pointer);
    seen.add(pointer);
  }
  return [...repeated];
}

/** What the families say, checked against the individuals they name. */
function auditFamilies(index: GedcomIndex): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const family of index.doc.families) {
    for (const pointer of membersOf(family)) {
      if (!index.individuals.has(pointer)) {
        findings.push(
          report(
            'DANGLING_POINTER',
            `Family ${family.xref} names person ${pointer}, which the document does not contain.`,
            family.xref,
            [pointer],
          ),
        );
      }
    }

    for (const repeated of duplicatesIn(family.children ?? [])) {
      findings.push(
        report(
          'DUPLICATE_LINK',
          `Family ${family.xref} lists ${repeated} as a child more than once.`,
          family.xref,
          [repeated],
        ),
      );
    }

    for (const partner of partnersOf(family)) {
      const individual = index.individuals.get(partner);
      if (individual === undefined) continue;
      const linksBack = (individual.familiesAsSpouse ?? []).some(
        (link) => link.xref === family.xref,
      );
      if (!linksBack) {
        findings.push(
          report(
            'ASYMMETRIC_LINK',
            `Family ${family.xref} names ${partner} as a partner, but ${partner} has no FAMS ` +
              `link back to it.`,
            family.xref,
            [partner],
          ),
        );
      }
    }

    for (const child of family.children ?? []) {
      const individual = index.individuals.get(child);
      if (individual === undefined) continue;
      const linksBack = (individual.familiesAsChild ?? []).some(
        (link) => link.xref === family.xref,
      );
      if (!linksBack) {
        findings.push(
          report(
            'ASYMMETRIC_LINK',
            `Family ${family.xref} lists ${child} as a child, but ${child} has no FAMC link ` +
              `back to it.`,
            family.xref,
            [child],
          ),
        );
      }
    }
  }
  return findings;
}

/** What the individuals say, checked against the families they name. */
function auditIndividuals(index: GedcomIndex): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const individual of index.doc.individuals) {
    const asChild = (individual.familiesAsChild ?? []).map((link) => link.xref);
    const asSpouse = (individual.familiesAsSpouse ?? []).map((link) => link.xref);

    for (const pointer of [...asChild, ...asSpouse]) {
      if (isVoid(pointer)) continue;
      if (!index.families.has(pointer)) {
        findings.push(
          report(
            'DANGLING_POINTER',
            `Person ${individual.xref} links to family ${pointer}, which the document does not ` +
              `contain.`,
            individual.xref,
            [pointer],
          ),
        );
      }
    }

    for (const repeated of duplicatesIn([...asChild, ...asSpouse])) {
      findings.push(
        report(
          'DUPLICATE_LINK',
          `Person ${individual.xref} links to family ${repeated} more than once.`,
          individual.xref,
          [repeated],
        ),
      );
    }

    for (const pointer of asChild) {
      const family = index.families.get(pointer);
      if (family === undefined) continue;
      if (!(family.children ?? []).includes(individual.xref)) {
        findings.push(
          report(
            'ASYMMETRIC_LINK',
            `Person ${individual.xref} links to family ${pointer} as a child, but ${pointer} has ` +
              `no CHIL pointer back.`,
            individual.xref,
            [pointer],
          ),
        );
      }
    }

    for (const pointer of asSpouse) {
      const family = index.families.get(pointer);
      if (family === undefined) continue;
      if (!partnersOf(family).includes(individual.xref)) {
        findings.push(
          report(
            'ASYMMETRIC_LINK',
            `Person ${individual.xref} links to family ${pointer} as a partner, but ${pointer} ` +
              `names neither HUSB nor WIFE pointing back.`,
            individual.xref,
            [pointer],
          ),
        );
      }
    }
  }
  return findings;
}

/**
 * Everyone who is their own ancestor.
 *
 * A depth-first walk up the parent edges, reporting the people found on a back edge. Only the
 * members of the cycle are reported: their descendants are not their own ancestors, and listing
 * them would bury the two or three records that actually need repair under everyone below them.
 */
function cyclicPeople(index: GedcomIndex): ReadonlySet<Xref> {
  const cyclic = new Set<Xref>();
  const finished = new Set<Xref>();
  const onStack = new Set<Xref>();

  for (const individual of index.doc.individuals) {
    if (finished.has(individual.xref)) continue;
    const stack: { node: Xref; parents: readonly Xref[]; next: number }[] = [
      { node: individual.xref, parents: parentsOf(index, individual.xref), next: 0 },
    ];
    onStack.add(individual.xref);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;

      if (frame.next >= frame.parents.length) {
        finished.add(frame.node);
        onStack.delete(frame.node);
        stack.pop();
        continue;
      }

      const parent = frame.parents[frame.next];
      frame.next += 1;
      if (parent === undefined) continue;

      if (onStack.has(parent)) {
        /* A back edge: every frame from the top of the stack down to `parent` is on the cycle. */
        for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
          const above = stack[depth];
          if (above === undefined) break;
          cyclic.add(above.node);
          if (above.node === parent) break;
        }
        continue;
      }
      if (finished.has(parent)) continue;

      stack.push({ node: parent, parents: parentsOf(index, parent), next: 0 });
      onStack.add(parent);
    }
  }
  return cyclic;
}

/** The two observations that are worth making and are not faults. */
function auditWarnings(index: GedcomIndex): readonly AuditFinding[] {
  const findings: AuditFinding[] = [];

  const connected = new Set<Xref>();
  for (const family of index.doc.families) {
    for (const member of membersOf(family)) connected.add(member);
  }

  for (const individual of index.doc.individuals) {
    const families = parentFamiliesOf(index, individual.xref);
    if (families.length > 1) {
      findings.push(
        report(
          'CHILD_OF_SEVERAL_FAMILIES',
          `Person ${individual.xref} is a child of ${families.length} families ` +
            `(${families.join(', ')}). That is legal -- a birth family and an adoptive one, for ` +
            `instance -- and worth confirming.`,
          individual.xref,
          families,
        ),
      );
    }
  }

  for (const individual of index.doc.individuals) {
    const links = [
      ...(individual.familiesAsChild ?? []),
      ...(individual.familiesAsSpouse ?? []),
    ].filter((link) => !isVoid(link.xref) && index.families.has(link.xref));
    if (!connected.has(individual.xref) && links.length === 0) {
      findings.push(
        report(
          'UNCONNECTED_PERSON',
          `Person ${individual.xref} belongs to no family. Not necessarily wrong -- a person is ` +
            `added before they are linked -- but a lone record is often a link that was lost.`,
          individual.xref,
        ),
      );
    }
  }

  return findings;
}

/**
 * Every structural problem in the document, in a stable order: identifiers, then what the
 * families claim, then what the individuals claim, then cycles, then the warnings.
 */
export function audit(doc: GedcomDoc): readonly AuditFinding[] {
  const index = indexDoc(doc);
  const cyclic = cyclicPeople(index);

  return [
    ...duplicateXrefs(doc),
    ...auditFamilies(index),
    ...auditIndividuals(index),
    ...index.doc.individuals
      .filter((individual) => cyclic.has(individual.xref))
      .map((individual) =>
        report(
          'DESCENT_CYCLE',
          `Person ${individual.xref} is their own ancestor. No tree can be drawn through that, ` +
            `so it is a fault in the links rather than an unusual family.`,
          individual.xref,
          [...ancestorsOf(index, individual.xref)].filter((ancestor) => cyclic.has(ancestor)),
        ),
      ),
    ...auditWarnings(index),
  ];
}

/** Just the findings that block: everything a correct export cannot be built on. */
export function auditErrors(findings: readonly AuditFinding[]): readonly AuditFinding[] {
  return findings.filter((finding) => finding.severity === 'error');
}

/** True where the document has no errors. Warnings are reported and do not block. */
export function isAuditClean(doc: GedcomDoc): boolean {
  return auditErrors(audit(doc)).length === 0;
}
