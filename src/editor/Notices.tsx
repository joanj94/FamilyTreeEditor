/**
 * The band of things the shell needs to tell the user.
 *
 * Five kinds of message, and each is announced rather than merely drawn. They appear in response
 * to something the user did and then sit there silently, which for anybody using a screen reader
 * means they may as well not exist: pressing **Save 5.5.1** and being told nothing about the
 * `SEX X` that could not be carried is the same experience as an export that lost it quietly.
 *
 * `alert` for the three failures, because a file that would not open, a file that would not be
 * written or a tree that could not be stored interrupts what the user was doing. `status` for the rest, which are the results of what
 * they just asked for and can wait for a pause in speech.
 */
import type { ExportNote } from '../gedcom/serialize.js';

export interface Saved {
  readonly headline: string;
  readonly notes: readonly ExportNote[];
}

export interface NoticesProps {
  /** A file that could not be read at all. */
  readonly failed: string | null;
  /** A tree that could not be kept in this browser. */
  readonly storeFailure: string | null;
  /** A file the user chose a place for, which then could not be written. */
  readonly saveFailure: string | null;
  /** An edit the document refused, phrased for the user rather than for a log. */
  readonly refused: string | null;
  /** What the last export did, and what the format could not carry. */
  readonly saved: Saved | null;
}

export function Notices({ failed, storeFailure, saveFailure, refused, saved }: NoticesProps) {
  return (
    <>
      {failed === null ? null : (
        <p className="failed" role="alert">
          That file could not be read: {failed}
        </p>
      )}
      {storeFailure === null ? null : (
        <p className="failed" role="alert">
          {storeFailure}
        </p>
      )}
      {saveFailure === null ? null : (
        <p className="failed" role="alert">
          That file could not be written: {saveFailure}
        </p>
      )}
      {refused === null ? null : (
        <p className="refused" role="status">
          {refused}
        </p>
      )}
      {saved === null ? null : (
        <div className="saved" role="status">
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
    </>
  );
}
