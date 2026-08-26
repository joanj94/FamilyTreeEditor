// @vitest-environment jsdom
/**
 * The four notices, and whether anything says them out loud.
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const show = (props: Parameters<typeof Notices>[0]): void => {
  act(() => {
    root.render(<Notices {...props} />);
  });
};

const quiet = { failed: null, storeFailure: null, refused: null, saved: null };

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
    show({ ...quiet, failed: 'the header is unreadable' });
    const region = container.querySelector('.failed');
    expect(region?.getAttribute('role')).toBe('alert');
    expect(region?.textContent).toContain('the header is unreadable');
  });

  it('announces a tree that could not be kept', () => {
    // The user believes their work is safe. If this one is silent, they go on believing it.
    show({ ...quiet, storeFailure: 'the storage quota is full' });
    expect(container.querySelector('.failed')?.getAttribute('role')).toBe('alert');
  });
});

describe('results wait their turn', () => {
  it('announces a refused edit', () => {
    show({ ...quiet, refused: 'That would make GivenA their own ancestor.' });
    expect(container.querySelector('.refused')?.getAttribute('role')).toBe('status');
  });

  it('announces an export and lists what it could not carry', () => {
    show({
      ...quiet,
      saved: {
        headline: 'Saved invented.ged as GEDCOM 5.5.1. That format could not carry 1 of them:',
        notes: [
          {
            message: 'GEDCOM 5.5.1 has no SEX value X; U was written.',
            observed: 'X',
            xref: '@I1@',
          },
        ],
      },
    });

    const region = container.querySelector('.saved');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.textContent).toContain('SEX value X');
    expect(region?.textContent).toContain('@I1@');
  });

  it('shows an export that lost nothing without an empty list beneath it', () => {
    show({
      ...quiet,
      saved: { headline: 'Saved invented.ged, with nothing left behind.', notes: [] },
    });
    expect(container.querySelectorAll('.saved li')).toHaveLength(0);
  });
});
