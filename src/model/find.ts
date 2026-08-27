/**
 * Finding a person by name.
 *
 * A chart of four hundred people is not a thing anybody scrolls through looking for a great-aunt.
 * The box is how you get to her, so what matters here is that it forgives what a person actually
 * types.
 *
 * **Accents are folded away.** This editor is used in Catalan and Spanish, where a great many
 * surnames carry one -- Fàbregas, Muñoz, Peñíscola -- and a keyboard layout that makes them
 * awkward is exactly the keyboard the search is typed on. `NFD` splits a letter from its mark and
 * the marks are dropped, so `fabregas` finds `Fàbregas` and `Fàbregas` still finds it too. The
 * record is untouched: this is a reading of the name, like everything in `labels.ts`.
 *
 * **Every word must match, in any order and anywhere in the name.** `puig joan` finds
 * `Joan Miquel Puig i Serra`, which is what somebody who half-remembers a name will type. The
 * alternative -- matching the query as one string -- fails on the middle name they have forgotten,
 * which is the case the box exists for.
 *
 * **The identifier is searchable too.** A genealogist chasing `I417` through an audit report
 * should be able to paste it in rather than translate it back into a name first.
 *
 * Pure and free of the UI, like everything in `model/`: it returns matches, not markup.
 */
import { displayName, displayXref, displayYears } from './labels.js';
import type { GedcomDoc, Xref } from './types.js';

/** One person the query found. */
export interface Match {
  readonly xref: Xref;
  readonly name: string;
  /**
   * The years, for telling namesakes apart.
   *
   * Two people called Joan Puig in one file is the ordinary case, not the exotic one, and a list
   * of identical rows is a list that cannot be chosen from. Empty where the record gives neither
   * a birth nor a death.
   */
  readonly years: string;
}

/** How many are offered at once. Past this the list stops being scannable and wants a better query. */
export const FOUND_AT_MOST = 8;

/**
 * A name as the search compares it: lower case, and stripped of its diacritics.
 *
 * Exported because the component highlights nothing but the tests do compare against it, and
 * because the folding is the interesting decision in this file rather than an implementation
 * detail of one function.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * How well a name answers the query, lower being better.
 *
 * Three bands rather than a similarity measure, because the ordering a person expects from a
 * search box is coarse: the name that starts with what I typed, then the name with a *word*
 * starting with it, then everything else that merely contains it. Within a band the file's own
 * order is kept, which is stable and is the order every other list in this editor uses.
 */
function rank(haystack: string, first: string): number {
  if (haystack.startsWith(first)) return 0;
  /* A space rather than a regular expression word boundary. The query is whatever somebody typed
     into a box, so a pattern built from it would have to be escaped first -- and a search that
     can be broken by typing a bracket into it is a search with a bug waiting in it. The words of
     a name are separated by spaces; that is the whole of what this needs to know. */
  return haystack.includes(` ${first}`) ? 1 : 2;
}

/**
 * Everyone whose name answers the query, best first.
 *
 * An empty query finds nobody rather than everybody: a list of the whole file dropped under the
 * box the moment it is focused is noise, and the chart is already showing them.
 */
export function findByName(
  doc: GedcomDoc,
  query: string,
  limit: number = FOUND_AT_MOST,
): readonly Match[] {
  const terms = fold(query)
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) return [];
  const first = terms[0] ?? '';

  const found: { readonly match: Match; readonly rank: number; readonly at: number }[] = [];
  doc.individuals.forEach((individual, at) => {
    const name = displayName(individual);
    /* The identifier goes in the same haystack rather than being matched separately: one pass,
       and a query mixing the two -- `puig I417` -- still works. */
    const haystack = `${fold(name)} ${fold(displayXref(individual.xref))}`;
    if (!terms.every((term) => haystack.includes(term))) return;
    found.push({
      match: { xref: individual.xref, name, years: displayYears(individual) },
      rank: rank(haystack, first),
      at,
    });
  });

  return found
    .sort((one, other) => one.rank - other.rank || one.at - other.at)
    .slice(0, limit)
    .map((held) => held.match);
}
