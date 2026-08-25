# FamilyTreeEditor

A browser-based editor for GEDCOM family trees, including those exported from
**GDS 9.0.28 / Marshall System**.

Open a `.ged` file, see the family drawn correctly, change it, and write it back out.
Free, open source, and entirely client-side.

> **Your file is parsed in your browser and never uploaded.** There is no server, no account and
> no telemetry. Genealogy files describe living people, so this is a design constraint rather
> than a promise made after the fact.

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
  are drawn as their own nodes, so remarriage renders as what it is.
- **Edits persons and unions** through a command stack with undo and redo. Every edit produces a
  new document rather than mutating the old one, and the result stays schema-valid and audit-clean
  or the command does not apply.
- **Writes GEDCOM 7 by default and 5.5.1 on request**, alongside the JSON form of the document.
  `import(export(x))` equals `import(x)`: a round trip is not allowed to lose anything.

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
pnpm format         # Prettier, in place
pnpm test           # Vitest
pnpm build          # production bundle into dist/
```

`pnpm typecheck && pnpm lint && pnpm test` is what CI runs on every pull request.

## Architecture

```
  .ged file -> lexer -> parse tree -> dialect mapper -> GedcomDoc <-> editor commands
  (5.5.1|7)  (lines)   (level/tag/    (5.5.1 -> 7)     (GEDCOM 7)    (undo/redo stack)
                        xref/value)          |
  .json file ------------ validate (ajv) --> |
                                             +--> layout() -> ViewModel -> SVG
                                             |
                                             +--> serializer -> .ged (7 | 5.5.1) + .json
```

| Module         | Responsibility                                                                  |
| -------------- | ------------------------------------------------------------------------------- |
| `src/gedcom/`  | Lexer, parse tree, 5.5.1 and 7 dialect mappers, serializers, encoding detection |
| `src/model/`   | `GedcomDoc` types, ajv validation, `audit()`, xref allocation, immutable ops    |
| `src/layout/`  | Pure function: document to coordinates. Zero DOM                                |
| `src/render/`  | SVG drawing, pan/zoom, fold, hit-testing. Reads the ViewModel, decides nothing  |
| `src/editor/`  | React UI, command pattern, undo/redo, forms, validation surfacing               |
| `src/storage/` | `TreeRepository` interface + IndexedDB implementation, the backend seam         |

**The layering rule that matters:** `layout/` never imports from `render/` or `editor/`, and
`render/` never mutates the document. This is enforced by `no-restricted-imports` rules in
[`eslint.config.js`](eslint.config.js), not left to review. Keeping layout free of the DOM is what
lets its geometric invariants be asserted as ordinary unit tests with no browser at all.

## The contract

[`schema/gedcom7.schema.json`](schema/gedcom7.schema.json) is the document model, and it mirrors
[FamilySearch GEDCOM 7.0](https://gedcom.io/specifications/FamilySearchGEDCOMv7.html). Tag names,
enumerations, the cross-reference grammar and the date grammar are the standard's, not this
project's: where GEDCOM says `BIRT`, so does the document; where it allows `SURN` more than once,
so does the document. Nothing sits between the file on disk and the model in memory to translate,
so there is nowhere for a mapping to quietly lose something.

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

## License

[Apache-2.0](LICENSE).
