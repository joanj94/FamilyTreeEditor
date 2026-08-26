/**
 * One suite, both implementations.
 *
 * The point of a repository interface is that the editor cannot tell which one it has. That is only
 * true if somebody checks, so the contract is written once and run against the in-memory store and
 * against IndexedDB. A fallback that quietly behaves differently from the real store is worse than
 * no fallback: it passes the tests, and it is wrong only in the private window where nobody is
 * watching.
 *
 * IndexedDB comes from `fake-indexeddb`, which is the specification's own semantics without a
 * browser -- including the part that matters here, that a transaction completes after its requests
 * rather than with them.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMemoryRepository } from './memory.js';
import {
  createIndexedDbRepository,
  DATABASE_NAME,
  hasIndexedDb,
  openDatabase,
  openTreeRepository,
  STORE_NAME,
} from './indexeddb.js';
import {
  byNewest,
  newTreeId,
  summarise,
  type StoredTree,
  type TreeRepository,
} from './repository.js';
import type { GedcomDoc } from '../model/types.js';

const docWith = (people: number, families: number): GedcomDoc => ({
  header: { gedcomVersion: '7.0' },
  individuals: Array.from({ length: people }, (_item, index) => ({
    xref: `@I${String(index + 1)}@`,
    names: [{ value: `GivenA${String(index + 1)} /SurnameB/` }],
  })),
  families: Array.from({ length: families }, (_item, index) => ({
    xref: `@F${String(index + 1)}@`,
  })),
});

const tree = (over: Partial<StoredTree> = {}): StoredTree => ({
  id: 'tree-1',
  name: 'invented.ged',
  savedAt: '2026-08-25T10:00:00.000Z',
  doc: docWith(2, 1),
  ...over,
});

/** Every implementation has to answer these the same way. */
function contract(label: string, create: () => Promise<TreeRepository>): void {
  describe(label, () => {
    let repository: TreeRepository;

    beforeEach(async () => {
      repository = await create();
    });

    it('has nothing in it to begin with', async () => {
      expect(await repository.list()).toEqual([]);
    });

    it('gives back what was put in, document and all', async () => {
      const stored = tree();
      await repository.save(stored);
      expect(await repository.load(stored.id)).toEqual(stored);
    });

    it('returns undefined for a tree it does not have, rather than throwing', async () => {
      // Absence is an ordinary answer to "is this here". Throwing would make every caller wrap a
      // question in a try block.
      expect(await repository.load('never-stored')).toBeUndefined();
    });

    it('lists what it holds, counted from the document itself', async () => {
      await repository.save(tree({ id: 'a', doc: docWith(3, 2) }));
      expect(await repository.list()).toEqual([
        {
          id: 'a',
          name: 'invented.ged',
          savedAt: '2026-08-25T10:00:00.000Z',
          people: 3,
          families: 2,
        },
      ]);
    });

    it('replaces a tree saved again under the same identifier', async () => {
      await repository.save(tree({ id: 'a', doc: docWith(2, 1) }));
      await repository.save(
        tree({ id: 'a', doc: docWith(5, 3), savedAt: '2026-08-26T10:00:00.000Z' }),
      );

      const listed = await repository.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ people: 5, savedAt: '2026-08-26T10:00:00.000Z' });
    });

    it('lists newest first', async () => {
      await repository.save(tree({ id: 'older', savedAt: '2026-08-20T10:00:00.000Z' }));
      await repository.save(tree({ id: 'newest', savedAt: '2026-08-24T10:00:00.000Z' }));
      await repository.save(tree({ id: 'middle', savedAt: '2026-08-22T10:00:00.000Z' }));

      expect((await repository.list()).map((item) => item.id)).toEqual([
        'newest',
        'middle',
        'older',
      ]);
    });

    it('forgets a tree when asked', async () => {
      await repository.save(tree({ id: 'a' }));
      await repository.save(tree({ id: 'b' }));
      await repository.remove('a');

      expect((await repository.list()).map((item) => item.id)).toEqual(['b']);
      expect(await repository.load('a')).toBeUndefined();
    });

    it('treats removing a tree it does not have as nothing to do', async () => {
      await expect(repository.remove('never-stored')).resolves.toBeUndefined();
    });

    it('keeps trees apart', async () => {
      await repository.save(tree({ id: 'a', name: 'one.ged', doc: docWith(1, 0) }));
      await repository.save(tree({ id: 'b', name: 'two.ged', doc: docWith(4, 2) }));

      expect((await repository.load('a'))?.name).toBe('one.ged');
      expect((await repository.load('b'))?.doc.individuals).toHaveLength(4);
    });

    it('keeps a document that reads back as the same document', async () => {
      // The whole point of storing the document rather than the file: what comes back has to be
      // usable by the editor without re-parsing anything.
      const stored = tree({
        doc: {
          header: { gedcomVersion: '7.0' },
          individuals: [
            {
              xref: '@I1@',
              names: [{ value: 'GivenA /SurnameB/', surname: ['SurnameB', 'SurnameC'] }],
              sex: 'X',
              events: [{ tag: 'BIRT', date: { value: 'ABT 1801', kind: 'APPROXIMATE' } }],
              extensions: [{ tag: '_UID', payload: 'INVENTED-0001' }],
            },
          ],
          families: [],
          otherRecords: [
            { xref: '@S1@', tag: 'SOUR', children: [{ tag: 'TITL', payload: 'A' }] },
          ],
        },
      });

      await repository.save(stored);
      expect(await repository.load(stored.id)).toEqual(stored);
    });
  });
}

