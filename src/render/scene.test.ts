/**
 * What the chart decides to draw, before anything draws it.
 *
 * The scene is pure, so the drawing decisions can be asserted without a DOM: which connectors
 * exist, what a box says, what a fold is hiding. What is left for the component is turning this
 * into elements.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { buildScene, displayName, displayYears } from './scene.js';
import { computeLayout } from '../layout/layout.js';
import type { Family, GedcomDoc, Individual, Xref } from '../model/types.js';

interface Union {
  readonly spouses: readonly Xref[];
  readonly children: readonly Xref[];
}

function tree(
  people: Record<Xref, Partial<Individual>>,
  families: Record<Xref, Union>,
): GedcomDoc {
  const entries = Object.entries(families);
  const individuals = Object.entries(people).map<Individual>(([xref, fields]) => {
    const asChild = entries
      .filter(([, union]) => union.children.includes(xref))
      .map(([family]) => ({ xref: family }));
    const asSpouse = entries
      .filter(([, union]) => union.spouses.includes(xref))
      .map(([family]) => ({ xref: family }));
    return {
      ...fields,
      xref,
      ...(asChild.length > 0 ? { familiesAsChild: asChild } : {}),
      ...(asSpouse.length > 0 ? { familiesAsSpouse: asSpouse } : {}),
    };
  });
  const familyRecords = entries.map<Family>(([xref, union]) => {
    const [husband, wife] = union.spouses;
    return {
      xref,
      ...(husband === undefined ? {} : { husband }),
      ...(wife === undefined ? {} : { wife }),
      ...(union.children.length > 0 ? { children: union.children } : {}),
    };
  });
  return { header: { gedcomVersion: '7.0' }, individuals, families: familyRecords };
}

const household = tree(
  {
    '@I1@': { sex: 'M', names: [{ value: 'GivenA /SurnameB/' }] },
    '@I2@': { sex: 'F', names: [{ value: 'GivenC /SurnameD/' }] },
    '@I3@': { names: [{ value: 'GivenE /SurnameB/' }] },
    '@I4@': { names: [{ value: 'GivenF /SurnameB/' }] },
  },
  {
    '@F1@': { spouses: ['@I1@', '@I2@'], children: ['@I3@', '@I4@'] },
  },
);

const scened = (doc: GedcomDoc, collapsed = new Set<Xref>()) =>
  buildScene(doc, computeLayout(doc, { collapsed }), collapsed);

describe('what a box says', () => {
  it('draws the name the file wrote, without the surname delimiters', () => {
    // The payload is authoritative -- the pieces beside it are this tool's reading of it -- so the
    // payload is what a reader sees.
    expect(displayName({ xref: '@I1@', names: [{ value: 'GivenA /SurnameB/' }] })).toBe(
      'GivenA SurnameB',
    );
  });

  it('falls back to the name pieces where there is no payload', () => {
    expect(
      displayName({ xref: '@I1@', names: [{ given: ['GivenA'], surname: ['SurnameB'] }] }),
    ).toBe('GivenA SurnameB');
  });

  it('draws an unnamed person under their identifier rather than as an empty box', () => {
    // An empty box cannot be clicked with any confidence about what was clicked.
    expect(displayName({ xref: '@I9@' })).toBe('@I9@');
  });

  it('takes the years from the parsed dates', () => {
    expect(
      displayYears({
        xref: '@I1@',
        events: [
          { tag: 'BIRT', date: { value: '1 JAN 1900', start: { year: 1900 } } },
          { tag: 'DEAT', date: { value: '1 JAN 1970', start: { year: 1970 } } },
        ],
      }),
    ).toBe('1900–1970');
  });

  it('shows an unparsed date as written rather than showing nothing', () => {
    expect(
      displayYears({
        xref: '@I1@',
        events: [{ tag: 'BIRT', date: { value: 'about harvest' } }],
      }),
    ).toBe('about harvest–');
  });

  it('says nothing where the record gives no dates', () => {
    expect(displayYears({ xref: '@I1@' })).toBe('');
  });
});

describe('the scene', () => {
  it('draws a box for everyone placed and a dot for every union', () => {
    const scene = scened(household);
    expect(scene.persons.map((person) => person.id).sort()).toEqual([
      '@I1@',
      '@I2@',
      '@I3@',
      '@I4@',
    ]);
    expect(scene.unions.map((union) => union.id)).toEqual(['@F1@']);
  });

  it('runs one connector from each spouse to the dot, and one to each child', () => {
    const scene = scened(household);
    expect(scene.connectors.filter((line) => line.kind === 'spouse')).toHaveLength(2);
    // The stem plus one path per child, which overdraw along the bar to make it.
    expect(scene.connectors.filter((line) => line.kind === 'descent')).toHaveLength(3);
  });

  it('puts no NaN in any path it produces', () => {
    // SVG discards a path containing NaN silently, so the connector goes missing rather than
    // going wrong. Asserted over a whole scene, not only over the builder.
    for (const line of scened(household).connectors) expect(line.d).not.toContain('NaN');
  });

  it('marks a foldable union as foldable and a childless one as not', () => {
    const doc = tree(
      { '@I1@': {}, '@I2@': {}, '@I3@': {}, '@I4@': {} },
      {
        '@F1@': { spouses: ['@I1@', '@I2@'], children: ['@I3@'] },
        '@F2@': { spouses: ['@I3@', '@I4@'], children: [] },
      },
    );
    const byId = new Map(scened(doc).unions.map((union) => [union.id, union]));
    expect(byId.get('@F1@')?.foldable).toBe(true);
    expect(byId.get('@F2@')?.foldable).toBe(false);
  });

  it('numbers the descent of a remarriage and leaves a single union unmarked', () => {
    const remarried = tree(
      { '@I1@': {}, '@I2@': {}, '@I3@': {}, '@I4@': {}, '@I5@': {} },
      {
        '@F1@': { spouses: ['@I1@', '@I2@'], children: ['@I4@'] },
        '@F2@': { spouses: ['@I1@', '@I3@'], children: ['@I5@'] },
      },
    );
    expect(
      scened(remarried)
        .ordinals.map((mark) => mark.text)
        .sort(),
    ).toEqual(['(1)', '(2)']);
    expect(scened(household).ordinals).toEqual([]);
  });
});

describe('folding', () => {
  it('takes the hidden people out of the scene and closes the tree up', () => {
    const shut = scened(household, new Set(['@F1@']));
    expect(shut.persons.map((person) => person.id).sort()).toEqual(['@I1@', '@I2@']);
    expect(shut.connectors.filter((line) => line.kind === 'descent')).toEqual([]);
  });

  it('keeps the dot, so the union is still there to be reopened', () => {
    const shut = scened(household, new Set(['@F1@']));
    expect(shut.unions.map((union) => union.id)).toEqual(['@F1@']);
    expect(shut.unions[0]?.collapsed).toBe(true);
  });

  it('says how many people it is hiding, so the fold says what it costs', () => {
    expect(scened(household, new Set(['@F1@'])).unions[0]?.hiding).toBe(2);
    expect(scened(household).unions[0]?.hiding).toBe(0);
  });

  it('counts a hidden branch all the way down, not just the children', () => {
    const threeDeep = tree(
      { '@I1@': {}, '@I2@': {}, '@I3@': {}, '@I4@': {}, '@I5@': {} },
      {
        '@F1@': { spouses: ['@I1@', '@I2@'], children: ['@I3@'] },
        '@F2@': { spouses: ['@I3@', '@I4@'], children: ['@I5@'] },
      },
    );
    const shut = scened(threeDeep, new Set(['@F1@']));
    expect(shut.unions.find((union) => union.id === '@F1@')?.hiding).toBe(3);
  });
});

describe('the bounds', () => {
  it('cover every box drawn', () => {
    const scene = scened(household);
    const right = Math.max(...scene.persons.map((person) => person.x + person.width));
    expect(scene.bounds.minX + scene.bounds.width).toBeGreaterThanOrEqual(right);
  });

  it('are empty for an empty document', () => {
    const empty: GedcomDoc = {
      header: { gedcomVersion: '7.0' },
      individuals: [],
      families: [],
    };
    expect(scened(empty).bounds).toEqual({ minX: 0, minY: 0, width: 0, height: 0 });
  });
});
