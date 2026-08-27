// @vitest-environment jsdom
/**
 * The print chooser as mounted.
 *
 * The arithmetic is `render/paper.test.ts` and the printout is `render/print.test.ts`. What is
 * left for here is the part that is a decision about the reader rather than about paper: that the
 * suggestion is what the panel opens on, that it keeps following the chart until the reader
 * overrides it and stops the moment they do, and that what a plan costs is on screen before
 * anything is printed.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Print } from './Print.js';
import { PRINTOUT_CLASS } from '../render/print.js';
import type { Bounds } from '../render/scene.js';

let container: HTMLDivElement;
let root: Root;
let printing: ReturnType<typeof vi.fn>;

/** A chart in the document for the chooser to find, since it prints what is on screen. */
function stage(): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'chart-stage');
  const scene = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('class', 'name');
  text.textContent = 'GivenA SurnameB';
  scene.append(text);
  svg.append(scene);
  document.body.append(svg);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  printing = vi.fn();
  Object.defineProperty(window, 'print', {
    value: printing,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  document.body.innerHTML = '';
  for (const node of document.head.querySelectorAll('style[data-print]')) node.remove();
});

const chart = (width: number, height: number): Bounds => ({
  minX: 0,
  minY: 0,
  width,
  height,
});

function mount(bounds: Bounds | null): void {
  act(() => {
    root.render(<Print bounds={bounds} />);
  });
}

const button = (): HTMLButtonElement | null => container.querySelector('.print-open');
const panel = (): HTMLElement | null => container.querySelector('.print-options');
const summary = (): string => container.querySelector('.print-summary')?.textContent ?? '';
const select = (index: number): HTMLSelectElement | undefined =>
  [...container.querySelectorAll('select')][index];

function press(node: Element | null | undefined): void {
  act(() => {
    node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Pick a value in the nth chooser, the way a reader does: set it, then let React hear about it. */
function choose(index: number, value: string): void {
  act(() => {
    const node = select(index);
    if (node === undefined) return;
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('the button', () => {
  it('is there whether or not there is anything to print', () => {
    mount(null);
    expect(button()).not.toBeNull();
  });

  it('refuses to open on a chart with nothing drawn on it', () => {
    mount(chart(0, 0));
    expect(button()?.disabled).toBe(true);
    press(button());
    expect(panel()).toBeNull();
  });

  it('opens the chooser, and closes it again', () => {
    mount(chart(1200, 600));
    press(button());
    expect(panel()).not.toBeNull();
    expect(button()?.getAttribute('aria-expanded')).toBe('true');
    press(button());
    expect(panel()).toBeNull();
  });
});

describe('the suggestion', () => {
  it('is what the panel opens on, and is named as a suggestion in the list', () => {
    mount(chart(1200, 600));
    press(button());
    const paper = select(0);
    const marked = [...(paper?.options ?? [])].filter((option) =>
      option.textContent?.includes('suggested'),
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.value).toBe(paper?.value);
  });

  it('follows the chart while the reader has not overridden it', () => {
    /* Folding a branch away really does make the chart smaller, and a chooser still offering the
       paper the unfolded chart needed would be wrong -- silently, and only once printed. */
    mount(chart(20000, 6000));
    press(button());
    const big = select(0)?.value;
    mount(chart(900, 500));
    const small = select(0)?.value;
    expect(big).not.toBe(small);
  });

  it('stops following it the moment the reader chooses for themselves', () => {
    mount(chart(20000, 6000));
    press(button());
    choose(0, 'A4');
    expect(select(0)?.value).toBe('A4');
    mount(chart(900, 500));
    expect(select(0)?.value).toBe('A4');
  });

  it('sends a chart too big for any sheet to a roll', () => {
    mount(chart(200000, 9000));
    press(button());
    // The roll is chosen, so the orientation question -- which a roll cannot answer -- is gone.
    expect(container.querySelectorAll('select')).toHaveLength(2);
    expect(summary()).toContain('roll');
  });
});

describe('what a plan costs, before it is printed', () => {
  it('says the paper, the sheets, the finished size and how big a name comes out', () => {
    mount(chart(1200, 600));
    press(button());
    choose(0, 'A3');
    expect(summary()).toContain('A3');
    expect(summary()).toContain('mm');
    expect(summary()).toContain('sheet');
    expect(summary()).toMatch(/names [\d.]+ mm tall/);
  });

  it('warns where the names would print too small to read', () => {
    mount(chart(60000, 4000));
    press(button());
    choose(0, 'A4');
    choose(1, 'sheet');
    expect(container.querySelector('.print-warn')?.textContent).toContain('not be readable');
  });

  it('counts the sheets a tiled chart takes, and says they overlap', () => {
    mount(chart(4000, 1500));
    press(button());
    choose(0, 'A4');
    choose(1, 'tiles');
    expect(summary()).toMatch(/\d+ sheets/);
    expect(summary()).toContain('across');
    expect(container.querySelector('.print-note')?.textContent).toContain('overlapping');
  });

  it('explains what a roll is, since it is not what a home printer does', () => {
    mount(chart(4000, 1500));
    press(button());
    choose(1, 'roll');
    expect(container.querySelector('.print-note')?.textContent).toContain('Save as PDF');
  });
});

describe('printing', () => {
  it('prints the chart on screen and puts the panel away', () => {
    stage();
    mount(chart(1200, 600));
    press(button());
    printing.mockImplementation(() => {
      expect(document.querySelectorAll(`.${PRINTOUT_CLASS}`)).toHaveLength(1);
    });
    press(container.querySelector('.print-go'));
    expect(printing).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
  });

  it('says so, and stays open, when there is no chart in the document to print', () => {
    mount(chart(1200, 600));
    press(button());
    press(container.querySelector('.print-go'));
    expect(printing).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
    expect(container.querySelector('.print-warn')?.textContent).toContain('nothing drawn');
  });
});