contract('the in-memory repository', () => Promise.resolve(createMemoryRepository()));

contract('the IndexedDB repository', async () => {
  // A database per test, so one test's rows are never another's starting state.
  const name = `${DATABASE_NAME}-${newTreeId()}`;
  return createIndexedDbRepository(await openDatabase(name));
});

describe('the pieces the contract is built from', () => {
  it('counts a summary from the document rather than from a field beside it', () => {
    expect(summarise(tree({ doc: docWith(7, 4) }))).toMatchObject({ people: 7, families: 4 });
  });

  it('breaks a tie on identifier, so a list never reorders itself between renders', () => {
    const same = { savedAt: '2026-08-25T10:00:00.000Z', name: 'x', people: 0, families: 0 };
    const sorted = [
      { ...same, id: 'b' },
      { ...same, id: 'a' },
    ].sort(byNewest);
    expect(sorted.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('issues identifiers that do not collide', () => {
    const issued = new Set(Array.from({ length: 500 }, () => newTreeId()));
    expect(issued.size).toBe(500);
  });
});

describe('choosing a repository', () => {
  const real = globalThis.indexedDB;

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { value: real, configurable: true });
  });

  it('uses the database where there is one', async () => {
    expect(hasIndexedDb()).toBe(true);
    expect((await openTreeRepository()).isPersistent).toBe(true);
  });

  it('falls back to memory where opening fails, rather than refusing to start', async () => {
    // A private window, site data switched off, a refused quota. The editor has to open anyway:
    // the users most likely to have storage disabled are the ones this tool is built for.
    const broken = {
      open: () => {
        const pending: Record<string, unknown> = { error: new Error('Storage is disabled.') };
        queueMicrotask(() => {
          (pending.onerror as (() => void) | undefined)?.();
        });
        return pending;
      },
    };
    Object.defineProperty(globalThis, 'indexedDB', { value: broken, configurable: true });

    const repository = await openTreeRepository();
    expect(repository.isPersistent).toBe(false);
    await repository.save(tree());
    expect(await repository.list()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * What comes back out of storage.
 *
 * A record written by a later build, or edited by hand in devtools, crossed out of this program's
 * control and came back. It used to be cast rather than checked, so a malformed one reached the
 * renderer as though the parser had produced it.
 * ------------------------------------------------------------------------------------------- */
describe('reading a record that is not what was written', () => {
  /** Put something past the repository's own `save`, the way another build's write would arrive. */
  const put = async (database: IDBDatabase, value: unknown): Promise<void> =>
    new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(value);
      transaction.addEventListener('complete', () => {
        resolve();
      });
      transaction.addEventListener('error', () => {
        reject(transaction.error ?? new Error('put failed'));
      });
    });

  const open = async () => {
    const database = await openDatabase(`${DATABASE_NAME}-${newTreeId()}`);
    return { database, repository: createIndexedDbRepository(database) };
  };

  it('refuses to hand back a record whose document is not a document', async () => {
    const { database, repository } = await open();
    await put(database, {
      id: 'bad',
      name: 'x.ged',
      savedAt: '2026-08-26T02:00:00.000Z',
      doc: 7,
    });

    await expect(repository.load('bad')).rejects.toThrow(/could not be read back/);
  });

  it('refuses a record missing its envelope', async () => {
    const { database, repository } = await open();
    await put(database, { id: 'bare' });

    await expect(repository.load('bare')).rejects.toThrow(/name/);
  });

  it('still lists a record it cannot read, so it does not silently vanish', async () => {
    // A tree the user can see and be told about beats one that disappears without explanation.
    const { database, repository } = await open();
    await put(database, {
      id: 'bad',
      name: 'unreadable.ged',
      savedAt: '2026-08-26T02:00:00.000Z',
      doc: null,
    });

    const listed = await repository.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: 'unreadable.ged', people: 0, families: 0 });
  });

  it('reads a well-formed record back unchanged', async () => {
    const { repository } = await open();
    const stored = tree();
    await repository.save(stored);
    expect(await repository.load(stored.id)).toEqual(stored);
  });
});

describe('when the connection has gone', () => {
  it('rejects rather than throwing past the caller', async () => {
    // `database.transaction()` throws on a closed connection. A non-async method propagated that
    // synchronously, past the `.then()` that was meant to catch it and out of the `setTimeout`
    // the autosave runs in -- so a failed write reported nothing at all.
    const database = await openDatabase(`${DATABASE_NAME}-${newTreeId()}`);
    const repository = createIndexedDbRepository(database);
    database.close();

    await expect(repository.save(tree())).rejects.toBeInstanceOf(Error);
    await expect(repository.load('tree-1')).rejects.toBeInstanceOf(Error);
    await expect(repository.remove('tree-1')).rejects.toBeInstanceOf(Error);
    await expect(repository.list()).rejects.toBeInstanceOf(Error);
  });
});
