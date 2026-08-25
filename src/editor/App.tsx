/**
 * The shell: open a file, draw it.
 *
 * Deliberately thin. Editing, undo/redo and the record panels are still to come, and the seam they
 * will attach to is already here -- the chart raises what was chosen and decides nothing about it.
 *
 * The file is read with `File.arrayBuffer()` and parsed in this tab. There is no upload, no fetch,
 * and nowhere for one to be added by accident: `gedcom/` and `model/` cannot import anything from
 * the UI, and nothing in this project talks to a network at all.
 */
import { useCallback, useState } from 'react';

import { importGedcom, type ImportIssue } from '../gedcom/mapper.js';
import { audit, type AuditFinding } from '../model/audit.js';
import { Chart } from '../render/Chart.js';
import type { GedcomDoc, Xref } from '../model/types.js';

interface Opened {
  readonly name: string;
  readonly doc: GedcomDoc;
  readonly issues: readonly ImportIssue[];
  readonly findings: readonly AuditFinding[];
}

export function App() {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Xref | null>(null);

  const open = useCallback((file: File) => {
    setFailed(null);
    file
      .arrayBuffer()
      .then((buffer) => {
        const { doc, issues } = importGedcom(new Uint8Array(buffer), file.name);
        setOpened({ name: file.name, doc, issues, findings: audit(doc) });
        setChosen(null);
      })
      .catch((error: unknown) => {
        // Never silently: a file that will not open has to say so, and say why.
        setFailed(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const errors = opened?.findings.filter((finding) => finding.severity === 'error') ?? [];
  const warnings = opened?.findings.filter((finding) => finding.severity === 'warning') ?? [];

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
          <p className="loaded">
            {opened.name} — {opened.doc.individuals.length} people, {opened.doc.families.length}{' '}
            families
            {opened.issues.length > 0 ? `, ${String(opened.issues.length)} import notes` : ''}
            {errors.length > 0 ? `, ${String(errors.length)} errors` : ''}
            {warnings.length > 0 ? `, ${String(warnings.length)} warnings` : ''}
          </p>
        )}
      </header>

      {failed === null ? null : <p className="failed">That file could not be read: {failed}</p>}

      {opened === null ? (
        <section className="empty">
          <p className="tagline">
            Open a GEDCOM file to see the family drawn. 5.5.1 and 7 are both read, in the
            encoding the file declares.
          </p>
          <p className="privacy">Your file is parsed in this browser and never uploaded.</p>
        </section>
      ) : (
        <section className="stage">
          <Chart doc={opened.doc} onSelectPerson={setChosen} onSelectUnion={setChosen} />
        </section>
      )}

      {chosen === null ? null : (
        <aside className="chosen">
          {/* The record panel and the edit forms take this place. */}
          <p>{chosen}</p>
        </aside>
      )}
    </main>
  );
}
