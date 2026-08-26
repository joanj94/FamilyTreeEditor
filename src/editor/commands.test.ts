/**
 * Editing: what a command does, what it refuses, and what undo restores.
 *
 * Two properties carry the weight, and both are asserted over sequences rather than over single
 * cases:
 *
 * 1. **No edit can produce a document that fails either gate.** Not "is reported", not "is
 *    repaired afterwards" -- the state never exists, because `apply` refuses before recording.
 * 2. **Undo restores the previous state exactly.** Whole documents are kept rather than inverse
 *    operations, so this is true by construction; the test is what stops that construction being
 *    quietly replaced by something cleverer.
 *
 * Values here are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  addChild,
  addParents,
  addPerson,
  addSpouse,
  apply,
  attachChild,
  deletePerson,
  deleteUnion,
  detachChild,
  editPerson,
  editUnion,
  setPartnerTo,
  type Command,
} from './commands.js';
import {
  begin,
  canRedo,
  canUndo,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from './history.js';
import { audit, auditErrors } from '../model/audit.js';
import { validateDoc } from '../model/validate.js';
import type { GedcomDoc } from '../model/types.js';

const empty: GedcomDoc = { header: { gedcomVersion: '7.0' }, individuals: [], families: [] };

/** Run a command and insist it was accepted, returning what it produced. */
function accept(history: History, command: Command) {
  const outcome = apply(history, command);
  if (!outcome.ok)
    throw new Error(`expected ${say(command.label)} to apply: ${say(outcome.problem.say)}`);
  return outcome;
}

/** A household: two partners and a child, built the way the editor builds one. */
function household() {
  const one = accept(
    begin(empty),
    addPerson({ sex: 'M', names: [{ value: 'GivenA /SurnameB/' }] }),
  );
  const two = accept(one.history, addSpouse(one.created ?? '', { sex: 'F' }));
  const family = two.history.present.doc.families[0]?.xref ?? '';
  const child = accept(two.history, addChild(family));
  return {
    history: child.history,
    husband: one.created ?? '',
    wife: two.created ?? '',
    child: child.created ?? '',
    family,
  };
}

function sound(doc: GedcomDoc): void {
  const validation = validateDoc(doc);
  expect(validation.ok ? [] : validation.errors).toEqual([]);
  expect(auditErrors(audit(doc))).toEqual([]);
}

