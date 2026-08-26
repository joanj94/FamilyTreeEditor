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
 * The kept-trees list is the reason the wording here is careful. A list of trees "in this browser"
 * invites the reading that they have been saved somewhere, so the note under it says plainly that
 * nothing has been sent anywhere and nothing has been written back to the files they came from --
 * which are the two things a user would otherwise assume in opposite directions.
 *
 * **Dates follow the chosen language, not the browser's.** These used to be formatted with an
 * `undefined` locale, which asks the browser what it prefers. Once a user can pick a language that
 * becomes a way of showing Catalan prose over an English date, so the choice is passed explicitly.
 */
import { useLanguage } from '../i18n/context.js';
import type { TreeSummary } from '../storage/repository.js';

export interface EmptyScreenProps {
  readonly stored: readonly TreeSummary[];
  readonly onResume: (id: string) => void;
  readonly onForget: (id: string) => void;
  /** Begin with an empty tree, for a user who has no file to open. */
  readonly onStartFresh: () => void;
}

export function EmptyScreen({ stored, onResume, onForget, onStartFresh }: EmptyScreenProps) {
  const { t, locale } = useLanguage();

  /** `2026-08-26T02:30:00.000Z` as something a person reads, in the language they chose. */
  const clockOf = (iso: string): string =>
    new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const dayOf = (iso: string): string => new Date(iso).toLocaleDateString(locale);

  return (
    <section className="empty">
      <p className="tagline">{t('empty.tagline')}</p>
      <p className="privacy">{t('empty.privacy')}</p>

      <section className="fresh">
        <h2>{t('empty.freshHeading')}</h2>
        <p className="fresh-note">{t('empty.freshNote')}</p>
        <button type="button" className="start-fresh" onClick={onStartFresh}>
          {t('empty.startFresh')}
        </button>
      </section>

      {stored.length === 0 ? null : (
        <section className="kept-trees">
          <h2>{t('empty.keptHeading')}</h2>
          <p className="kept-note">{t('empty.keptNote')}</p>
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
                  {t('empty.keptDetail', {
                    people: t('bar.people', { count: tree.people }),
                    families: t('bar.families', { count: tree.families }),
                    day: dayOf(tree.savedAt),
                    clock: clockOf(tree.savedAt),
                  })}
                </span>
                <button
                  type="button"
                  className="forget"
                  title={t('empty.forgetTitle', { name: tree.name })}
                  onClick={() => {
                    onForget(tree.id);
                  }}
                >
                  {t('empty.forget')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
