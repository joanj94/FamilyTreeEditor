// @vitest-environment jsdom
/**
 * The chart as mounted.
 *
 * **What this can and cannot check.** jsdom has no layout and no real pointer capture, so the one
 * interaction fault the companion viewer was bitten by -- a capture set on `pointerdown` sending
 * every click to the stage -- cannot be reproduced here at all: dispatched events bypass the very
 * mechanism that breaks. That rule is therefore tested as arithmetic in `interaction.test.ts`,
 * where it is a decision about a number, and confirming it end to end needs a real browser. What
 * is asserted here is what jsdom can actually answer: that the scene mounts, that folding changes
 * what exists, and that the pin arithmetic is wired to the transform rather than merely present.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Chart } from './Chart.js';
import { computeLayout } from '../layout/layout.js';
import type { GedcomDoc } from '../model/types.js';

const doc: GedcomDoc = {
  header: { gedcomVersion: '7.0' },
  individuals: [
    {
      xref: '@I1@',
      sex: 'M',
      names: [{ value: 'GivenA /SurnameB/' }],
      familiesAsSpouse: [{ xref: '@F1@' }],
    },
    {
      xref: '@I2@',
      sex: 'F',
      names: [{ value: 'GivenC /SurnameD/' }],
      familiesAsSpouse: [{ xref: '@F1@' }],
    },
    {
      xref: '@I3@',
      names: [{ value: 'GivenE /SurnameB/' }],
      familiesAsChild: [{ xref: '@F1@' }],
    },
    {
      xref: '@I4@',
      names: [{ value: 'GivenF /SurnameB/' }],
      familiesAsChild: [{ xref: '@F1@' }],
    },
  ],
  families: [{ xref: '@F1@', husband: '@I1@', wife: '@I2@', children: ['@I3@', '@I4@'] }],
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function mount(element: Parameters<Root['render']>[0]): void {
  act(() => {
    root.render(element);
  });
}

function click(target: Element | null | undefined): void {
  act(() => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function press(target: Element | null | undefined, key: string): void {
  act(() => {
    target?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const boxes = () => [...container.querySelectorAll('.person')];
const fold = (family: string) =>
  container.querySelector<SVGGElement>(`.toggle[data-fam="${family}"]`);

/** The transform the component wrote onto the scene, read back as numbers. */
function viewport(): { scale: number; tx: number; ty: number } {
  const scene = container.querySelector('svg > g');
  const transform = scene?.getAttribute('transform') ?? '';
  const [tx, ty, scale] = [...transform.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) =>
    Number(match[0]),
  );
  return { tx: tx ?? 0, ty: ty ?? 0, scale: scale ?? 1 };
}

