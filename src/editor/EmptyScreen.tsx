/**
 * What there is to see before a file is open.
 *
 * Two jobs: say what this tool does, and offer back the trees this browser is already holding.
 * The second is the reason the wording here is careful. A list of trees "in this browser" invites
 * the reading that they have been saved somewhere, so the note under it says plainly that nothing
 * has been sent anywhere and nothing has been written back to the files they came from -- which
 * are the two things a user would otherwise assume in opposite directions.
 */
import type { TreeSummary } from '../storage/repository.js';

/** `2026-08-26T02:30:00.000Z` as something a person reads. */
const clockOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const dayOf = (iso: string): string => new Date(iso).toLocaleDateString();

export interface EmptyScreenProps {
  readonly stored: readonly TreeSummary[];
  readonly onResume: (id: string) => void;
  readonly onForget: (id: string) => void;
}

export function EmptyScreen({ stored, onResume, onForget }: EmptyScreenProps) {
  return (
    <section className="empty">
      <p className="tagline">
        Open a GEDCOM file to see the family drawn. 5.5.1 and 7 are both read, in the encoding
        the file declares.
      </p>
      <p className="privacy">Your file is parsed in this browser and never uploaded.</p>

      {stored.length === 0 ? null : (
        <section className="kept-trees">
          <h2>In this browser</h2>
          <p className="kept-note">
            Trees you have opened before, kept on this device. Nothing here has been sent
            anywhere, and nothing here has been written back to the files they came from.
          </p>
          <ul>
            {stored.map((tree) => (
              <li key={tree.id}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onResume(tree.id);
                  }}
                >
                  {tree.name}
                </button>
                <span className="kept-detail">
                  {tree.people} people, {tree.families} families · {dayOf(tree.savedAt)}{' '}
                  {clockOf(tree.savedAt)}
                </span>
                <button
                  type="button"
                  className="forget"
                  title={`Forget ${tree.name}. The file it came from is not touched.`}
                  onClick={() => {
                    onForget(tree.id);
                  }}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
