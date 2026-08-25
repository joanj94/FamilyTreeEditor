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

  it('writes the names into the boxes, with the full name kept in a title', () => {
    mount(<Chart doc={doc} />);
    const names = [...container.querySelectorAll('.person .name')].map(
      (node) => node.textContent,
    );
    expect(names).toContain('GivenA SurnameB');
    expect(container.querySelector('.person > title')?.textContent).toBe('GivenA SurnameB');
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
