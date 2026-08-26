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
 *
 * **The counts are pluralised rather than concatenated.** "1 people, 1 families" was wrong in
 * English before any of this was translated; `Intl.PluralRules` picks the form, so a language with
 * more than two of them gets the right one without this file knowing which language it is.
 */
import type { ExportDialect } from '../gedcom/serialize.js';
import { LOCALES, type LocaleTag } from '../i18n/catalog.js';
import { useLanguage, useT } from '../i18n/context.js';
import type { MessageKey, MessageRef } from '../i18n/keys.js';
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
  readonly kept: MessageRef;
  /** True where the document on screen differs from the one last written to a file. */
  readonly notWrittenBack: boolean;
  readonly onStep: (direction: 'undo' | 'redo') => void;
  readonly onSave: (format: SaveFormat) => void;
}

/** Each language named in its own language, which is the only name its speakers will look for. */
const LANGUAGE_NAMES: Readonly<Record<LocaleTag, MessageKey>> = {
  en: 'lang.en',
  ca: 'lang.ca',
  es: 'lang.es',
};

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
  const { t, locale, setLocale } = useLanguage();

  /* Built as a list and joined, so a language is free to order the pieces differently and an
     absent count simply does not appear. */
  const summary = [
    t('bar.people', { count: people }),
    t('bar.families', { count: families }),
    ...(opened !== null && opened.issues > 0
      ? [t('bar.importNotes', { count: opened.issues })]
      : []),
    ...(warnings > 0 ? [t('bar.warnings', { count: warnings })] : []),
  ].join(', ');

  return (
    <header className="bar">
      <h1>{t('app.title')}</h1>
      <label className="open">
        <input
          type="file"
          accept=".ged,.gedcom,text/plain"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) onOpen(file);
          }}
        />
        <span>{t('bar.open')}</span>
      </label>

      <label className="language">
        <span>{t('lang.pick')}</span>
        <select
          value={locale}
          onChange={(event) => {
            setLocale(event.target.value as LocaleTag);
          }}
        >
          {LOCALES.map((tag) => (
            <option key={tag} value={tag}>
              {t(LANGUAGE_NAMES[tag])}
            </option>
          ))}
        </select>
      </label>

      {opened === null ? null : (
        <>
          <span className="steps">
            <Step
              label={t('bar.undo')}
              enabled={canUndo(opened.history)}
              says={undoLabel(opened.history)}
              onPress={() => {
                onStep('undo');
              }}
            />
            <Step
              label={t('bar.redo')}
              enabled={canRedo(opened.history)}
              says={redoLabel(opened.history)}
              onPress={() => {
                onStep('redo');
              }}
            />
          </span>
          <span className="saves">
            <button
              type="button"
              title={t('bar.save7.title')}
              onClick={() => {
                onSave('7.0');
              }}
            >
              {t('bar.save7')}
            </button>
            <button
              type="button"
              title={t('bar.save551.title')}
              onClick={() => {
                onSave('5.5.1');
              }}
            >
              {t('bar.save551')}
            </button>
            <button
              type="button"
              title={t('bar.saveJson.title')}
              onClick={() => {
                onSave('json');
              }}
            >
              {t('bar.saveJson')}
            </button>
          </span>
          <p className="loaded">{t('bar.loaded', { name: opened.name, summary })}</p>
          <p className="kept">
            {t(kept)}
            {notWrittenBack ? ` · ${t('bar.notWrittenBack')}` : ''}
          </p>
        </>
      )}
    </header>
  );
}

/**
 * One history button.
 *
 * Its own component because the edit it would reverse is a `MessageRef` that may not exist -- there
 * is nothing to undo at the start -- and `exactOptionalPropertyTypes` will not have `title` set to
 * undefined. Spreading the attribute in or out keeps that decision in one place rather than twice.
 */
function Step({
  label,
  enabled,
  says,
  onPress,
}: {
  readonly label: string;
  readonly enabled: boolean;
  readonly says: MessageRef | undefined;
  readonly onPress: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={!enabled}
      {...(says === undefined ? {} : { title: t(says) })}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
