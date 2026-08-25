/**
 * The document, read as the bipartite graph the layout works from.
 *
 * A family tree is not a graph of people joined to people. It is people joined to *families*, and
 * every relationship is read through one: spouses and children go outward from a family, and the
 * parent family and the families a person married into come back the other way. The layout is
 * built on that shape throughout, which is what lets a union be a thing that can be drawn -- a dot
 * with a position -- rather than an edge between two boxes.
 *
 * This mirrors `index_view` in the companion pipeline. It reads from `GedcomDoc` directly rather
 * than from that project's flat node/edge view, so the only thing carried across is the shape.
 *
 * Pointers that name no record are dropped here rather than guarded against at every use. A
 * document that has been through `audit()` has none; one that has just been imported may, and the
 * drawing has to come up anyway.
 */
import { isVoid, partnersOf } from '../model/graph.js';
import type { GedcomDoc, Xref } from '../model/types.js';

/** The lookups the layout actually needs, all of them in document order. */
export interface Relations {
  readonly persons: readonly Xref[];
  readonly families: readonly Xref[];
  /** Family to its partners, in the standard's `HUSB`, `WIFE` order. */
  readonly spouses: ReadonlyMap<Xref, readonly Xref[]>;
  /** Family to its children, in the order the record lists them. */
  readonly children: ReadonlyMap<Xref, readonly Xref[]>;
  /** Person to the families they are a partner in. Their remarriage order. */
  readonly familiesOf: ReadonlyMap<Xref, readonly Xref[]>;
  /** Person to the one family their descent is drawn from. */
  readonly parentFamily: ReadonlyMap<Xref, Xref>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/**
 * Read a document into those lookups.
 *
 * **A person is drawn hanging from one family.** GEDCOM allows several -- a birth family and an
 * adoptive one are both true, and `audit()` says so rather than complaining -- but a tree has one
 * line of descent per box or it is not a tree. The person's own first `FAMC` link decides, since
 * that is the side of the pair the record itself orders; a family that lists a child who never
 * links back is the fallback, so a half-recorded link still draws.
 */
export function readRelations(doc: GedcomDoc): Relations {
  const persons = doc.individuals.map((individual) => individual.xref);
  const families = doc.families.map((family) => family.xref);
  const knownPerson = new Set(persons);
  const knownFamily = new Set(families);

  const spouses = new Map<Xref, readonly Xref[]>();
  const children = new Map<Xref, readonly Xref[]>();
  const familiesOf = new Map<Xref, Xref[]>();
  const parentFamily = new Map<Xref, Xref>();

  for (const family of doc.families) {
    const partners = partnersOf(family).filter((xref) => knownPerson.has(xref));
    spouses.set(family.xref, partners);
    children.set(
      family.xref,
      (family.children ?? []).filter(
        (child, at, all) => knownPerson.has(child) && all.indexOf(child) === at,
      ),
    );
    /* Taken from the family side so that `spouses` and `familiesOf` cannot disagree: two lookups
       over the same relationship that answer differently is a fault no test would name. */
    for (const partner of partners) push(familiesOf, partner, family.xref);
  }

  for (const individual of doc.individuals) {
    const claimed = (individual.familiesAsChild ?? [])
      .map((link) => link.xref)
      .find((xref) => !isVoid(xref) && knownFamily.has(xref));
    if (claimed !== undefined) parentFamily.set(individual.xref, claimed);
  }
  for (const family of doc.families) {
    for (const child of children.get(family.xref) ?? []) {
      if (!parentFamily.has(child)) parentFamily.set(child, family.xref);
    }
  }

  return { persons, families, spouses, children, familiesOf, parentFamily };
}

/** The partners of a family, or an empty list where it has none. */
export function spousesOf(relations: Relations, family: Xref): readonly Xref[] {
  return relations.spouses.get(family) ?? [];
}

/** The children of a family, or an empty list where it has none. */
export function childrenOf(relations: Relations, family: Xref): readonly Xref[] {
  return relations.children.get(family) ?? [];
}

/** The families a person is a partner in, in the order they married. */
export function unionsOf(relations: Relations, person: Xref): readonly Xref[] {
  return relations.familiesOf.get(person) ?? [];
}
