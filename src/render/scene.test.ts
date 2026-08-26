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

import {
  buildScene,
  displayCaption,
  displayMarks,
  displayName,
  displayXref,
  displayYears,
} from './scene.js';
import { ortho } from './ortho.js';
import { connectorSegments, type PathPoint } from '../layout/crossings.js';
import { GEOMETRY, computeLayout } from '../layout/layout.js';
import { measureText } from '../layout/text.js';
import type { Family, GedcomDoc, Individual, Xref } from '../model/types.js';
import { makeTranslate } from '../i18n/catalog.js';
import { EN } from '../i18n/keys.js';

/* These suites assert English prose. The catalog is asked for it explicitly rather than
   through a provider, so a change of default language never silently rewrites them. */
const say = makeTranslate('en', EN);

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
  buildScene(doc, computeLayout(doc, { collapsed }), say, collapsed);

describe('a box the size of its name', () => {
  const long = 'GivenLongish GivenSecond /SurnameLonger/';

  it('gives a long name a box wide enough to hold it', () => {
    const wide = tree(
      { '@I1@': { names: [{ value: long }] }, '@I2@': { names: [{ value: 'A /B/' }] } },
      { '@F1@': { spouses: ['@I1@', '@I2@'], children: [] } },
    );
    const [small, big] = [...scened(wide).persons].sort(
      (left, right) => left.width - right.width,
    );
    expect(big?.width).toBeGreaterThan(small?.width ?? 0);
    expect(measureText(big?.label ?? '', GEOMETRY.nameSize)).toBeLessThanOrEqual(
      (big?.width ?? 0) - 2 * GEOMETRY.nodePadX,
    );
  });

  it('draws a long name whole rather than cutting it', () => {
    // The complaint this answers: a surname cut in half reads as a wrong record, not as a narrow
    // box.
    const scene = scened(tree({ '@I1@': { names: [{ value: long }] } }, {}));
    expect(scene.persons[0]?.label).toBe('GivenLongish GivenSecond SurnameLonger');
  });

  it('cuts only a name past the widest box the chart will draw, and keeps it whole in `name`', () => {
    const absurd = `${'Wolfgang '.repeat(9)}/Fitzwilliam/`;
    const box = scened(tree({ '@I1@': { names: [{ value: absurd }] } }, {})).persons[0];
    expect(box?.width).toBe(GEOMETRY.nodeMaxW);
    expect(box?.label.endsWith('…')).toBe(true);
    expect(box?.name).toBe(absurd.replace('/', '').replace('/', ''));
  });
});

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

  it('draws an unnamed person under their identifier, without the delimiters', () => {
    // An empty box cannot be clicked with any confidence about what was clicked -- and the record
    // is called `I9`; the `@`s are syntax the parser needs and a reader does not.
    expect(displayName({ xref: '@I9@' })).toBe('I9');
  });

  it('shows an identifier as the record is named, not as the file delimits it', () => {
    expect(displayXref('@I9@')).toBe('I9');
    expect(displayXref('@F12@')).toBe('F12');
  });

  it('leaves an identifier that is not delimited alone rather than cutting into it', () => {
    // Nothing requires the delimiters to be there by the time this is called, and a blind strip
    // of the first and last character would eat a real one.
    expect(displayXref('I9')).toBe('I9');
  });

  it('takes the years from the parsed dates and daggers the span', () => {
    expect(
      displayYears({
        xref: '@I1@',
        events: [
          { tag: 'BIRT', date: { value: '1 JAN 1900', start: { year: 1900 } } },
          { tag: 'DEAT', date: { value: '1 JAN 1970', start: { year: 1970 } } },
        ],
      }),
    ).toBe('1900–1970 †');
  });

  it('marks a death as soon as a date is given, and not before', () => {
    // Entering a date of death is what makes the chart say the person died.
    const living = {
      xref: '@I1@',
      events: [{ tag: 'BIRT' as const, date: { value: '1900' } }],
    };
    expect(displayYears(living)).not.toContain('†');
    expect(
      displayYears({
        ...living,
        events: [...living.events, { tag: 'DEAT' as const, date: { value: '1970' } }],
      }),
    ).toContain('1970 †');
  });

  it('marks a death whose date this parser could not read, since a date was still given', () => {
    expect(
      displayYears({ xref: '@I1@', events: [{ tag: 'DEAT', date: { value: 'in the war' } }] }),
    ).toBe('–in the war †');
  });

  it('puts the sex sign in front and the dagger after, as one measured line', () => {
    expect(
      displayMarks({
        xref: '@I1@',
        sex: 'F',
        events: [{ tag: 'DEAT', date: { value: '1970', start: { year: 1970 } } }],
      }),
    ).toBe('♀ –1970 †');
  });

  it('gives each sex its own sign, and a record without one no sign at all', () => {
    // An absent SEX and an undetermined one are different claims; drawing them alike would be
    // inventing one of them.
    expect(displayMarks({ xref: '@I1@', sex: 'M' })).toBe('♂');
    expect(displayMarks({ xref: '@I1@', sex: 'F' })).toBe('♀');
    expect(displayMarks({ xref: '@I1@', sex: 'X' })).toBe('⚧');
    expect(displayMarks({ xref: '@I1@', sex: 'U' })).toBe('?');
    expect(displayMarks({ xref: '@I1@' })).toBe('');
  });

  it('speaks the same facts in words, because a glyph is read out as its typography', () => {
    // A screen reader says "female sign" and "dagger" for ♀ and †, which describes the drawing
    // rather than the person.
    expect(
      displayCaption(
        {
          xref: '@I1@',
          sex: 'F',
          names: [{ value: 'GivenA /SurnameB/' }],
          events: [
            { tag: 'BIRT', date: { value: '1900', start: { year: 1900 } } },
            { tag: 'DEAT', date: { value: '1970', start: { year: 1970 } } },
          ],
        },
        say,
      ),
    ).toBe('GivenA SurnameB, female, born 1900, died 1970');
    expect(displayCaption({ xref: '@I1@', names: [{ value: 'GivenA /SurnameB/' }] }, say)).toBe(
      'GivenA SurnameB',
    );
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

  it('routes exactly what the crossing metric measures', () => {
    // `layout/crossings.ts` restates this module's routing, because the layering rule forbids it
    // from importing this one. Two copies of a shape drift, and a metric measuring a shape the
    // renderer stopped drawing would report a tidy chart that nobody sees. So the copies are held
    // to each other here, where importing both is allowed.
    const doc = household;
    const scene = scened(doc);
    const points = new Map<string, PathPoint[]>();
    for (const run of connectorSegments(computeLayout(doc))) {
      const started = points.get(run.id);
      if (started === undefined) points.set(run.id, [run.from, run.to]);
      else started.push(run.to);
    }

    const drawn = new Map(
      scene.connectors.filter((line) => line.d !== '').map((line) => [line.id, line.d]),
    );
    expect([...points.keys()].sort()).toEqual([...drawn.keys()].sort());
    for (const [id, path] of points)
      expect({ [id]: ortho(path) }).toEqual({ [id]: drawn.get(id) });
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

  it('numbers the dot of a remarriage too, so a folded union still says which marriage it is', () => {
    const remarried = tree(
      { '@I1@': {}, '@I2@': {}, '@I3@': {}, '@I4@': {} },
      {
        '@F1@': { spouses: ['@I1@', '@I2@'], children: ['@I4@'] },
        '@F2@': { spouses: ['@I1@', '@I3@'], children: [] },
      },
    );
    const byId = new Map(scened(remarried).unions.map((union) => [union.id, union]));
    expect(byId.get('@F1@')?.ordinal).toBe(1);
    /* Childless, so the spot carries no ordinal and the descents carry none either -- the number
       has to come from the relations or the second marriage goes unmarked. */
    expect(byId.get('@F2@')?.ordinal).toBe(2);

    const shut = new Map(
      scened(remarried, new Set(['@F1@'])).unions.map((union) => [union.id, union]),
    );
    expect(shut.get('@F1@')?.ordinal).toBe(1);
  });

  it('keeps the number on its dot however many lanes the row opens', () => {
    /* The fault this answers: the mark was placed above the whole lane stack, to keep it off the
       sideways runs. Every extra marriage on a row opens another lane and drops the dots by one
       more lane's height, while the mark stayed put -- at four marriages it floated 48 units up,
       with three connectors between it and the dot it was naming. */
    const remarried = (times: number): GedcomDoc =>
      tree(
        Object.fromEntries([
          ['@I1@', {}],
          ...Array.from({ length: times }, (_, i) => [`@P${String(i + 1)}@`, {}] as const),
        ]),
        Object.fromEntries(
          Array.from({ length: times }, (_, i) => [
            `@F${String(i + 1)}@`,
            { spouses: ['@I1@', `@P${String(i + 1)}@`], children: [] },
          ]),
        ),
      );

    for (const times of [2, 3, 4, 5, 6]) {
      const scene = scened(remarried(times));
      expect(scene.unions).toHaveLength(times);
      for (const union of scene.unions) {
        expect(union.y - union.ordinalY).toBe(11);
      }
      // One height for every mark on the row, because every dot on a row shares one.
      expect(new Set(scene.unions.map((union) => union.ordinalY)).size).toBe(1);
    }
  });

  it('leaves a union unnumbered where neither partner married more than once', () => {
    expect(scened(household).unions.map((union) => union.ordinal)).toEqual([0]);
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
