/**
 * The record panel for a union.
 *
 * A union is a record in its own right, which is what lets a remarriage be drawn as two unions
 * rather than as one couple overwritten -- so it gets a panel of its own rather than being edited
 * through one of the partners.
 *
 * The partner slots are the standard's `HUSB` and `WIFE`. They are role names inherited from
 * earlier versions of GEDCOM and carry no requirement about the people in them, which is why this
 * panel labels them "Partner" and says which tag each one is.
 */
import { useId, useMemo } from 'react';

import { useT } from '../i18n/context.js';
import { ref, type MessageKey } from '../i18n/keys.js';

import {
  addChild,
  deleteUnion,
  detachChild,
  editUnion,
  setPartnerTo,
  type Command,
} from './commands.js';
import { parseDateValue } from '../gedcom/dates.js';
import { ordinal } from '../layout/pack.js';
import { readRelations, unionsOf } from '../layout/relations.js';
import { displayName, displayXref } from '../model/labels.js';
import type { FamilyEventTag, GedcomDoc, Xref } from '../model/types.js';

export interface UnionPanelProps {
  readonly doc: GedcomDoc;
  readonly xref: Xref;
  readonly run: (command: Command) => void;
  readonly onSelect: (xref: Xref) => void;
}

const DATED: readonly { readonly tag: FamilyEventTag; readonly label: MessageKey }[] = [
  { tag: 'MARR', label: 'union.event.MARR' },
  { tag: 'DIV', label: 'union.event.DIV' },
];

export function UnionPanel({ doc, xref, run, onSelect }: UnionPanelProps) {
  const id = useId();
  const t = useT();
  /* The same reading the chart is drawn from, so the number said here is the number drawn there.
     Memoised because it walks the whole document and the panel re-renders on every edit. */
  const relations = useMemo(() => readRelations(doc), [doc]);
  const family = doc.families.find((one) => one.xref === xref);
  if (family === undefined) return <p className="panel-empty">{t('union.gone')}</p>;

  const nameOfXref = (who: Xref | undefined): string => {
    if (who === undefined) return '';
    const found = doc.individuals.find((one) => one.xref === who);
    return found === undefined ? displayXref(who) : displayName(found);
  };

  const children = family.children ?? [];

  /* Which of a partner's marriages this is. Zero where neither of them married more than once,
     and nothing is said in that case -- a number that is always 1 tells a reader nothing. It is
     derived from the order of that partner's unions, never from anything written in the file. */
  const mark = ordinal(xref, relations);
  const remarried = [family.husband, family.wife].find(
    (who) => who !== undefined && unionsOf(relations, who).length > 1,
  );

  const setDate = (tag: FamilyEventTag, written: string): void => {
    const current = family.events?.find((event) => event.tag === tag)?.date?.value ?? '';
    if (written.trim() === current) return;

    const others = (family.events ?? []).filter((event) => event.tag !== tag);
    const events =
      written.trim() === ''
        ? others
        : [...others, { tag, date: parseDateValue(written.trim()) }];
    run(
      editUnion(
        xref,
        { events: events.length === 0 ? undefined : events },
        ref('command.editUnionDate'),
      ),
    );
  };

  return (
    <div className="panel">
      <h2>
        {nameOfXref(family.husband) || t('union.unknownPartner')} and{' '}
        {nameOfXref(family.wife) || t('union.unknownPartner')}
      </h2>
      <p className="xref">{displayXref(xref)}</p>

      {mark === 0 ? null : (
        <p className="marriage-number" title={t('union.marriageNumberTitle')}>
          {remarried === undefined
            ? t('union.marriageNumber', { n: mark })
            : t('union.marriageNumberOf', { n: mark, name: nameOfXref(remarried) })}
        </p>
      )}

      {(['HUSB', 'WIFE'] as const).map((role) => {
        const who = role === 'HUSB' ? family.husband : family.wife;
        return (
          <div className="field" key={role}>
            <span className="label">{t('union.partner', { role })}</span>
            {who === undefined ? (
              <span className="empty">{t('union.nobodyYet')}</span>
            ) : (
              <span className="partner">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onSelect(who);
                  }}
                >
                  {nameOfXref(who)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    run(setPartnerTo(xref, role, null));
                  }}
                >
                  {t('union.remove')}
                </button>
              </span>
            )}
          </div>
        );
      })}

      {DATED.map((event) => (
        <div className="field" key={event.tag}>
          <label htmlFor={`${id}-${event.tag}`}>{t(event.label)}</label>
          <input
            id={`${id}-${event.tag}`}
            key={`${xref}-${event.tag}-${family.events?.find((one) => one.tag === event.tag)?.date?.value ?? ''}`}
            defaultValue={
              family.events?.find((one) => one.tag === event.tag)?.date?.value ?? ''
            }
            placeholder={t('person.datePlaceholder')}
            onBlur={(input) => {
              setDate(event.tag, input.target.value);
            }}
          />
        </div>
      ))}

      <div className="related">
        <h3>{t('union.children')}</h3>
        {children.length === 0 ? (
          <p className="empty">{t('union.noChildren')}</p>
        ) : (
          <ul>
            {children.map((child) => (
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
                <button
                  type="button"
                  title={t('union.detachTitle')}
                  onClick={() => {
                    run(detachChild(xref, child));
                  }}
                >
                  {t('union.detach')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="actions">
        <button
          type="button"
          onClick={() => {
            run(addChild(xref));
          }}
        >
          {t('union.addChild')}
        </button>
      </div>

      <div className="actions destructive">
        <button
          type="button"
          onClick={() => {
            // The people stay; only this union and its links go. Say so.
            const cost =
              children.length === 0
                ? t('union.deleteCostNone')
                : t('union.deleteCostChildren', { count: children.length });
            if (globalThis.confirm(t('union.deleteConfirm', { cost }))) run(deleteUnion(xref));
          }}
        >
          {t('union.delete')}
        </button>
      </div>
    </div>
  );
}
