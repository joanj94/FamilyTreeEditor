/**
 * The record panel for a person.
 *
 * **Fields commit when they are left, not on every keystroke.** An edit per character would fill
 * the undo stack with half-typed names, so a field raises one command when it loses focus, and
 * only if what it holds actually changed.
 *
 * **A structural button says what it will do before it does it.** Deleting a person also withdraws
 * them from every family that named them, which a button marked Delete does not say -- so this one
 * counts the links and the confirmation names them.
 *
 * **Each field is keyed by the value it was seeded with**, which is what makes an undo reach the
 * form. The inputs are uncontrolled so that typing does not re-render the chart, and an
 * uncontrolled input keeps whatever the user last typed -- so after an undo the chart showed the
 * old name and the field went on showing the new one, with nothing to say which was real. Putting
 * the value in the key re-mounts the field exactly when the record changes underneath it, and
 * never while somebody is typing into it, since the document does not change until they leave.
 */
import { useId } from 'react';

import { useT } from '../i18n/context.js';
import { ref, type MessageKey } from '../i18n/keys.js';

import {
  addChild,
  addParents,
  addSpouse,
  deletePerson,
  editPerson,
  type Command,
} from './commands.js';
import { eventDate, nameOf, writeEvent, writeName } from './fields.js';
import { DEATH_SIGN, displayName, displayXref, sexSign, sexWord } from '../model/labels.js';
import type { GedcomDoc, Individual, IndividualEventTag, Sex, Xref } from '../model/types.js';

export interface PersonPanelProps {
  readonly doc: GedcomDoc;
  readonly xref: Xref;
  readonly run: (command: Command) => void;
  readonly onSelect: (xref: Xref) => void;
}

/* The sign beside each option is the one the chart draws, so the value chosen here and the mark
   that appears on the box are recognisably the same thing. The word stays: a list of bare signs
   is a puzzle, and it is the word a screen reader has to read out. */
const SEXES: readonly { readonly value: Sex; readonly label: MessageKey }[] = [
  { value: 'M', label: 'sex.M' },
  { value: 'F', label: 'sex.F' },
  { value: 'X', label: 'sex.X' },
  { value: 'U', label: 'sex.U' },
];

/**
 * The dated events this panel edits, and the sign a filled one earns.
 *
 * Only a death has one. A dagger against the field is the same mark the chart puts in the box, so
 * typing a date of death and seeing the sign appear says what that date means to the drawing.
 */
const DATED: readonly {
  readonly tag: IndividualEventTag;
  readonly label: MessageKey;
  readonly sign?: string;
}[] = [
  { tag: 'BIRT', label: 'person.event.BIRT' },
  { tag: 'BAPM', label: 'person.event.BAPM' },
  { tag: 'DEAT', label: 'person.event.DEAT', sign: DEATH_SIGN },
  { tag: 'BURI', label: 'person.event.BURI' },
];

