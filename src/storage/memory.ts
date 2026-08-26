/**
 * A repository that remembers nothing past the tab.
 *
 * Two jobs, and the second is the one that matters. It is the double the contract tests run
 * against, so the shared suite has something to compare IndexedDB's answers to. And it is what the
 * editor falls back to when IndexedDB is unavailable -- a private window, a browser with site data
 * turned off, a profile where the quota was refused.
 *
 * That fallback is a deliberate product decision. The alternative is an editor that will not open
 * at all in a private window, which is a strange thing for a tool whose selling point is that
 * nothing leaves the browser: the users most likely to care about privacy are the ones most likely
 * to have storage switched off. Losing autosave is a smaller failure than losing the application,
 * and the difference is stated rather than hidden -- `isPersistent` is false, and the editor says
 * so on screen.
 */
import {
  byNewest,
  summarise,
  type StoredTree,
  type TreeRepository,
  type TreeSummary,
} from './repository.js';

export interface MemoryRepository extends TreeRepository {
  /** False, and the reason this flag exists. See the module comment. */
  readonly isPersistent: false;
}

/**
 * A store held in a `Map`.
 *
 * Documents are immutable by construction -- every type in the model is `readonly` -- so they are
 * held by reference rather than copied. A caller that mutated one would already have broken the
 * editor's undo stack long before it reached here.
 */
export function createMemoryRepository(initial: readonly StoredTree[] = []): MemoryRepository {
  const trees = new Map<string, StoredTree>(initial.map((tree) => [tree.id, tree]));

  return {
    isPersistent: false,

    list: (): Promise<readonly TreeSummary[]> =>
      Promise.resolve([...trees.values()].map(summarise).sort(byNewest)),

    load: (id: string): Promise<StoredTree | undefined> => Promise.resolve(trees.get(id)),

    save: (tree: StoredTree): Promise<void> => {
      trees.set(tree.id, tree);
      return Promise.resolve();
    },

    remove: (id: string): Promise<void> => {
      trees.delete(id);
      return Promise.resolve();
    },
  };
}
