// @vitest-environment jsdom
/**
 * What the record panels say about a record.
 *
 * The editing itself is covered by `commands.test.ts` and `fields.test.ts`, which is where the
 * document changes. What is left is the reading: that an identifier is shown as the record is
 * named rather than as the file delimits it, that the signs on the chart are the signs in the
 * panel, and that a remarriage says which marriage it is in both places.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PersonPanel } from './PersonPanel.js';
import { UnionPanel } from './UnionPanel.js';
import type { GedcomDoc } from '../model/types.js';

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

/** One person married twice, the second time childless. */
const doc: GedcomDoc = {
  header: { gedcomVersion: '7.0' },
  individuals: [
    {
      xref: '@I1@',
      sex: 'M',
      names: [{ value: 'GivenA /SurnameB/' }],
      events: [
        { tag: 'BIRT', date: { value: '1900', start: { year: 1900 } } },
        { tag: 'DEAT', date: { value: '1970', start: { year: 1970 } } },
      ],
      familiesAsSpouse: [{ xref: '@F1@' }, { xref: '@F2@' }],
    },
    {
      xref: '@I2@',
      sex: 'F',
      names: [{ value: 'GivenC /SurnameD/' }],
      familiesAsSpouse: [{ xref: '@F1@' }],
    },
    {
      xref: '@I3@',
      sex: 'F',
      names: [{ value: 'GivenE /SurnameF/' }],
      familiesAsSpouse: [{ xref: '@F2@' }],
    },
    {
      xref: '@I4@',
      names: [{ value: 'GivenG /SurnameB/' }],
      familiesAsChild: [{ xref: '@F1@' }],
    },
  ],
  families: [
    { xref: '@F1@', husband: '@I1@', wife: '@I2@', children: ['@I4@'] },
    { xref: '@F2@', husband: '@I1@', wife: '@I3@' },
  ],
};

const person = (xref: string) => (
  <PersonPanel doc={doc} xref={xref} run={vi.fn()} onSelect={vi.fn()} />
);
const union = (xref: string) => (
  <UnionPanel doc={doc} xref={xref} run={vi.fn()} onSelect={vi.fn()} />
);

const text = () => container.textContent ?? '';

describe('the identifier a panel shows', () => {
  it('names a person as the record is named, not as the file delimits it', () => {
    // `@` is the standard's delimiter: it tells a parser where an identifier ends and says
    // nothing at all to somebody reading a panel.
    mount(person('@I1@'));
    expect(container.querySelector('.xref')?.textContent).toBe('I1');
    expect(text()).not.toContain('@');
  });

  it('names a union the same way, and the families a person is in', () => {
    mount(union('@F1@'));
    expect(container.querySelector('.xref')?.textContent).toBe('F1');
    expect(text()).not.toContain('@');

    mount(person('@I1@'));
    expect(text()).toContain('Add a child to F1');
    expect(text()).toContain('F1:');
  });
});

describe('the signs a panel shows', () => {
  it('puts the sex sign the chart draws beside the name and on every option', () => {
    mount(person('@I1@'));
    expect(container.querySelector('h2')?.textContent).toContain('\u2642');
    const options = [...container.querySelectorAll('option')].map((node) => node.textContent);
    expect(options).toEqual([
      '\u2642 Male',
      '\u2640 Female',
      '\u26A7 Neither',
      '? Undetermined',
    ]);
  });

  it('daggers a person once a date of death is entered, and not before', () => {
    mount(person('@I1@'));
    expect(container.querySelector('h2')?.textContent).toContain('\u2020');
    const died = [...container.querySelectorAll('label')].find((node) =>
      node.textContent?.startsWith('Died'),
    );
    expect(died?.textContent).toBe('Died \u2020');

    // The same person with the date taken out: the record no longer says they died.
    mount(<PersonPanel doc={doc} xref="@I2@" run={vi.fn()} onSelect={vi.fn()} />);
    expect(container.querySelector('h2')?.textContent).not.toContain('\u2020');
    expect(
      [...container.querySelectorAll('label')].find((node) =>
        node.textContent?.startsWith('Died'),
      )?.textContent,
    ).toBe('Died');
  });
});

describe('which marriage a union is', () => {
  it('says the number the chart draws at the dot, and whose marriage it counts', () => {
    mount(union('@F2@'));
    const said = container.querySelector('.marriage-number')?.textContent;
    expect(said).toBe('Marriage (2) of GivenA SurnameB');
  });

  it('says it for the first marriage too, since the pair only mean something together', () => {
    mount(union('@F1@'));
    expect(container.querySelector('.marriage-number')?.textContent).toBe(
      'Marriage (1) of GivenA SurnameB',
    );
  });

  it('says nothing where neither partner married more than once', () => {
    // A number that is always 1 tells a reader nothing.
    const once: GedcomDoc = {
      header: { gedcomVersion: '7.0' },
      individuals: [
        { xref: '@I1@', names: [{ value: 'A /B/' }], familiesAsSpouse: [{ xref: '@F1@' }] },
        { xref: '@I2@', names: [{ value: 'C /D/' }], familiesAsSpouse: [{ xref: '@F1@' }] },
      ],
      families: [{ xref: '@F1@', husband: '@I1@', wife: '@I2@' }],
    };
    mount(<UnionPanel doc={once} xref="@F1@" run={vi.fn()} onSelect={vi.fn()} />);
    expect(container.querySelector('.marriage-number')).toBeNull();
  });
});