describe('mounting', () => {
  it('draws a box for each person and a dot for each union', () => {
    mount(<Chart doc={doc} />);
    expect(boxes()).toHaveLength(4);
    expect(container.querySelectorAll('.union-node')).toHaveLength(1);
  });

  it('numbers the generations down either side of the chart', () => {
    // Two rows here, each numbered twice -- once at each end, because the chart pans and a reader
    // who has travelled to the right of a wide family should not have to travel back to find out
    // which generation they are looking at.
    mount(<Chart doc={doc} />);
    const marks = [...container.querySelectorAll('.generation')];
    expect(marks.map((node) => node.textContent)).toEqual(['1', '1', '2', '2']);
    // Said once, not twice: the copy on the right is the same fact, and a screen reader repeating
    // "Generation 2" every row is noise.
    expect(marks.filter((node) => node.getAttribute('aria-label') !== null)).toHaveLength(2);
    expect(marks[0]?.getAttribute('aria-label')).toBe('Generation 1');
  });

  it('writes the names into the boxes, with the full name kept in a title', () => {
    mount(<Chart doc={doc} />);
    const names = [...container.querySelectorAll('.person .name')].map(
      (node) => node.textContent,
    );
    expect(names).toContain('GivenA SurnameB');
    expect(container.querySelector('.person > title')?.textContent).toBe('GivenA SurnameB');
  });

  it('draws a long name whole, in a box that grew to hold it', () => {
    // The complaint: a box of one fixed width cut the long names off, and half a surname on a
    // genealogy chart is read as a wrong record rather than as a narrow box.
    const long = 'GivenLongish GivenSecond SurnameLonger';
    mount(
      <Chart
        doc={{
          ...doc,
          individuals: doc.individuals.map((individual) =>
            individual.xref === '@I1@'
              ? {
                  ...individual,
                  names: [{ value: 'GivenLongish GivenSecond /SurnameLonger/' }],
                }
              : individual,
          ),
        }}
      />,
    );
    const names = [...container.querySelectorAll('.person .name')].map(
      (node) => node.textContent,
    );
    expect(names).toContain(long);

    const drawn = [...container.querySelectorAll('.person')].find(
      (node) => node.querySelector('.name')?.textContent === long,
    );
    const others = [...container.querySelectorAll('.person .box')]
      .map((node) => Number(node.getAttribute('width')))
      .filter((width) => width !== Number(drawn?.querySelector('.box')?.getAttribute('width')));
    expect(Number(drawn?.querySelector('.box')?.getAttribute('width'))).toBeGreaterThan(
      Math.max(...others),
    );
  });

  it('draws no path containing NaN', () => {
    // SVG drops such a path silently, so the failure is a missing connector rather than an error.
    mount(<Chart doc={doc} />);
    for (const path of container.querySelectorAll('path')) {
      expect(path.getAttribute('d') ?? '').not.toContain('NaN');
    }
  });

  it('opens at the scale the chart is meant to be read at', () => {
    mount(<Chart doc={doc} />);
    expect(viewport().scale).toBeCloseTo(0.75, 6);
  });

  it('describes itself for a reader who cannot see it', () => {
    mount(<Chart doc={doc} />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Family tree: 4 people',
    );
  });
});

describe('the marks a box carries', () => {
  it('draws the sex as a sign, so a box says it at a glance', () => {
    mount(<Chart doc={doc} />);
    const marks = [...container.querySelectorAll('.person .marks')].map(
      (node) => node.textContent,
    );
    expect(marks).toContain('♂');
    expect(marks).toContain('♀');
  });

  it('daggers a death after the years as soon as the record carries a date for it', () => {
    // The complaint this answers: a year alone says when something happened, not what.
    const dead = {
      ...doc,
      individuals: doc.individuals.map((individual) =>
        individual.xref === '@I1@'
          ? {
              ...individual,
              events: [
                { tag: 'BIRT' as const, date: { value: '1900', start: { year: 1900 } } },
                { tag: 'DEAT' as const, date: { value: '1970', start: { year: 1970 } } },
              ],
            }
          : individual,
      ),
    };
    mount(<Chart doc={dead} />);
    const marks = [...container.querySelectorAll('.person .marks')].map(
      (node) => node.textContent,
    );
    expect(marks).toContain('♂ 1900–1970 †');
    expect(marks.filter((mark) => mark?.includes('†'))).toHaveLength(1);
  });

  it('speaks the marks as words, since a screen reader reads a glyph as its typography', () => {
    mount(<Chart doc={doc} />);
    const spoken = boxes().map((box) => box.getAttribute('aria-label'));
    expect(spoken).toContain('GivenA SurnameB, male');
    /* Not the glyphs: "female sign" and "dagger" describe the drawing, not the person. */
    for (const label of spoken) expect(label).not.toContain('♀');
  });
});

