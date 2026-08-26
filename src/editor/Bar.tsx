/**
 * The strip along the top: open a file, step through history, write one out.
 *
 * Split out of the shell because the shell had grown to hold the file reader, the command
 * dispatcher, the undo stack, three export formats, persistence and an unload guard, and the
 * markup for all of it. The state stays there; this draws it.
 *
 * The two save-related lines are worth reading together. `loaded` counts what is in the document,
 * and `kept` says where that document has got to -- which is a different question, and the one
 * users get wrong. "Saved" in this application means a file they now hold; "kept" means this
 * browser is holding a copy. The wording never lets one stand in for the other.
 */
import type { ExportDialect } from '../gedcom/serialize.js';
import { canRedo, canUndo, redoLabel, undoLabel, type History } from './history.js';

/** GEDCOM in either version, or the document itself. */
export type SaveFormat = ExportDialect | 'json';

export interface BarProps {
  readonly onOpen: (file: File) => void;
  /** The open file, or `null` when the editor is empty. */
  readonly opened: {
    readonly name: string;
    readonly history: History;
    readonly issues: number;
  } | null;
  readonly people: number;
  readonly families: number;
  readonly warnings: number;
  /** Where this document has got to, in words. See `unsaved.ts`. */
  readonly kept: string;
  /** True where the document on screen differs from the one last written to a file. */
  readonly notWrittenBack: boolean;
  readonly onStep: (direction: 'undo' | 'redo') => void;
  readonly onSave: (format: SaveFormat) => void;
}

export function Bar({
  onOpen,
  opened,
  people,
  families,
  warnings,
  kept,
  notWrittenBack,
  onStep,
  onSave,
}: BarProps) {
  return (
    <header className="bar">
      <h1>FamilyTreeEditor</h1>
      <label className="open">
        <input
          type="file"
          accept=".ged,.gedcom,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) onOpen(file);
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
                onStep('undo');
              }}
            >
              Undo
            </button>
            <button
              type="button"
              disabled={!canRedo(opened.history)}
              title={redoLabel(opened.history)}
              onClick={() => {
                onStep('redo');
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
                onSave('7.0');
              }}
            >
              Save GEDCOM 7
            </button>
            <button
              type="button"
              title="For a program that cannot read GEDCOM 7. Anything the older version cannot say is reported"
              onClick={() => {
                onSave('5.5.1');
              }}
            >
              Save 5.5.1
            </button>
            <button
              type="button"
              title="The document as JSON, in the shape the schema describes"
              onClick={() => {
                onSave('json');
              }}
            >
              Save JSON
            </button>
          </span>
          <p className="loaded">
            {opened.name} — {people} people, {families} families
            {opened.issues > 0 ? `, ${String(opened.issues)} import notes` : ''}
            {warnings > 0 ? `, ${String(warnings)} warnings` : ''}
          </p>
          <p className="kept">
            {kept}
            {notWrittenBack ? ' · not yet written back to a file' : ''}
          </p>
        </>
      )}
    </header>
  );
}
