/**
 * What there is to see before a file is open.
 *
 * Three jobs: say what this tool does, offer back the trees this browser is already holding, and
 * let somebody who has no file begin anyway.
 *
 * That last one is easy to leave out and expensive to leave out. Everything else here assumes a
 * `.ged` already exists, and a person sitting down to record what they know has nothing to open --
 * for them the whole screen is a door with no handle. So the offer is made in as many words,
 * beside the file picker rather than buried under it.
 *
 * The kept-trees list is the reason the wording here is careful. A list of trees "in this browser" invites
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
  /** Begin with an empty tree, for a user who has no file to open. */
  readonly onStartFresh: () => void;
}

export function EmptyScreen({ stored, onResume, onForget, onStartFresh }: EmptyScreenProps) {
  return (
    <section className="empty">
      <p className="tagline">
        Open a GEDCOM file to see the family drawn. 5.5.1 and 7 are both read, in the encoding
        the file declares.
      </p>
      <p className="privacy">Your file is parsed in this browser and never uploaded.</p>

      <section className="fresh">
        <h2>No file to open?</h2>
        <p className="fresh-note">
          Start an empty tree and type what you know. It begins with one person; partners,
          parents and children are added from there. When you are ready, the save buttons hand
          you a real GEDCOM file you can take anywhere.
        </p>
        <button type="button" className="start-fresh" onClick={onStartFresh}>
          Start a new tree
        </button>
      </section>

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
