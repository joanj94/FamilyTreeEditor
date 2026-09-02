// @vitest-environment jsdom
/**
 * The six notices, and whether anything says them out loud.
 *
 * A failure interrupts -- what the user asked for did not happen -- so it is an `alert`. The rest
 * are results of what they just did and can wait for a pause in speech, so they are a `status`.
 * Getting this wrong is invisible in a browser and total for anybody who cannot see the screen.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Notices } from './Notices.js';
import { ref } from '../i18n/keys.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const show = (props: Parameters<typeof Notices>[0]): void => {
  act(() => {
    root.render(<Notices {...props} />);
  });
};

const quiet = {
  failed: null,
  storeFailure: null,
  saveFailure: null,
  refused: null,
  saved: null,
  sorted: null,
};

beforeEach(() => {
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

describe('nothing to report', () => {
  it('renders nothing at all', () => {
    show(quiet);
    expect(container.innerHTML).toBe('');
  });
});

describe('failures interrupt', () => {
  it('announces a file that could not be read', () => {
    show({
      ...quiet,
      failed: ref('notices.readFailed', { detail: 'the header is unreadable' }),
    });
    const region = container.querySelector('.failed');
    expect(region?.getAttribute('role')).toBe('alert');
    expect(region?.textContent).toContain('the header is unreadable');
  });

  it('announces a file that could not be written', () => {
    // The user picked a folder and a name. If this is silent they walk away believing the file
    // is there.
    show({ ...quiet, saveFailure: ref('notices.writeFailed', { detail: 'the disk is full' }) });
    const region = container.querySelector('.failed');
    expect(region?.getAttribute('role')).toBe('alert');
    expect(region?.textContent).toContain('the disk is full');
  });

  it('announces a tree that could not be kept', () => {
    // The user believes their work is safe. If this one is silent, they go on believing it.
    show({
      ...quiet,
      storeFailure: ref('store.notKept', { detail: 'the storage quota is full' }),
    });
    expect(container.querySelector('.failed')?.getAttribute('role')).toBe('alert');
  });
});

describe('results wait their turn', () => {
  it('announces a refused edit', () => {
    show({
      ...quiet,
      refused: { say: ref('ops.wouldBeOwnAncestor', { xref: 'I1', parent: 'I2' }) },
    });
    expect(container.querySelector('.refused')?.getAttribute('role')).toBe('status');
  });

  it('renders a refusal in its three parts, so none of them is frozen in one language', () => {
    show({
      ...quiet,
      refused: {
        label: ref('command.addChild'),
        say: ref('command.refusedBroken'),
        cause: ref('audit.descentCycle', { xref: 'I1' }),
      },
    });
    const said = container.querySelector('.refused')?.textContent ?? '';
    expect(said).toContain('Add a child');
    expect(said).toContain('would break the tree');
    expect(said).toContain('their own ancestor');
  });

  it('announces an export and lists what it could not carry', () => {
    show({
      ...quiet,
      saved: {
        headline: ref('save.gedcomNotes', {
          savedAs: 'invented.ged',
          format: '5.5.1',
          count: 1,
        }),
        notes: [{ message: ref('export.sexXDowngraded'), observed: 'X', xref: '@I1@' }],
      },
    });

    const region = container.querySelector('.saved');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.textContent).toContain('SEX value X');
    /* The record is named `I1`; the `@`s are the file's delimiters and say nothing to a reader. */
    expect(region?.textContent).toContain('(I1)');
  });

  it('announces a sort, assembling its parts into one sentence', () => {
    // Two refs rather than one sentence, for the same reason a refusal is in pieces: the sort has
    // something to say about what it reordered and something about who it could not place, and
    // neither should be frozen into English upstream of here.
    show({
      ...quiet,
      sorted: [
        ref('notices.sorted'),
        ref('notices.sortedFamilies', { count: 2 }),
        ref('notices.sortedUndated', { count: 1 }),
      ],
    });

    const region = container.querySelector('.sorted');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.textContent).toContain('2 families');
    expect(region?.textContent).toContain('1 person has no birth date');
  });

  it('says only the parts that have something to say', () => {
    // A sort that reordered no children still moved records and marriages, so the headline stands
    // alone rather than carrying a count of zero.
    show({ ...quiet, sorted: [ref('notices.sorted')] });
    expect(container.querySelector('.sorted')?.textContent).toBe(
      'Sorted by birth date: children, records and marriages are now in the order they happened.',
    );
  });

  it('shows an export that lost nothing without an empty list beneath it', () => {
    show({
      ...quiet,
      saved: {
        headline: ref('save.gedcomClean', { savedAs: 'invented.ged', format: '7.0' }),
        notes: [],
      },
    });
    expect(container.querySelectorAll('.saved li')).toHaveLength(0);
  });
});
