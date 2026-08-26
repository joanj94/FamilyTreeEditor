/**
 * The repository, in the browser's own database.
 *
 * IndexedDB is used directly rather than through a wrapper library. The surface this needs is four
 * operations over one object store, and the awkward part of IndexedDB is not its API but its
 * transaction lifetime -- which a wrapper hides without removing. Hiding it is how you get the bug
 * where a transaction has quietly gone stale between an `await` and the next call.
 *
 * **One object store, not two.** A list could be drawn faster from summaries kept beside the
 * documents, and every write would then have to keep the two in step. A summary that disagrees
 * with the document it describes is a bug the user reads as a lie -- "142 people" against a chart
 * with 140 in it -- and the only way to be sure it cannot happen is to keep one copy. Reading whole
 * documents to count them is the price, and for the handful of trees one person keeps it is not
 * worth optimising before anyone has felt it.
 *
 * **A promise per request, and the error is the request's own.** `request.error` says what went
 * wrong; a generic "IndexedDB failed" would send the user to a support forum instead of to their
 * browser's storage settings.
 */
import { createMemoryRepository } from './memory.js';
import {
  byNewest,
  readStoredTree,
  summarise,
  type StoredTree,
  type TreeRepository,
  type TreeSummary,
} from './repository.js';

export const DATABASE_NAME = 'familytree-editor';
export const DATABASE_VERSION = 1;
export const STORE_NAME = 'trees';

export interface PersistentRepository extends TreeRepository {
  readonly isPersistent: true;
}

/** True where this environment has an IndexedDB to talk to at all. */
export const hasIndexedDb = (): boolean =>
  typeof indexedDB !== 'undefined' && indexedDB !== null;

/** One request, one promise. */
function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.addEventListener('success', () => {
      resolve(source.result);
    });
    source.addEventListener('error', () => {
      reject(
        source.error ?? new Error('The database request failed and said nothing further.'),
      );
    });
  });
}

/**
 * Wait for the transaction rather than for the write.
 *
 * A `put` reports success the moment it is queued, which is before anything is durable. A caller
 * told "saved" at that point and then hit by a quota error a millisecond later has been misled at
 * exactly the moment it mattered, so `save` and `remove` resolve on the transaction's
 * `complete` event rather than on the request's.
 */
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => {
      resolve();
    });
    transaction.addEventListener('error', () => {
      reject(
        transaction.error ??
          new Error('The database transaction failed and said nothing further.'),
      );
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('The database transaction was aborted.'));
    });
  });
}

/**
 * Open the database, creating the store on first use.
 *
 * `blocked` is answered rather than left to time out: it fires when another tab holds an older
 * version open, and a promise that never settles would leave the editor on a blank screen with no
 * explanation. Saying which situation it is at least tells the user which tab to close.
 */
export function openDatabase(
  name = DATABASE_NAME,
  version = DATABASE_VERSION,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, version);

    open.addEventListener('upgradeneeded', () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    });

    open.addEventListener('success', () => {
      resolve(open.result);
    });

    open.addEventListener('error', () => {
      reject(open.error ?? new Error('The database could not be opened.'));
    });

    open.addEventListener('blocked', () => {
      reject(
        new Error(
          'Another tab has an older version of this database open. Close it and reload this one.',
        ),
      );
    });
  });
}

/** A repository over an already-open database. */
export function createIndexedDbRepository(database: IDBDatabase): PersistentRepository {
  const read = <T>(ask: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    request(ask(database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)));

  const write = (apply_: (store: IDBObjectStore) => void): Promise<void> => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    apply_(transaction.objectStore(STORE_NAME));
    return completed(transaction);
  };

  /* Every method below is `async`, and that is not cosmetic. `database.transaction()` *throws*
     when the connection has closed rather than returning a rejected promise, so a non-async arrow
     propagated that synchronously -- past the `.then()` meant to catch it, out of the `setTimeout`
     the autosave runs in, and into nothing at all. The user was left being told their work was
     safe by a status line that never heard the write had failed. */
  return {
    isPersistent: true,

    list: async (): Promise<readonly TreeSummary[]> => {
      const stored = await read<StoredTree[]>(
        (store) => store.getAll() as IDBRequest<StoredTree[]>,
      );
      // Listing is deliberately forgiving: a record this build cannot read still belongs in the
      // list, so the user can see it and be told why when they try to open it.
      return stored.map(summarise).sort(byNewest);
    },

    load: async (id: string): Promise<StoredTree | undefined> => {
      const stored = await read<unknown>((store) => store.get(id) as IDBRequest<unknown>);
      if (stored === undefined) return undefined;

      const parsed = readStoredTree(stored);
      if (!parsed.ok) {
        // Never silently. A tree that quietly vanishes teaches the user that this editor loses
        // things; naming what is wrong with the record at least makes it their decision.
        throw new Error(`The stored tree ${id} could not be read back: ${parsed.problem}.`);
      }
      return parsed.tree;
    },

    save: async (tree: StoredTree): Promise<void> => {
      await write((store) => {
        // Structured cloning refuses anything that is not plain data, and the document is exactly
        // that -- no class instances, no functions, nothing the model does not describe.
        store.put(tree);
      });
    },

    remove: async (id: string): Promise<void> => {
      await write((store) => {
        store.delete(id);
      });
    },
  };
}

/**
 * The repository the editor should use.
 *
 * Falls back to memory rather than failing, and says which it got. A private window, a browser with
 * site data disabled, or a refused quota all arrive here as a rejected open -- and in every one of
 * them the right answer is an editor that works without autosave, not a blank page. The caller is
 * told, so it can tell the user.
 */
export async function openTreeRepository(): Promise<
  TreeRepository & { isPersistent: boolean }
> {
  if (!hasIndexedDb()) return createMemoryRepository();
  try {
    return createIndexedDbRepository(await openDatabase());
  } catch {
    // Swallowed to this extent and no further: the cause is a browser setting the user chose
    // rather than a fault they can act on, and it must not stop the editor from opening. That it
    // happened is reported upwards through `isPersistent`, not hidden.
    return createMemoryRepository();
  }
}
