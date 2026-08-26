/**
 * The shell: open a file, draw it, edit it.
 *
 * The document lives in a history rather than in a `useState`, because every edit has to be
 * undoable and undo has to restore the state exactly. `apply` is the only way in: it runs a
 * command, checks the result against the schema and against `audit()`, and records it only if both
 * pass. A refused edit changes nothing and says why, in the bar, in words a genealogist can act on.
 *
 * The file is read with `File.arrayBuffer()` and parsed in this tab, and written back through
 * the browser's own save dialog -- see `handOver.ts`. There is no upload, no fetch, and nowhere
 * for one to be added by accident: `gedcom/` and `model/` cannot import anything from the UI, and
 * nothing in this project talks to a network at all.
 *
 * Saving reports what the chosen format could not carry. GEDCOM 7 carries everything this editor
 * holds; 5.5.1 does not, and a user choosing the older format is told what it costs them rather
 * than left to find out from the file.
 *
 * **Two different things are called saving here, and the difference is the point.** The tree is
 * autosaved into this browser, so closing the tab does not lose an afternoon's work. That is not
 * the same as writing it back to the user's `.ged`, which a web page cannot do -- only the user
 * can, by taking the file the save buttons hand them. So the unload guard asks about the second,
 * never the first, and the wording everywhere keeps them apart.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { importGedcom, type ImportIssue } from '../gedcom/mapper.js';

import { audit, type AuditFinding } from '../model/audit.js';
import { useLanguage } from '../i18n/context.js';
import { ref, type MessageRef } from '../i18n/keys.js';
import { Chart } from '../render/Chart.js';
import { Bar, type SaveFormat } from './Bar.js';
import { EmptyScreen } from './EmptyScreen.js';
import { Notices, type Saved } from './Notices.js';
import { PersonPanel } from './PersonPanel.js';
import { handOver } from './handOver.js';
import { prepareDownload } from './save.js';
import { UnionPanel } from './UnionPanel.js';
import { NEW_TREE_LABEL, NEW_TREE_NAME, blankTree } from './blank.js';
import { apply, type Command, type Refusal } from './commands.js';
import { useTreeStore } from './persistence.js';
import { hasUnwrittenWork, keptSummary } from './unsaved.js';
import { begin, redo, undo, type History } from './history.js';
import { newTreeId } from '../storage/repository.js';
import type { GedcomDoc, Xref } from '../model/types.js';

interface Opened {
  /** The identifier this tree is stored under, issued when it is first opened. */
  readonly id: string;
  readonly name: string;
  readonly history: History;
  readonly issues: readonly ImportIssue[];
}