describe('the marks a union carries', () => {
  /** The same household, with the partnership dated and ended. */
  const ended: GedcomDoc = {
    ...doc,
    families: doc.families.map((family) => ({
      ...family,
      events: [
        { tag: 'MARR' as const, date: { value: '1902', start: { year: 1902 } } },
        { tag: 'DIV' as const, date: { value: '1930', start: { year: 1930 } } },
      ],
    })),
  };

  it('draws the marriage and the divorce as signs, so a dot says them at a glance', () => {
    mount(<Chart doc={ended} />);
    expect(container.querySelector('.union-marks')?.textContent).toBe('= 1902 ≠ 1930');
  });

  it('says nothing at a dot whose union records neither', () => {
    mount(<Chart doc={doc} />);
    expect(container.querySelectorAll('.union-marks')).toHaveLength(0);
  });

  it('sets them off the dot, where neither the number, the run nor the fold is', () => {
    mount(<Chart doc={ended} />);
    const dot = container.querySelector('.union');
    const marks = container.querySelector('.union-marks');
    // Right of the fold's box, and below the baseline the sideways spouse run passes along.
    expect(Number(marks?.getAttribute('x'))).toBeGreaterThan(
      Number(dot?.getAttribute('cx')) + 8,
    );
    expect(Number(marks?.getAttribute('y'))).toBeGreaterThan(Number(dot?.getAttribute('cy')));
  });

  it('speaks them as words, since a screen reader reads a glyph as its typography', () => {
    mount(<Chart doc={ended} />);
    const spoken = container.querySelector('.union-node')?.getAttribute('aria-label');
    expect(spoken).toBe('Union F1, married 1902, divorced 1930');
    expect(spoken).not.toContain('≠');
  });
});

describe('which marriage a union is', () => {
  /** One person, married twice: the second union has no children of its own. */
  const remarried: GedcomDoc = {
    header: { gedcomVersion: '7.0' },
    individuals: [
      {
        xref: '@I1@',
        names: [{ value: 'GivenA /SurnameB/' }],
        familiesAsSpouse: [{ xref: '@F1@' }, { xref: '@F2@' }],
      },
      { xref: '@I2@', names: [{ value: 'A /B/' }], familiesAsSpouse: [{ xref: '@F1@' }] },
      { xref: '@I3@', names: [{ value: 'C /D/' }], familiesAsSpouse: [{ xref: '@F2@' }] },
      { xref: '@I4@', names: [{ value: 'E /B/' }], familiesAsChild: [{ xref: '@F1@' }] },
    ],
    families: [
      { xref: '@F1@', husband: '@I1@', wife: '@I2@', children: ['@I4@'] },
      { xref: '@F2@', husband: '@I1@', wife: '@I3@' },
    ],
  };

  it('writes the number at the dot as well as beside the descent', () => {
    mount(<Chart doc={remarried} />);
    const atDots = [...container.querySelectorAll('.union-ordinal')].map(
      (node) => node.textContent,
    );
    // The childless second marriage has no descent to carry its number, so the dot is the only
    // place it can be said.
    expect(atDots.sort()).toEqual(['(1)', '(2)']);
  });

  it('stands the number over its own dot, so it names something', () => {
    // Set off to one side it floated diagonally away from the union and read as a mark on
    // nothing. The drop from the run is what leads the eye from the number down to the dot.
    mount(<Chart doc={remarried} />);
    const dots = [...container.querySelectorAll('.union')].map((node) =>
      Number(node.getAttribute('cx')),
    );
    const marks = [...container.querySelectorAll('.union-ordinal')].map((node) =>
      Number(node.getAttribute('x')),
    );
    expect(marks).toHaveLength(2);
    expect([...marks].sort((a, b) => a - b)).toEqual([...dots].sort((a, b) => a - b));
  });

  it('says nothing where neither partner married more than once', () => {
    mount(<Chart doc={doc} />);
    expect(container.querySelectorAll('.union-ordinal')).toHaveLength(0);
  });

  it('names an identifier the way the record is named, without the file delimiters', () => {
    mount(<Chart doc={doc} />);
    expect(container.querySelector('.union-node')?.getAttribute('aria-label')).toBe('Union F1');
    expect(fold('@F1@')?.getAttribute('aria-label')).toBe('Collapse the branch below F1');
  });
});