export function PersonPanel({ doc, xref, run, onSelect }: PersonPanelProps) {
  const id = useId();
  const t = useT();
  const person = doc.individuals.find((one) => one.xref === xref);
  if (person === undefined) return <p className="panel-empty">{t('person.gone')}</p>;

  const parts = nameOf(person);
  const died = eventDate(person, 'DEAT');
  const sign = sexSign(person.sex);
  const families = (person.familiesAsSpouse ?? []).map((link) => link.xref);
  const links = families.length + (person.familiesAsChild ?? []).length;

  const rename = (given: string, first: string, second: string): void => {
    const next = writeName({ given, surnames: [first, second] });
    const written = next.value ?? '';
    if (written === (person.names?.[0]?.value ?? '')) return;
    run(
      editPerson(
        xref,
        { names: [next, ...(person.names ?? []).slice(1)] },
        written === ''
          ? ref('command.renameAnon')
          : ref('command.rename', { name: written.replace(/\//g, '') }),
      ),
    );
  };

  const setDate = (tag: IndividualEventTag, written: string): void => {
    if (written.trim() === eventDate(person, tag)) return;
    const events = writeEvent(person, tag, written);
    run(
      editPerson(
        xref,
        { events: events.length === 0 ? undefined : events },
        ref('command.editDate', { name: displayName(person) }),
      ),
    );
  };

  return (
    <div className="panel">
      <h2>
        {sign === '' ? null : (
          <span className="sign" title={sexWord(person.sex, t)}>{`${sign} `}</span>
        )}
        {displayName(person)}
        {died === '' ? null : (
          <span className="sign" title={t('person.diedTitle', { date: died })}>
            {` ${DEATH_SIGN}`}
          </span>
        )}
      </h2>
      <p className="xref">{displayXref(xref)}</p>

      <div className="field">
        <label htmlFor={`${id}-given`}>{t('person.given')}</label>
        <input
          id={`${id}-given`}
          key={`${xref}-given-${parts.given}`}
          defaultValue={parts.given}
          onBlur={(event) => {
            rename(event.target.value, parts.surnames[0] ?? '', parts.surnames[1] ?? '');
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={`${id}-surname`}>{t('person.surname')}</label>
        <input
          id={`${id}-surname`}
          key={`${xref}-surname-${parts.surnames[0] ?? ''}`}
          defaultValue={parts.surnames[0] ?? ''}
          onBlur={(event) => {
            rename(parts.given, event.target.value, parts.surnames[1] ?? '');
          }}
        />
      </div>

      <div className="field">
        {/* A second surname is an ordinary second SURN piece, not a special field. */}
        <label htmlFor={`${id}-surname2`}>{t('person.surname2')}</label>
        <input
          id={`${id}-surname2`}
          key={`${xref}-surname2-${parts.surnames[1] ?? ''}`}
          defaultValue={parts.surnames[1] ?? ''}
          onBlur={(event) => {
            rename(parts.given, parts.surnames[0] ?? '', event.target.value);
          }}
        />
      </div>

      <div className="field">
        <label htmlFor={`${id}-sex`}>{t('person.sex')}</label>
        <select
          id={`${id}-sex`}
          value={person.sex ?? 'U'}
          onChange={(event) => {
            run(
              editPerson(
                xref,
                { sex: event.target.value as Sex },
                ref('command.setSex', { name: displayName(person) }),
              ),
            );
          }}
        >
          {SEXES.map((option) => (
            <option key={option.value} value={option.value}>
              {`${sexSign(option.value)} ${t(option.label)}`}
            </option>
          ))}
        </select>
      </div>

      {DATED.map((event) => (
        <div className="field" key={event.tag}>
          <label htmlFor={`${id}-${event.tag}`}>
            {event.sign === undefined || eventDate(person, event.tag) === ''
              ? t(event.label)
              : `${t(event.label)} ${event.sign}`}
          </label>
          <input
            id={`${id}-${event.tag}`}
            key={`${xref}-${event.tag}-${eventDate(person, event.tag)}`}
            defaultValue={eventDate(person, event.tag)}
            placeholder={t('person.datePlaceholder')}
            onBlur={(input) => {
              setDate(event.tag, input.target.value);
            }}
          />
        </div>
      ))}

      <div className="actions">
        <button
          type="button"
          onClick={() => {
            run(addSpouse(xref));
          }}
        >
          {t('person.addPartner')}
        </button>
        <button
          type="button"
          disabled={(person.familiesAsChild ?? []).length > 0}
          title={
            (person.familiesAsChild ?? []).length > 0
              ? t('person.addParents.disabled')
              : undefined
          }
          onClick={() => {
            run(addParents(xref));
          }}
        >
          {t('person.addParents')}
        </button>
        {families.map((family) => (
          <button
            key={family}
            type="button"
            onClick={() => {
              run(addChild(family));
            }}
          >
            {t('person.addChildTo', { xref: displayXref(family) })}
          </button>
        ))}
      </div>

      <div className="actions destructive">
        <button
          type="button"
          onClick={() => {
            // What else goes is stated before it goes, because Delete does not say it.
            const asked =
              links === 0
                ? t('person.deleteConfirm', { name: displayName(person) })
                : t('person.deleteConfirmLinked', {
                    name: displayName(person),
                    count: links,
                  });
            if (globalThis.confirm(asked)) {
              run(deletePerson(xref));
            }
          }}
        >
          {t('person.delete')}
        </button>
      </div>

      <Related doc={doc} person={person} onSelect={onSelect} />
    </div>
  );
}

/** The families this record is in, as a way of walking the tree from the panel. */
function Related({
  doc,
  person,
  onSelect,
}: {
  readonly doc: GedcomDoc;
  readonly person: Individual;
  readonly onSelect: (xref: Xref) => void;
}) {
  /* Before the early return: a hook has to run on every render of a component, and this one
     returns nothing when the person is in no family. */
  const t = useT();
  const families = doc.families.filter(
    (family) =>
      (person.familiesAsSpouse ?? []).some((link) => link.xref === family.xref) ||
      (person.familiesAsChild ?? []).some((link) => link.xref === family.xref),
  );
  if (families.length === 0) return null;
  const nameOfXref = (who: Xref | undefined): string => {
    if (who === undefined) return '';
    const found = doc.individuals.find((one) => one.xref === who);
    return found === undefined ? displayXref(who) : displayName(found);
  };

  return (
    <div className="related">
      <h3>{t('person.inFamilies')}</h3>
      {families.map((family) => (
        <div key={family.xref}>
          <p className="family-of">
            {displayXref(family.xref)}: {nameOfXref(family.husband) || '—'} and{' '}
            {nameOfXref(family.wife) || '—'}
          </p>
          <ul>
            {(family.children ?? []).map((child) => (
              <li key={child}>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onSelect(child);
                  }}
                >
                  {nameOfXref(child)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