export function App() {
  const { t, locale } = useLanguage();

  /** `2026-08-26T02:30:00.000Z` as something a person reads, in the language they chose. */
  const clockOf = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

  const [opened, setOpened] = useState<Opened | null>(null);
  const [failed, setFailed] = useState<MessageRef | null>(null);
  const [refused, setRefused] = useState<Refusal | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [saveFailure, setSaveFailure] = useState<MessageRef | null>(null);
  const [chosen, setChosen] = useState<Xref | null>(null);
  const recordRef = useRef<HTMLElement | null>(null);
  /* The exact document last written back to a file. Documents are immutable and structurally
     shared, so comparing by reference answers "has anything changed since?" precisely -- and an
     undo back to the state that was exported correctly stops counting as unwritten. */
  const [exported, setExported] = useState<GedcomDoc | null>(null);

  const open = useCallback((file: File) => {
    setFailed(null);
    setRefused(null);
    setSaved(null);
    setSaveFailure(null);
    file
      .arrayBuffer()
      .then((buffer) => {
        const { doc, issues } = importGedcom(new Uint8Array(buffer), file.name);
        setOpened({
          id: newTreeId(),
          name: file.name,
          history: begin(doc, ref('command.opened', { name: file.name })),
          issues,
        });
        setChosen(null);
        /* The document came off disk this instant, so it matches the file the user still has.
           Leaving this null made the unload guard fire on every session, with zero edits. */
        setExported(doc);
      })
      .catch((error: unknown) => {
        // Never silently: a file that will not open has to say so, and say why.
        setFailed(
          ref('notices.readFailed', {
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      });
  }, []);

  const run = useCallback((command: Command) => {
    // The last save described a document that no longer exists, so the report goes with it.
    setSaved(null);
    setOpened((current) => {
      if (current === null) return current;
      const outcome = apply(current.history, command);
      if (!outcome.ok) {
        setRefused(outcome.problem);
        return current;
      }
      setRefused(null);
      if (outcome.created !== undefined) setChosen(outcome.created);
      return { ...current, history: outcome.history };
    });
  }, []);

  const step = useCallback((direction: 'undo' | 'redo') => {
    setRefused(null);
    setSaved(null);
    setOpened((current) =>
      current === null
        ? current
        : {
            ...current,
            history: direction === 'undo' ? undo(current.history) : redo(current.history),
          },
    );
  }, []);

  /**
   * Write the document out, wherever the user says.
   *
   * Nothing is claimed until the file exists. A save dialog can be closed without choosing
   * anything, and treating that as a save would mark the document written-back and disarm the
   * unload guard over a file that was never created -- so a cancellation is simply silent, and a
   * failed write says so rather than reporting a success.
   *
   * The document written is captured here rather than read back afterwards: the user can go on
   * editing while the dialog is open, and what was saved is what was on screen when they asked.
   */
  const save = useCallback(
    (format: SaveFormat) => {
      if (opened === null) return;
      const document_ = opened.history.present.doc;
      const file = prepareDownload(document_, opened.name, format);
      setSaveFailure(null);
      setSaved(null);

      /* The dialog's own label is the one place the operating system reads our words back to the
         user, so it is rendered here rather than left as a reference `handOver` cannot resolve. */
      void handOver({ ...file, kind: t(file.kind) })
        .then((result) => {
          if (result.outcome === 'cancelled') return;
          if (result.outcome === 'failed') {
            setSaveFailure(ref('notices.writeFailed', { detail: result.problem }));
            return;
          }
          setExported(document_);
          setSaved({ headline: file.headline(result.filename), notes: file.notes });
        })
        .catch((error: unknown) => {
          // `handOver` answers rather than throws, so this is the unforeseen kind. It still
          // reaches the screen: a save that quietly did nothing is the worst outcome here.
          setSaveFailure(
            ref('notices.writeFailed', {
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
        });
    },
    [opened, t],
  );

  const doc = opened?.history.present.doc;

  const store = useTreeStore(
    opened === undefined || opened === null || doc === undefined
      ? null
      : { id: opened.id, name: opened.name, doc },
  );

  /**
   * Begin with no file at all.
   *
   * For the user who has nothing to open. The new person is selected straight away, because an
   * unnamed box on an otherwise empty chart is not an obvious invitation to click, and the panel
   * is where the tree is actually built.
   *
   * `exported` stays null, which is the truth: this document has never been in a file. Where this
   * browser is storing nothing, that makes closing the tab a real loss and the guard says so.
   */
  const startFresh = useCallback(() => {
    setFailed(null);
    setRefused(null);
    setSaved(null);
    setSaveFailure(null);
    const { doc: fresh, first } = blankTree();
    setOpened({
      id: newTreeId(),
      name: NEW_TREE_NAME,
      history: begin(fresh, NEW_TREE_LABEL),
      issues: [],
    });
    setChosen(first);
    setExported(null);
  }, []);

  /** Open a tree this browser was already holding. */
  const resume = useCallback(
    (id: string) => {
      setFailed(null);
      setRefused(null);
      setSaved(null);
      setSaveFailure(null);
      void store
        .reopen(id)
        .then((stored) => {
          if (stored === undefined) {
            setFailed(ref('app.treeGone'));
            return;
          }
          setOpened({
            id: stored.id,
            name: stored.name,
            history: begin(stored.doc, ref('command.reopened', { name: stored.name })),
            issues: [],
          });
          setChosen(null);
          /* Deliberately not `setExported(stored.doc)`: the autosaved edits really were never
             written back to the user's file. That is a true statement about the file rather than
             a danger, so it colours the status line and not the guard -- see `unsaved.ts`. */
          setExported(null);
        })
        .catch((error: unknown) => {
          setFailed(
            ref('notices.readFailed', {
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
        });
    },
    [store],
  );

  const unsaved = { doc, exported, persistent: store.persistent, pending: store.pending };
  /* Work that exists in neither a file the user holds nor this browser's storage. The reasoning,
     and why it is not simply "has this been exported", is in `unsaved.ts`. */
  const unwritten = hasUnwrittenWork(unsaved);

  useEffect(() => {
    if (!unwritten) return undefined;
    const onLeave = (event: BeforeUnloadEvent): void => {
      // `preventDefault` alone is what the specification asks for, and what current browsers act
      // on. The old `returnValue = ''` incantation is deliberately not used: it writes to the
      // event, which this project's lint rules forbid, and no supported browser still needs it.
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
    };
  }, [unwritten]);

  /* Focus follows the selection into the record panel.
     Opening a record from the chart used to leave focus on the node, and the panel is rendered
     after the whole scene -- so reaching the fields you had just opened meant tabbing past every
     remaining person, union and fold control. Measured in a browser on an eighteen-person file:
     thirty-one stops. On a real chart it is several hundred, which is not a keyboard route at all.
     Escape closes the panel and puts focus back on the node it came from, so the chart is not a
     place a keyboard user can fall into and have to climb out of. */
  useEffect(() => {
    if (chosen === null) return undefined;
    recordRef.current?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const cameFrom = document.querySelector<SVGGElement>(`[data-id="${chosen}"]`);
      setChosen(null);
      cameFrom?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [chosen]);

  /* Ctrl+Z and Ctrl+Shift+Z, because an editor without them is not an editor. Bound on the window
     so they work wherever the focus is, except inside a field, where the browser's own undo is
     what the user means. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      const inField =
        event.target instanceof HTMLElement && event.target.closest('input, select');
      if (inField !== null) return;
      event.preventDefault();
      step(event.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [step]);

  const findings: readonly AuditFinding[] = doc === undefined ? [] : audit(doc);
  const warnings = findings.filter((finding) => finding.severity === 'warning');

  const keptLine = keptSummary({
    ...unsaved,
    savedAt: store.savedAt,
    ...(store.savedAt !== null && !store.pending ? { clock: clockOf(store.savedAt) } : {}),
  });

  return (
    <main className="shell">
      <Bar
        onOpen={open}
        opened={
          opened === null
            ? null
            : { name: opened.name, history: opened.history, issues: opened.issues.length }
        }
        people={doc?.individuals.length ?? 0}
        families={doc?.families.length ?? 0}
        warnings={warnings.length}
        kept={keptLine}
        notWrittenBack={doc !== exported}
        onStep={step}
        onSave={save}
      />

      <Notices
        failed={failed}
        storeFailure={store.failure}
        saveFailure={saveFailure}
        refused={refused}
        saved={saved}
      />

      {opened === null || doc === undefined ? (
        <EmptyScreen
          stored={store.stored}
          onResume={resume}
          onForget={store.forget}
          onStartFresh={startFresh}
        />
      ) : (
        <section className="work">
          <div className="stage">
            <Chart doc={doc} onSelectPerson={setChosen} onSelectUnion={setChosen} />
          </div>
          {chosen === null ? null : (
            <aside
              className="record"
              ref={recordRef}
              /* Focusable programmatically but not a tab stop of its own: the panel is where
                 focus is put, and Tab from there goes to its first field. */
              tabIndex={-1}
              aria-label={t('app.record')}
            >
              {doc.families.some((family) => family.xref === chosen) ? (
                <UnionPanel doc={doc} xref={chosen} run={run} onSelect={setChosen} />
              ) : (
                <PersonPanel doc={doc} xref={chosen} run={run} onSelect={setChosen} />
              )}
              <button
                type="button"
                className="close"
                onClick={() => {
                  setChosen(null);
                }}
              >
                {t('app.close')}
              </button>
            </aside>
          )}
        </section>
      )}
    </main>
  );
}
