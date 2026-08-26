/**
 * Keeping the open tree remembered, and knowing which trees are.
 *
 * One hook, so the shell can ask for persistence without learning anything about how it is done.
 * It opens a repository once, writes the open tree back whenever it changes, and keeps the list of
 * stored trees current. Everything it exposes is either data to draw or a function to call.
 *
 * **Autosave is debounced, and the reason is not performance.** Typing a name produces a command
 * per keystroke, each a new document. Writing every one of them would fill the store with saves
 * nobody asked for and make the "saved a moment ago" line flicker between states faster than it
 * can be read. A pause of `AUTOSAVE_DELAY_MS` means a save corresponds to the user stopping, which
 * is what they would recognise as a moment worth recording.
 *
 * **What autosave is not.** It writes to this browser, not to the user's `.ged` file: a web page
 * cannot write back to the file it was handed. So the editor has to keep "remembered here" apart
 * from "written back to your file", and the shell's unload guard is about the second. Saying
 * "saved" without that distinction would be the most consequential lie this tool could tell.
 */
import { useCallback, useEffect, useState } from 'react';

import { openTreeRepository } from '../storage/indexeddb.js';
import type { StoredTree, TreeRepository, TreeSummary } from '../storage/repository.js';
import type { GedcomDoc } from '../model/types.js';

/** How long the document has to stop changing before it is written. */
export const AUTOSAVE_DELAY_MS = 800;

/** The tree currently open, or `null` where none is. */
export interface OpenTree {
  readonly id: string;
  readonly name: string;
  readonly doc: GedcomDoc;
}

export interface TreeStore {
  /** Every tree this browser is holding, newest first. */
  readonly stored: readonly TreeSummary[];
  /**
   * False where the tree is being kept only for this tab -- a private window, or a browser with
   * site data switched off. Surfaced rather than hidden, because it changes what closing the tab
   * costs the user.
   */
  readonly persistent: boolean;
  /** When the open tree was last written, or `null` if it has not been written yet. */
  readonly savedAt: string | null;
  /**
   * True where the document on screen has not reached the store yet -- during the debounce, or
   * because the write failed. This is the only window in which closing the tab loses work, so the
   * unload guard is built on it rather than on "has this been exported".
   */
  readonly pending: boolean;
  /** Why the last write failed, in words addressed to the user. `null` when nothing has failed. */
  readonly failure: string | null;
  /** Fetch a stored tree in full, so the shell can open it. */
  readonly reopen: (id: string) => Promise<StoredTree | undefined>;
  /** Forget a stored tree. */
  readonly forget: (id: string) => void;
}

const problem = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Open a repository, autosave `tree` into it, and list what it holds.
 *
 * Passing `null` means nothing is open: the list is still kept current, because the shell draws it
 * on the empty screen, which is exactly when nothing is open.
 */
export function useTreeStore(tree: OpenTree | null): TreeStore {
  const [repository, setRepository] = useState<
    (TreeRepository & { isPersistent: boolean }) | null
  >(null);
  const [stored, setStored] = useState<readonly TreeSummary[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  /* The exact document last written. Compared by reference, which is exact because the model is
     immutable and structurally shared. */
  const [savedDoc, setSavedDoc] = useState<GedcomDoc | null>(null);

  // Opening never rejects -- it falls back to memory -- so there is no failure branch here. What
  // it can report is that the fallback happened, which is `isPersistent`.
  useEffect(() => {
    let live = true;
    void openTreeRepository().then(async (opened) => {
      if (!live) return;
      setRepository(opened);
      const listed = await opened.list();
      if (live) setStored(listed);
    });
    return () => {
      live = false;
    };
  }, []);

  /* Depending on the three fields rather than on `tree` itself: the shell builds that object
     inline, so its identity changes every render while the document inside it does not. The
     document is immutable and structurally shared, so comparing it by reference is exact -- and
     an undo back to an already-saved state correctly writes nothing. */
  const id = tree?.id ?? null;
  const name = tree?.name ?? null;
  const doc = tree?.doc ?? null;

  useEffect(() => {
    if (repository === null || id === null || name === null || doc === null) return undefined;

    let live = true;
    const timer = setTimeout(() => {
      const at = new Date().toISOString();
      void repository
        .save({ id, name, savedAt: at, doc })
        .then(async () => {
          if (!live) return;
          setSavedAt(at);
          setSavedDoc(doc);
          setFailure(null);
          const listed = await repository.list();
          if (live) setStored(listed);
        })
        .catch((error: unknown) => {
          // Never silently. A failed autosave that says nothing leaves somebody believing their
          // work is safe when it is not, which is the worst state this editor could put them in.
          if (live)
            setFailure(`This tree could not be stored in your browser: ${problem(error)}`);
        });
    }, AUTOSAVE_DELAY_MS);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [repository, id, name, doc]);

  const reopen = useCallback(
    (treeId: string): Promise<StoredTree | undefined> =>
      repository === null ? Promise.resolve(undefined) : repository.load(treeId),
    [repository],
  );

  const forget = useCallback(
    (treeId: string) => {
      if (repository === null) return;
      void repository
        .remove(treeId)
        .then(async () => {
          setStored(await repository.list());
        })
        .catch((error: unknown) => {
          setFailure(`That tree could not be removed: ${problem(error)}`);
        });
    },
    [repository],
  );

  return {
    stored,
    persistent: repository?.isPersistent ?? false,
    savedAt,
    /* Nothing open is nothing pending. Otherwise the question is whether this exact document has
       been written, which a debounce means is routinely "not yet". */
    pending: doc !== null && doc !== savedDoc,
    failure,
    reopen,
    forget,
  };
}
