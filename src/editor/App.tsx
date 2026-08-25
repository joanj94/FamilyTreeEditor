/**
 * The shell: open a file, draw it, edit it.
 *
 * The document lives in a history rather than in a `useState`, because every edit has to be
 * undoable and undo has to restore the state exactly. `apply` is the only way in: it runs a
 * command, checks the result against the schema and against `audit()`, and records it only if both
 * pass. A refused edit changes nothing and says why, in the bar, in words a genealogist can act on.
 *
 * The file is read with `File.arrayBuffer()` and parsed in this tab, and written back the same
 * way -- a blob and a synthetic click. There is no upload, no fetch, and nowhere for one to be
 * added by accident: `gedcom/` and `model/` cannot import anything from the UI, and nothing in
 * this project talks to a network at all.
 *
 * Saving reports what the chosen format could not carry. GEDCOM 7 carries everything this editor
 * holds; 5.5.1 does not, and a user choosing the older format is told what it costs them rather
 * than left to find out from the file.
 */
import { useCallback, useEffect, useState } from 'react';

import { importGedcom, type ImportIssue } from '../gedcom/mapper.js';
import {
  exportGedcom,
  exportJson,
  type ExportDialect,
  type ExportNote,
} from '../gedcom/serialize.js';
import { audit, type AuditFinding } from '../model/audit.js';
import { Chart } from '../render/Chart.js';
import { PersonPanel } from './PersonPanel.js';
import { UnionPanel } from './UnionPanel.js';
import { apply, type Command } from './commands.js';
import {
  begin,
  canRedo,
  canUndo,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from './history.js';
import type { Xref } from '../model/types.js';

interface Opened {
  readonly name: string;
  readonly history: History;
  readonly issues: readonly ImportIssue[];
}

/** GEDCOM in either version, or the document itself. */
type SaveFormat = ExportDialect | 'json';

/** What the last save did, and what the format could not take with it. */
interface Saved {
  readonly headline: string;
  readonly notes: readonly ExportNote[];
}

/**
 * Hand the user a file.
 *
 * A blob and a synthetic click is the only way a page with no server behind it can give somebody
 * a file. The bytes are built in this tab and go straight to their disk. The URL is released on a
 * timeout rather than immediately, because revoking it in the same tick can cancel the download
 * it was created for.
 */
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** The opened file's name without its extension, so a save keeps the family's name on it. */
const stemOf = (name: string): string => name.replace(/\.(ged|gedcom|json)$/i, '');

export function App() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [chosen, setChosen] = useState<Xref | null>(null);

  const open = useCallback((file: File) => {
    setFailed(null);
    setRefused(null);
    setSaved(null);
    file
      .arrayBuffer()
      .then((buffer) => {
        const { doc, issues } = importGedcom(new Uint8Array(buffer), file.name);
        setOpened({ name: file.name, history: begin(doc, `Opened ${file.name}`), issues });
        setChosen(null);
      })
      .catch((error: unknown) => {
        // Never silently: a file that will not open has to say so, and say why.
        setFailed(error instanceof Error ? error.message : String(error));
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

  const save = useCallback(
    (format: SaveFormat) => {
      if (opened === null) return;
      const document_ = opened.history.present.doc;
      const stem = stemOf(opened.name);

      if (format === 'json') {
        download(`${stem}.json`, exportJson(document_), 'application/json');
        setSaved({
          headline: `Saved ${stem}.json. The JSON is the document itself, so it carries everything.`,
          notes: [],
        });
        return;
      }

      const { text, notes } = exportGedcom(document_, { dialect: format });
      download(`${stem}.ged`, text, 'text/plain;charset=utf-8');
      setSaved({
        headline:
          notes.length === 0
            ? `Saved ${stem}.ged as GEDCOM ${format}, with nothing left behind.`
            : `Saved ${stem}.ged as GEDCOM ${format}. That format could not carry ${String(notes.length)} of them:`,
        notes,
      });
    },
    [opened],
  );

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

  const doc = opened?.history.present.doc;
  const findings: readonly AuditFinding[] = doc === undefined ? [] : audit(doc);
  const warnings = findings.filter((finding) => finding.severity === 'warning');

  return (
    <main className="shell">
      <header className="bar">
        <h1>FamilyTreeEditor</h1>
        <label className="open">
          <input
            type="file"
            accept=".ged,.gedcom,text/plain"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) open(file);
            }}
          />
          <span>Open a .ged file</span>
        </label>

        {opened === null ? null : (
          <>
            <span className="steps">
              <button
                type="button"
                disabled={!canUndo(opened.history)}
                title={undoLabel(opened.history)}
                onClick={() => {
                  step('undo');
                }}
              >
                Undo
              </button>
              <button
                type="button"
                disabled={!canRedo(opened.history)}
                title={redoLabel(opened.history)}
                onClick={() => {
                  step('redo');
                }}
              >
                Redo
              </button>
            </span>
            <span className="saves">
              <button
                type="button"
                title="GEDCOM 7 carries everything this editor holds"
                onClick={() => {
                  save('7.0');
                }}
              >
                Save GEDCOM 7
              </button>
              <button
                type="button"
                title="For a program that cannot read GEDCOM 7. Anything the older version cannot say is reported"
                onClick={() => {
                  save('5.5.1');
                }}
              >
                Save 5.5.1
              </button>
              <button
                type="button"
                title="The document as JSON, in the shape the schema describes"
                onClick={() => {
                  save('json');
                }}
              >
                Save JSON
              </button>
            </span>
            <p className="loaded">
              {opened.name} — {doc?.individuals.length ?? 0} people, {doc?.families.length ?? 0}{' '}
              families
              {opened.issues.length > 0 ? `, ${String(opened.issues.length)} import notes` : ''}
              {warnings.length > 0 ? `, ${String(warnings.length)} warnings` : ''}
            </p>
          </>
        )}
      </header>

      {failed === null ? null : <p className="failed">That file could not be read: {failed}</p>}
      {refused === null ? null : <p className="refused">{refused}</p>}
      {saved === null ? null : (
        <div className="saved">
          <p>{saved.headline}</p>
          {saved.notes.length === 0 ? null : (
            <ul>
              {saved.notes.map((note) => (
                <li key={`${note.xref ?? ''}${note.message}${note.observed}`}>
                  {note.message} <em>{note.observed}</em>
                  {note.xref === undefined ? '' : ` (${note.xref})`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {opened === null || doc === undefined ? (
        <section className="empty">
          <p className="tagline">
            Open a GEDCOM file to see the family drawn. 5.5.1 and 7 are both read, in the
            encoding the file declares.
          </p>
          <p className="privacy">Your file is parsed in this browser and never uploaded.</p>
        </section>
      ) : (
        <section className="work">
          <div className="stage">
            <Chart doc={doc} onSelectPerson={setChosen} onSelectUnion={setChosen} />
          </div>
          {chosen === null ? null : (
            <aside className="record">
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
                Close
              </button>
            </aside>
          )}
        </section>
      )}
    </main>
  );
}
