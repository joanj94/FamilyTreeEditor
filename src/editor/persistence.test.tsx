// @vitest-environment jsdom
/**
 * Autosave, as the thing it actually is: a promise to somebody about their work.
 *
 * The repository's own contract is tested in `storage/repository.test.ts`. What is tested here is
 * the part that can be wrong while every one of those passes -- whether the tree that reaches the
 * store is the current one, whether an edit arriving mid-save is lost, and whether a failure is
 * reported instead of leaving a user to believe their afternoon is safe.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import 'fake-indexeddb/auto';

import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOSAVE_DELAY_MS, useTreeStore, type TreeStore } from './persistence.js';
import { openDatabase, STORE_NAME } from '../storage/indexeddb.js';
import type { GedcomDoc } from '../model/types.js';

/* React 19 refuses to flush updates inside `act` unless it is told it is in a test environment,
   and the refusal is a warning rather than an error -- so without this the probe simply keeps
   rendering the state it had before the save resolved, and every assertion reads a stale value. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const docWith = (people: number): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals: Array.from({ length: people }, (_item, index) => ({
    xref: `@I${String(index + 1)}@`,
    names: [{ value: `GivenA${String(index + 1)} /SurnameB/` }],
  })),
  families: [],
});

let container: HTMLDivElement;
let root: Root;

/**
 * The hook's latest return, and a way to change the tree it is watching.
 *
 * Captured in an effect rather than during render. Writing to something outside the component
 * while rendering is a side effect, and React's own lint rule says so -- a probe is not exempt
 * from the rule it exists to observe. An effect with no dependency array runs after every render,
 * and `act` flushes effects, so what is read after an `act` is always the current value.
 */
const latest: { store?: TreeStore; setDoc?: (doc: GedcomDoc) => void } = {};

const store = (): TreeStore => {
  if (latest.store === undefined) throw new Error('The probe has not rendered yet.');
  return latest.store;
};

const setDoc = (doc: GedcomDoc): void => {
  if (latest.setDoc === undefined) throw new Error('The probe has not rendered yet.');
  latest.setDoc(doc);
};

function Probe({ id, name, doc }: { id: string; name: string; doc: GedcomDoc }) {
  const [current, setCurrent] = useState(doc);
  const value = useTreeStore({ id, name, doc: current });
  // The setter's identity is stable, so this runs once. The hook's return changes on every render,
  // so that one deliberately has no dependency list.
  useEffect(() => {
    latest.setDoc = setCurrent;
  }, [setCurrent]);
  useEffect(() => {
    latest.store = value;
  });
  return null;
}

const mount = (doc: GedcomDoc, id = 'tree-1', name = 'invented.ged'): void => {
  act(() => {
    root.render(<Probe id={id} name={name} doc={doc} />);
  });
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Let the debounce elapse and every promise it started settle.
 *
 * Real time rather than fake: `fake-indexeddb` schedules its own transaction completion on the
 * same timer queue, so faking it stops the database from ever answering. Waiting out a debounce
 * measured in hundreds of milliseconds is the cheaper of the two problems.
 *
 * Two `act` scopes, not one, and the reason is easy to lose an hour to. React processes the state
 * updates an `act` collected when that `act` *ends*. Opening the repository resolves a promise, so
 * inside a single long `act` the re-render it causes -- and therefore the effect that arms the
 * autosave timer -- does not happen until the wait is already over, and the timer never fires. The
 * first scope lets the repository arrive; the second waits out the debounce it armed.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await wait(20);
  });
  await act(async () => {
    await wait(AUTOSAVE_DELAY_MS + 120);
  });
};

/**
 * Start each test with an empty store.
 *
 * The hook opens the real database by name, so without this every test inherits the rows the last
 * one wrote and the suite passes or fails depending on the order it ran in. The rows are cleared
 * rather than the database dropped: `deleteDatabase` waits for every open connection to close, and
 * the hook from the previous test is still holding one.
 */
const emptyDatabase = async (): Promise<void> => {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.addEventListener('complete', () => {
      resolve();
    });
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('The store could not be cleared.'));
    });
  });
  database.close();
};

beforeEach(async () => {
  await emptyDatabase();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('autosave', () => {
  it('writes the tree once the document stops changing', async () => {
    mount(docWith(2));
    expect(store().savedAt).toBeNull();

    await settle();

    expect(store().savedAt).not.toBeNull();
    expect(store().stored).toEqual([
      expect.objectContaining({ id: 'tree-1', name: 'invented.ged', people: 2 }),
    ]);
  });

  it('keeps only the last of a burst of edits', async () => {
    // Each keystroke is a new document. Writing every one would fill the store with states nobody
    // asked to keep and make the status line change faster than it can be read.
    mount(docWith(1));
    act(() => {
      setDoc(docWith(2));
    });
    act(() => {
      setDoc(docWith(3));
    });
    await settle();

    expect(store().stored).toHaveLength(1);
    expect(store().stored[0]).toMatchObject({ people: 3 });
  });

  it('stores the newest document, not the one a save started with', async () => {
    mount(docWith(1));
    await settle();
    expect(store().stored[0]).toMatchObject({ people: 1 });

    act(() => {
      setDoc(docWith(9));
    });
    await settle();

    expect(store().stored[0]).toMatchObject({ people: 9 });
  });

  it('writes nothing when the document has not changed', async () => {
    // Undo back to a state already stored yields the same document by reference, and there is
    // nothing to record about it.
    const same = docWith(4);
    mount(same);
    await settle();
    const first = store().savedAt;

    act(() => {
      setDoc(same);
    });
    await settle();

    expect(store().savedAt).toBe(first);
  });
});

describe('the stored trees', () => {
  it('can be read back in full and forgotten', async () => {
    mount(docWith(3));
    await settle();

    const reopened = await store().reopen('tree-1');
    expect(reopened?.doc.individuals).toHaveLength(3);
    expect(reopened?.name).toBe('invented.ged');

    await act(async () => {
      store().forget('tree-1');
      await wait(50);
    });

    expect(store().stored).toEqual([]);
  });

  it('answers with nothing for a tree that is not there', async () => {
    mount(docWith(1));
    await settle();
    expect(await store().reopen('never-stored')).toBeUndefined();
  });

  it('says whether anything is really being kept', async () => {
    mount(docWith(1));
    await settle();
    // fake-indexeddb is loaded here, so this is the persistent path. The memory fallback is
    // asserted in storage/repository.test.ts, where the failure can be induced at its source.
    expect(store().persistent).toBe(true);
  });
});
