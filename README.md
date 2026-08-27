# FamilyTreeEditor

A browser-based editor for GEDCOM family trees, including those exported from
**GDS 9.0.28 / Marshall System**.

Open a `.ged` file, see the family drawn correctly, change it, and write it back out.
Free, open source, and entirely client-side.

**[Open the editor](https://joanj94.github.io/FamilyTreeEditor/)** — there is nothing to install:
the page is the whole program.

> **Your file is parsed in your browser and never uploaded.** There is no server, no account and
> no telemetry. Genealogy files describe living people, so this is a design constraint rather
> than a promise made after the fact.
>
> Trees you open are remembered on your own device, in the browser's own database, so that closing
> the tab does not lose an afternoon's work. That copy never leaves the machine either, and
> **Forget** removes it. In a private window, or with site data switched off, the editor still
> works and simply says it is not keeping anything.

## What it does

- **Reads GEDCOM 5.5.1 and 7.** The version is taken from the file's own header, and the two
  dialects differ enough — date grammar, name sub-structures, sex values, how notes attach — that
  each gets its own mapper rather than a shared guess.
- **Decodes the encoding the file declares**, including **ANSEL**, the 1980s library encoding that
  no browser API handles. This is a round-trip requirement, not a display nicety: a character
  mis-decoded on the way in is written back out corrupted on the way out, into the user's own
  file.
- **Keeps what it does not understand.** Tags outside the model are retained verbatim against
  their record, so exporting a file you imported does not silently discard the parts this editor
  has no opinion about.
- **Draws the family as a tidy tree** in SVG — pan, zoom, and fold a branch to collapse it. Unions
  are drawn as their own nodes, so remarriage renders as what it is, numbered in the order the
  marriages happened. A box carries its person's sex, and a dagger where the record gives a death.
  Every box, union and fold control is reachable and operable from the keyboard.
- **Edits persons and unions** through a command stack with undo and redo. Every edit produces a
  new document rather than mutating the old one, and the result stays schema-valid and audit-clean
  or the command does not apply.
- **Remembers what you were working on.** Trees are autosaved into this browser and listed on the
  opening screen. That is not the same as writing your `.ged` back — a web page cannot do that, only
  you can, by taking the file the save buttons hand you — so the two are named differently
  everywhere, and closing the tab with changes you have not written out asks first.
- **Speaks English, Catalan and Spanish.** The language is whichever one the browser asked for
  until the reader picks another, and that choice is remembered. English is always loaded
  underneath, so a translation that has fallen behind shows an English sentence rather than a raw
  key, and only the chosen language is ever downloaded.
- **Writes GEDCOM 7 by default and 5.5.1 on request**, alongside the JSON form of the document —
  which is this project's own encoding, not an interchange format, for the reason set out below.
  `import(export(import(f)))` equals `import(f)` for every fixture, for an edited document, and for
  a few hundred generated ones: a round trip is not allowed to lose anything anyone said about the
  family. Two things are the writer's own and not copied from the document — the version the file
  declares, and the encoding it declares, which is always the encoding actually written. Going back
  to 5.5.1 is a downgrade, and each thing the older version cannot say is reported rather than
  quietly dropped.

Media, sources, notes, places and merge tooling are deliberately outside the scope.

## Getting started

Requires Node >= 20.19 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

### Checks

```bash
pnpm typecheck      # tsc -b across src, tests and vite.config.ts
pnpm lint           # ESLint, including the module layering rules
pnpm format:check   # Prettier, reporting only — `pnpm format` fixes in place
pnpm test           # Vitest
pnpm build          # production bundle into dist/
```

CI runs all five on every pull request, on Node 22. Each step runs even where an earlier one
failed, so a single push reports every problem rather than one per round trip.

## Architecture

```
  .ged file -> lexer -> parse tree -> dialect mapper -> GedcomDoc <-> editor commands
  (5.5.1|7)  (lines)   (level/tag/    (5.5.1 -> 7)     (GEDCOM 7)    (undo/redo stack)
                        xref/value)          |                              |
  .json file ------------ validate (ajv) --> |                              v
                                             |                        TreeRepository
                                             |                        (IndexedDB autosave)
                                             +--> layout() -> ViewModel -> SVG
                                             |
                                             +--> serializer -> .ged (7 | 5.5.1) + .json

  Every sentence the interface shows is a key looked up in i18n/, in en, ca or es.
```

| Module         | Responsibility                                                                  |
| -------------- | ------------------------------------------------------------------------------- |
| `src/gedcom/`  | Lexer, parse tree, 5.5.1 and 7 dialect mappers, serializers, encoding detection |
| `src/model/`   | `GedcomDoc` types, ajv validation, `audit()`, xref allocation, immutable ops    |
| `src/layout/`  | Pure function: document to coordinates. Zero DOM                                |
| `src/render/`  | SVG drawing, pan/zoom, fold, hit-testing. Reads the ViewModel, decides nothing  |
| `src/editor/`  | React UI, command pattern, undo/redo, forms, validation surfacing               |
| `src/storage/` | `TreeRepository` interface + IndexedDB implementation, the backend seam         |
| `src/i18n/`    | Message catalogs, lookup and plurals, language negotiation, the React provider  |

**The layering rules that matter**, all three enforced by `no-restricted-imports` in
[`eslint.config.js`](eslint.config.js) rather than left to review:

- `layout/` may import from `model/` and nothing else — not `render/`, `editor/`, `storage/` or
  `gedcom/`, and not React. It is a pure function from document to coordinates.
- `render/` may not import from `editor/`, and may not reach `model/ops` at all: it reads the
  ViewModel and raises events, and the document is changed by a command or not at all.
- `gedcom/`, `model/` and `storage/` may not import React, `render/` or `editor/`, so each can be
  tested and reused without a UI. They may name a message through `i18n/keys`, but not touch the
  provider that renders it.

Keeping layout free of the DOM is what lets its geometric invariants be asserted as ordinary unit
tests with no browser at all.

## The contract

[`schema/gedcom7.schema.json`](schema/gedcom7.schema.json) is the document model, and it mirrors
[FamilySearch GEDCOM 7.0](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html). Tag names,
enumerations, the cross-reference grammar and the date grammar are the standard's, not this
project's: where GEDCOM says `BIRT`, so does the document; where it allows `SURN` more than once,
so does the document. Nothing sits between the file on disk and the model in memory to translate,
so there is nowhere for a mapping to quietly lose something.

**The JSON encoding is this project's own.** GEDCOM 7 normatively defines two serializations and
neither of them is JSON: the line-based `.ged` stream, and GEDZIP for bundling a dataset with its
media files. So what **Save JSON** writes is the standard's _vocabulary_ — its tags, its
enumerations, its cross-reference and date grammars — arranged in a shape this repository defines
and this schema describes. No other program is expected to read it, and it is not
[GEDCOM X](https://gedcomx.org), which is a separate FamilySearch project with a different data
model that happens to have a JSON form. The `.ged` file is what you hand to other software; the
JSON is this editor's document exactly as it holds it, which makes it the useful one for diffing
an edit, scripting against a tree, or handing the state to something else you wrote.

Four properties are load-bearing:

- **Nothing is discarded.** Structures the model does not describe are kept verbatim in
  `extensions`, whole records in `otherRecords`, in the order they appeared. `NOTE`, `SOUR` and
  `OBJE` are outside this editor's scope, and they still survive a round trip untouched, as does a
  vendor's `_UID`. Losslessness is a property of the schema, not a promise the serializer makes.
- **The payload as written is authoritative.** `date.value` and `name.value` hold what the file
  said; the parsed fields beside them are a reading of it. A date this tool cannot parse is not an
  error — it is `kind: "UNPARSED"` with its payload intact, and it exports byte-identical.
- **A false precision cannot be expressed.** A parsed date carries only the fields it knows, so a
  year-only date has no month and no day. `ABT 1901` has no way of becoming `1901-01-01` — the
  impossibility is structural rather than a rule someone has to remember.
- **Families are records.** A person points at each family they partnered in, rather than carrying
  one set of parent fields that a second marriage would overwrite. Remarriage is expressible
  because the standard made it so.

Mirroring the standard closely also dissolved a problem rather than creating one: two surnames
need no invented field and no convention about which half goes where, because GEDCOM already
expresses them as two `SURN` pieces.

`src/model/types.ts` mirrors the schema in TypeScript, and `tests/schema.test.ts` holds the two
together: an enumeration that gains a member on only one side fails the suite. Since both sides
mirror GEDCOM 7, a divergence between them is usually a divergence from the standard.

## Test data

Public tests run on a synthetic corpus in `tests/fixtures/`, and every name in it is invented.
**Real genealogy files stay out of this repository** — including single records borrowed to make
a fixture look plausible. Genealogy data describes living people, and a fixture committed once
remains in git history after it is deleted, so this is enforced rather than encouraged:
`tests/private/` and `*.private.ged` are git-ignored, and that is where local work against real
files belongs.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The one rule worth repeating here: **no real genealogy
data enters this repository**, down to a single record borrowed to make a fixture look plausible.

## License

[Apache-2.0](LICENSE).
