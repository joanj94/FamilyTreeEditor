/**
 * The band of things the shell needs to tell the user.
 *
 * Six kinds of message, and each is announced rather than merely drawn. They appear in response
 * to something the user did and then sit there silently, which for anybody using a screen reader
 * means they may as well not exist: pressing **Save GEDCOM 5.5.1** and being told nothing about the
 * `SEX X` that could not be carried is the same experience as an export that lost it quietly.
 *
 * `alert` for the three failures, because a file that would not open, a file that would not be
 * written or a tree that could not be stored interrupts what the user was doing. `status` for the
 * rest -- a refusal, an export, a sort -- which are the results of what they just asked for and can
 * wait for a pause in speech.
 *
 * **This is where prose is made.** Everything arriving here is a `MessageRef` or a raw detail
 * string; the sentences are assembled at this edge, in the language current when they are read.
 * A refusal is the clearest case: it comes in three pieces -- the edit attempted, what went wrong,
 * and the finding underneath -- precisely so that none of them is frozen into English upstream.
 */
import { displayXref } from '../model/labels.js';
import { useT } from '../i18n/context.js';
import type { MessageRef } from '../i18n/keys.js';
import type { ExportNote } from '../gedcom/serialize.js';
import type { Refusal } from './commands.js';

export interface Saved {
  readonly headline: MessageRef;
  readonly notes: readonly ExportNote[];
}

export interface NoticesProps {
  /** A file that could not be read at all. */
  readonly failed: MessageRef | null;
  /** A tree that could not be kept in this browser. */
  readonly storeFailure: MessageRef | null;
  /** A file the user chose a place for, which then could not be written. */
  readonly saveFailure: MessageRef | null;
  /** An edit the document refused, phrased for the user rather than for a log. */
  readonly refused: Refusal | null;
  /** What the last export did, and what the format could not carry. */
  readonly saved: Saved | null;
  /**
   * What the last sort did, in parts.
   *
   * Parts rather than one sentence, for the reason `Refusal` is in parts: a sort says two things
   * -- what it reordered, and who it could say nothing about -- and the second only sometimes.
   * Assembling them here keeps both in whatever language is current when they are read.
   */
  readonly sorted: readonly MessageRef[] | null;
}

export function Notices({
  failed,
  storeFailure,
  saveFailure,
  refused,
  saved,
  sorted,
}: NoticesProps) {
  const t = useT();

  return (
    <>
      {failed === null ? null : (
        <p className="failed" role="alert">
          {t(failed)}
        </p>
      )}
      {storeFailure === null ? null : (
        <p className="failed" role="alert">
          {t(storeFailure)}
        </p>
      )}
      {saveFailure === null ? null : (
        <p className="failed" role="alert">
          {t(saveFailure)}
        </p>
      )}
      {refused === null ? null : (
        <p className="refused" role="status">
          {[
            refused.label === undefined ? '' : t(refused.label),
            t(refused.say),
            refused.cause === undefined ? '' : t(refused.cause),
          ]
            .filter((part) => part !== '')
            .join(' ')}
        </p>
      )}
      {sorted === null ? null : (
        <p className="sorted" role="status">
          {sorted.map((part) => t(part)).join(' ')}
        </p>
      )}
      {saved === null ? null : (
        <div className="saved" role="status">
          <p>{t(saved.headline)}</p>
          {saved.notes.length === 0 ? null : (
            <ul>
              {saved.notes.map((note) => (
                <li key={`${note.xref ?? ''}${note.message.key}${note.observed}`}>
                  {t(note.message)} <em>{note.observed}</em>
                  {note.xref === undefined ? '' : ` (${displayXref(note.xref)})`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
