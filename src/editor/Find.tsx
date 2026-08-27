/**
 * The search box: a person by name, on a chart too big to look through.
 *
 * The matching itself is in `model/find.ts`, where it can be tested without a DOM. This is the
 * box, the list under it, and the keyboard.
 *
 * **It is a combobox, and it is built as one.** The list is not a menu of links: the input keeps
 * focus throughout, the arrow keys move a highlight that is announced through
 * `aria-activedescendant`, and Enter takes the highlighted row. Typing, then reaching for the
 * mouse to click the only match, is the interaction this replaces.
 *
 * **A match is chosen, not merely selected.** Picking somebody opens their record *and* pans the
 * chart to them -- see `reveal` in `Chart`. Finding a person and then leaving them off screen is
 * not finding them, and on a chart small enough for the selection alone to be enough, nobody
 * needed the search box.
 */
import { useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useT } from '../i18n/context.js';
import { findByName } from '../model/find.js';
import type { GedcomDoc, Xref } from '../model/types.js';

export interface FindProps {
  readonly doc: GedcomDoc;
  /** Raised when a person is chosen. Like the chart, this selects nothing itself. */
  readonly onPick: (xref: Xref) => void;
}

/** The row identifiers `aria-activedescendant` points at. */
const rowId = (xref: Xref): string => `find-${xref.replace(/[^A-Za-z0-9_]/g, '')}`;

export function Find({ doc, onPick }: FindProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  /* Closed after a pick, and re-opened by the next keystroke. Without it the list stays under the
     box covering the record that was just opened, having already answered its question. */
  const [listing, setListing] = useState(false);
  const [at, setAt] = useState(0);

  const matches = useMemo(() => findByName(doc, query), [doc, query]);
  const open = listing && query.trim() !== '';
  const active = open ? matches[at] : undefined;

  const pick = (xref: Xref): void => {
    setListing(false);
    onPick(xref);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      /* First Escape puts the list away, a second clears the box. Clearing on the first took the
         query away from somebody who only wanted to see the chart under the list.

         Each of those stops the event, because the shell binds Escape on the window to close the
         record panel and throw focus back onto the chart -- so without this, dismissing the list
         would also throw the reader out of the box they are still typing in. Once the list is
         away and the box is empty this key means nothing here, and it is let through to do what
         it does everywhere else in the editor. */
      if (open) {
        setListing(false);
        event.stopPropagation();
      } else if (query !== '') {
        setQuery('');
        event.stopPropagation();
      }
      return;
    }
    if (event.key === 'Enter') {
      if (active === undefined) return;
      event.preventDefault();
      pick(active.xref);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (matches.length === 0) return;
    // Arrowing inside a text field moves the caret, which is not what is being asked for here.
    event.preventDefault();
    setListing(true);
    setAt((current) => {
      const next = current + (event.key === 'ArrowDown' ? 1 : -1);
      // Wrapping, because a list of eight is short enough that running off either end is a
      // miskeying rather than an intention.
      return (next + matches.length) % matches.length;
    });
  };

  return (
    <div className="find">
      <label className="find-label" htmlFor="find-person">
        {t('find.label')}
      </label>
      <input
        id="find-person"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="find-results"
        aria-autocomplete="list"
        {...(active === undefined ? {} : { 'aria-activedescendant': rowId(active.xref) })}
        /* The browser's own history of what has been typed into a box called "find" is not
           useful here and covers the matches with it. */
        autoComplete="off"
        placeholder={t('find.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setListing(true);
          setAt(0);
        }}
        onFocus={() => {
          setListing(true);
        }}
        /* Leaving the box puts the list away. The list itself refuses the blur -- see its
           `onMouseDown` -- so this fires when the reader has gone somewhere else, not when they
           are clicking a match. */
        onBlur={() => {
          setListing(false);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          className="find-results"
          id="find-results"
          role="listbox"
          aria-label={t('find.label')}
          /* Keeps the focus in the box while a row is clicked. Without it the blur closes the
             list before the click lands on it, and the row cannot be clicked at all. */
          onMouseDown={(event) => {
            event.preventDefault();
          }}
        >
          {matches.length === 0 ? (
            <li className="none">{t('find.none')}</li>
          ) : (
            matches.map((match, index) => (
              <li
                key={match.xref}
                id={rowId(match.xref)}
                role="option"
                aria-selected={index === at}
                className={index === at ? 'at' : ''}
                onMouseEnter={() => {
                  setAt(index);
                }}
                onClick={() => {
                  pick(match.xref);
                }}
              >
                <span className="who">{match.name}</span>
                {match.years === '' ? null : <span className="when">{match.years}</span>}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