describe('applying an edit', () => {
  it('records the new state and leaves the old one reachable', () => {
    const start = begin(empty);
    const after = accept(start, addPerson());
    expect(after.history.present.doc.individuals).toHaveLength(1);
    expect(start.present.doc.individuals).toHaveLength(0);
    expect(canUndo(after.history)).toBe(true);
  });

  it('names the record it created, so the editor can select it', () => {
    const after = accept(begin(empty), addPerson());
    expect(after.created).toMatch(/^@I\d+@$/);
  });

  it('refuses an edit to a record that is not there, and changes nothing', () => {
    const start = begin(empty);
    const outcome = apply(start, editPerson('@I9@', { sex: 'M' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(say(outcome.problem.say)).toContain('@I9@');
    expect(start.present.doc).toBe(empty);
  });

  it('refuses an edit that would make somebody their own ancestor', () => {
    // The operations refuse it; the refusal reaches the user as prose, not as a stack trace.
    const { history, husband, child } = household();
    const second = accept(history, addSpouse(child));
    const family = second.history.present.doc.families[1]?.xref ?? '';
    const outcome = apply(second.history, attachChild(family, husband));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(say(outcome.problem.say)).toMatch(/ancestor|cycle/i);
  });

  it('says what was refused in terms a user can act on', () => {
    const outcome = apply(begin(empty), deleteUnion('@F9@'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(say(outcome.problem.say)).toMatch(/no family @F9@/i);
  });
});

describe('the structural edits', () => {
  it('adds a child on both sides of the link', () => {
    const { history, family, child } = household();
    const doc = history.present.doc;
    expect(doc.families[0]?.children).toContain(child);
    expect(doc.individuals.find((person) => person.xref === child)?.familiesAsChild).toEqual([
      { xref: family },
    ]);
    sound(doc);
  });

  it('adds a partner by creating a union rather than filling a free slot', () => {
    // Two partners in one family would be two marriages recorded as one.
    const { history, husband, wife } = household();
    const doc = history.present.doc;
    expect(doc.families).toHaveLength(1);
    expect(doc.families[0]).toMatchObject({ husband, wife });
  });

  it('gives a person two parents and a family in one step', () => {
    const { history, child } = household();
    const after = accept(history, addParents(child));
    const doc = after.history.present.doc;
    expect(doc.families).toHaveLength(2);
    expect(doc.families[1]?.children).toEqual([child]);
    expect(doc.families[1]?.husband).toBeDefined();
    expect(doc.families[1]?.wife).toBeDefined();
    sound(doc);
  });

  it('undoes an add-parents as one step, not as five', () => {
    // The user asked for parents once; stepping back through half a family is not a state anyone
    // asked for.
    const { history, child } = household();
    const before = history.present.doc;
    const after = accept(history, addParents(child));
    expect(undo(after.history).present.doc).toBe(before);
  });

  it('detaches a child without deleting them', () => {
    const { history, family, child } = household();
    const after = accept(history, detachChild(family, child));
    const doc = after.history.present.doc;
    expect(doc.individuals.map((person) => person.xref)).toContain(child);
    expect(doc.families[0]?.children).toBeUndefined();
    sound(doc);
  });

  it('deletes a person along with every reference to them', () => {
    const { history, husband, family } = household();
    const after = accept(history, deletePerson(husband));
    const doc = after.history.present.doc;
    expect(doc.individuals.map((person) => person.xref)).not.toContain(husband);
    expect(doc.families.find((one) => one.xref === family)?.husband).toBeUndefined();
    sound(doc);
  });

  it('deletes a union and leaves the people', () => {
    const { history, family } = household();
    const after = accept(history, deleteUnion(family));
    expect(after.history.present.doc.families).toEqual([]);
    expect(after.history.present.doc.individuals).toHaveLength(3);
    sound(after.history.present.doc);
  });

  it('empties a partner slot and unlinks the person from that family', () => {
    const { history, family, husband } = household();
    const after = accept(history, setPartnerTo(family, 'HUSB', null));
    const doc = after.history.present.doc;
    expect(doc.families[0]?.husband).toBeUndefined();
    expect(
      doc.individuals.find((person) => person.xref === husband)?.familiesAsSpouse,
    ).toBeUndefined();
    sound(doc);
  });
});

import { ref, type MessageRef } from '../i18n/keys.js';
import { makeTranslate } from '../i18n/catalog.js';
import { EN } from '../i18n/keys.js';

/* These suites assert English prose. The catalog is asked for it explicitly rather than
   through a provider, so a change of default language never silently rewrites them. */
const say = makeTranslate('en', EN);

/** A label that may not exist -- there is nothing to undo at the start of a history. */
const sayMaybe = (label: MessageRef | undefined): string =>
  label === undefined ? '' : say(label);

/** A label an editor would give an edit, carried through the history unchanged. */
const CORRECTION = ref('command.setSex', { name: 'GivenA' });

describe('editing fields', () => {
  it('changes what was named and leaves the rest', () => {
    const { history, husband } = household();
    const after = accept(history, editPerson(husband, { sex: 'X' }, CORRECTION));
    const person = after.history.present.doc.individuals[0];
    expect(person?.sex).toBe('X');
    expect(person?.names?.[0]?.value).toBe('GivenA /SurnameB/');
  });

  it('carries the label the editor gave it, for the undo menu', () => {
    const { history, husband } = household();
    const after = accept(history, editPerson(husband, { sex: 'X' }, CORRECTION));
    /* The reference itself comes back, not a sentence: that is what lets the undo menu be read
       in whatever language is current rather than the one the edit happened in. */
    expect(undoLabel(after.history)).toEqual(CORRECTION);
  });

  it('records a marriage on the union', () => {
    const { history, family } = household();
    const after = accept(
      history,
      editUnion(family, { events: [{ tag: 'MARR', date: { value: '1 JAN 1900' } }] }),
    );
    expect(after.history.present.doc.families[0]?.events?.[0]?.tag).toBe('MARR');
    sound(after.history.present.doc);
  });
});

describe('undo and redo', () => {
  it('restores the previous document exactly, not a copy of it', () => {
    // Identity, not equality: whole states are kept, so undo returns the object it recorded.
    const { history } = household();
    const before = history.present.doc;
    const after = accept(history, addPerson());
    expect(undo(after.history).present.doc).toBe(before);
  });

  it('walks back and forward over the same states', () => {
    const { history } = household();
    const one = accept(history, addPerson());
    const two = accept(one.history, addPerson());

    const back = undo(undo(two.history));
    expect(back.present.doc).toBe(history.present.doc);
    expect(canRedo(back)).toBe(true);

    const forward = redo(redo(back));
    expect(forward.present.doc).toBe(two.history.present.doc);
  });

  it('does nothing at the ends rather than failing', () => {
    const start = begin(empty);
    expect(undo(start)).toBe(start);
    expect(redo(start)).toBe(start);
    expect(canUndo(start)).toBe(false);
  });

  it('offers what it would undo and redo by name', () => {
    const after = accept(begin(empty), addPerson());
    expect(sayMaybe(undoLabel(after.history))).toBe('Add a person');
    expect(sayMaybe(redoLabel(undo(after.history)))).toBe('Add a person');
  });

  it('drops the redo branch once a new edit is made', () => {
    // Keeping it would let redo replace work the user has since done.
    const one = accept(begin(empty), addPerson());
    const two = accept(one.history, addPerson());
    const other = accept(undo(two.history), addPerson({ sex: 'F' }));
    expect(canRedo(other.history)).toBe(false);
  });
});

describe('the invariant every edit holds', () => {
  it('never records a document that fails either gate, whatever the sequence', () => {
    const step = fc.constantFrom(
      'addPerson',
      'addChild',
      'addSpouse',
      'addParents',
      'attachChild',
      'detachChild',
      'setPartner',
      'clearPartner',
      'deletePerson',
      'deleteUnion',
      'undo',
      'redo',
    );

    fc.assert(
      fc.property(
        fc.array(fc.tuple(step, fc.nat(8), fc.nat(8)), { maxLength: 40 }),
        (steps) => {
          let history = begin(empty);
          for (const [operation, a, b] of steps) {
            const doc = history.present.doc;
            const person = doc.individuals[a % Math.max(doc.individuals.length, 1)]?.xref;
            const other = doc.individuals[b % Math.max(doc.individuals.length, 1)]?.xref;
            const family = doc.families[a % Math.max(doc.families.length, 1)]?.xref;

            const command = ((): Command | null => {
              switch (operation) {
                case 'addPerson':
                  return addPerson();
                case 'addChild':
                  return family === undefined ? null : addChild(family);
                case 'addSpouse':
                  return person === undefined ? null : addSpouse(person);
                case 'addParents':
                  return person === undefined ? null : addParents(person);
                case 'attachChild':
                  return family === undefined || other === undefined
                    ? null
                    : attachChild(family, other);
                case 'detachChild':
                  return family === undefined || other === undefined
                    ? null
                    : detachChild(family, other);
                case 'setPartner':
                  return family === undefined || other === undefined
                    ? null
                    : setPartnerTo(family, 'WIFE', other);
                case 'clearPartner':
                  return family === undefined ? null : setPartnerTo(family, 'HUSB', null);
                case 'deletePerson':
                  return person === undefined ? null : deletePerson(person);
                case 'deleteUnion':
                  return family === undefined ? null : deleteUnion(family);
                default:
                  return null;
              }
            })();

            if (operation === 'undo') history = undo(history);
            else if (operation === 'redo') history = redo(history);
            else if (command !== null) {
              const outcome = apply(history, command);
              // A refusal is a legitimate outcome. The point is that what is recorded is sound.
              if (outcome.ok) history = outcome.history;
            }

            sound(history.present.doc);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('returns to the state it started from after undoing every step', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (count) => {
        const start = begin(empty);
        let history = start;
        for (let step = 0; step < count; step += 1) {
          const outcome = apply(history, addPerson());
          if (outcome.ok) history = outcome.history;
        }
        for (let step = 0; step < count; step += 1) history = undo(history);
        expect(history.present.doc).toBe(start.present.doc);
      }),
      { numRuns: 25 },
    );
  });
});
