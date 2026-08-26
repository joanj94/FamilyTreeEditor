/**
 * The tree that came from no file.
 *
 * A document built here never passes through the parser, and it is the only one that does not --
 * so nothing else in the suite would notice if it were malformed. `apply` refuses an edit that
 * would produce an invalid document, which means a bad starting document does not announce itself
 * as a bad starting document: it announces itself as every edit the user tries being refused, for
 * reasons that read as nonsense. Hence both gates are run against it directly here.
 *
 * Values are structural placeholders. No real genealogy data enters this repository.
 */
import { describe, expect, it } from 'vitest';

import { NEW_TREE_NAME, blankTree } from './blank.js';
import { auditErrors, audit } from '../model/audit.js';
import { exportGedcom } from '../gedcom/serialize.js';
import { importGedcom } from '../gedcom/mapper.js';
import { validateDoc } from '../model/validate.js';

describe('starting from nothing', () => {
  it('passes both gates every edit is held to', () => {
    const { doc } = blankTree();
    expect(validateDoc(doc).ok).toBe(true);
    expect(auditErrors(audit(doc))).toEqual([]);
  });

  it('begins with exactly one person and no families', () => {
    // Not zero: every edit here is reached through a record, so an empty chart has nothing to
    // click and no way to grow.
    const { doc, first } = blankTree();
    expect(doc.individuals).toHaveLength(1);
    expect(doc.families).toEqual([]);
    expect(doc.individuals[0]?.xref).toBe(first);
  });

  it('leaves that person unnamed rather than inventing one', () => {
    const person = blankTree().doc.individuals[0];
    expect(person?.names).toBeUndefined();
    expect(person?.sex).toBeUndefined();
  });

  it('declares GEDCOM 7 and names this editor as the source', () => {
    const { header } = blankTree().doc;
    expect(header.gedcomVersion).toBe('7.0');
    expect(header.sourceSystem).toBe('FamilyTreeEditor');
  });

  it('records no origin, because there was no file to have one', () => {
    // `origin` says what a file declared. Inventing a dialect or an encoding for a document that
    // was typed in would be a claim about a file that does not exist.
    expect(blankTree().doc.origin).toBeUndefined();
  });

  it('is named something the user can recognise and rename', () => {
    expect(NEW_TREE_NAME.endsWith('.ged')).toBe(true);
  });
});

describe('what comes out of it', () => {
  it('exports as GEDCOM with nothing left behind', () => {
    const { text, notes } = exportGedcom(blankTree().doc, { dialect: '7.0' });
    expect(notes).toEqual([]);
    expect(text.startsWith('0 HEAD\n')).toBe(true);
    expect(text.endsWith('0 TRLR\n')).toBe(true);
  });

  it('reads back as the document it was, so the file is a real one', () => {
    // The proof that a hand-built document is a GEDCOM document and not merely a shape that
    // typechecks: write it out, read it back, and find the person still there.
    const { text } = exportGedcom(blankTree().doc, { dialect: '7.0' });
    const bytes = new TextEncoder().encode(text);
    const { doc } = importGedcom(bytes, NEW_TREE_NAME);

    expect(doc.individuals).toHaveLength(1);
    expect(doc.families).toEqual([]);
    expect(validateDoc(doc).ok).toBe(true);
  });
});