describe('folding', () => {
  it('hides the branch and puts it back', () => {
    mount(<Chart doc={doc} />);
    expect(fold('@F1@')).not.toBeNull();

    click(fold('@F1@'));
    expect(boxes()).toHaveLength(2);

    click(fold('@F1@'));
    expect(boxes()).toHaveLength(4);
  });

  it('says how many people a shut fold is hiding', () => {
    mount(<Chart doc={doc} />);
    click(fold('@F1@'));
    expect(container.querySelector('.toggle .hiding')?.textContent).toBe('+2');
  });

  it('leaves the folded union on the pixel it was already on', () => {
    // Folding re-packs the whole tree. Without the pin the chart leaps and the reader loses the
    // place they folded in order to look at.
    mount(<Chart doc={doc} />);
    const before = viewport();
    const wasAt = computeLayout(doc).unions.get('@F1@');
    const onScreen = {
      sx: (wasAt?.x ?? 0) * before.scale + before.tx,
      sy: (wasAt?.y ?? 0) * before.scale + before.ty,
    };

    click(fold('@F1@'));

    const after = viewport();
    const nowAt = computeLayout(doc, { collapsed: new Set(['@F1@']) }).unions.get('@F1@');
    expect((nowAt?.x ?? 0) * after.scale + after.tx).toBeCloseTo(onScreen.sx, 6);
    expect((nowAt?.y ?? 0) * after.scale + after.ty).toBeCloseTo(onScreen.sy, 6);
  });
});

describe('choosing', () => {
  it('raises the person that was clicked, and selects nothing itself', () => {
    // The chart draws; what a selection means belongs to the editor.
    const chose = vi.fn();
    mount(<Chart doc={doc} onSelectPerson={chose} />);
    click(boxes()[0]);
    expect(chose).toHaveBeenCalledWith('@I1@');
  });

  it('raises the union that was clicked', () => {
    const chose = vi.fn();
    mount(<Chart doc={doc} onSelectUnion={chose} />);
    click(container.querySelector('.union-node'));
    expect(chose).toHaveBeenCalledWith('@F1@');
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Reaching the chart without a mouse.
 *
 * The record panel opens only from a node, so a chart that cannot be focused or activated by
 * keyboard makes the whole editor mouse-only -- every person unreadable and unreachable, which is
 * the application's entire purpose. That was true until these tests existed, which is the point
 * of writing them at the level of "can somebody actually get there" rather than testing the
 * attributes in isolation.
 * ------------------------------------------------------------------------------------------- */
describe('reaching the chart without a mouse', () => {
  it('exposes the scene rather than hiding it behind an image role', () => {
    // `role="img"` tells assistive technology the element has no interior worth visiting.
    mount(<Chart doc={doc} />);
    const stage = container.querySelector('svg');
    expect(stage?.getAttribute('role')).toBe('group');
    expect(stage?.getAttribute('aria-label')).toContain('4 people');
  });

  it('puts every person in the tab order, named', () => {
    mount(<Chart doc={doc} />);
    for (const box of boxes()) {
      expect(box.getAttribute('tabindex')).toBe('0');
      expect(box.getAttribute('role')).toBe('button');
      expect(box.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('selects a person with Enter and with Space', () => {
    for (const key of ['Enter', ' ']) {
      const chose = vi.fn();
      mount(<Chart doc={doc} onSelectPerson={chose} />);
      press(boxes()[0], key);
      expect(chose).toHaveBeenCalledWith('@I1@');
    }
  });

  it('ignores keys that are not an activation', () => {
    const chose = vi.fn();
    mount(<Chart doc={doc} onSelectPerson={chose} />);
    press(boxes()[0], 'a');
    press(boxes()[0], 'Tab');
    expect(chose).not.toHaveBeenCalled();
  });

  it('selects a union with the keyboard too', () => {
    const chose = vi.fn();
    mount(<Chart doc={doc} onSelectUnion={chose} />);
    press(container.querySelector('.union-node'), 'Enter');
    expect(chose).toHaveBeenCalledWith('@F1@');
  });

  it('folds a branch from the keyboard, and says whether it is open', () => {
    mount(<Chart doc={doc} />);
    const toggle = fold('@F1@');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(toggle?.getAttribute('aria-label')).toContain('Collapse');

    press(toggle, 'Enter');
    expect(fold('@F1@')?.getAttribute('aria-expanded')).toBe('false');
    expect(fold('@F1@')?.getAttribute('aria-label')).toContain('Expand');
  });
});
