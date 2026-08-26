# Contributing

Thanks for looking. This is a small project with one hard rule and a few soft ones.

## The hard rule: no real genealogy data

**No real genealogy file, or any part of one, goes into this repository.** Not a whole `.ged`, not
a single record borrowed to make a fixture look plausible, not a real surname used as a placeholder.

Genealogy files describe living people, and a file committed once stays in git history after it is
deleted. This is enforced rather than encouraged: `tests/private/` and `*.private.ged` are
git-ignored, and that is where local work against real files belongs.

Every name in `tests/fixtures/` is invented. When you add a fixture, invent the names in it too —
including the ones that only appear in a comment.

## Getting set up

Requires Node >= 20.19 and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

## Before you open a pull request

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test
```

That is exactly what CI runs. `pnpm format` fixes formatting in place.

## What the tests are for

Two suites carry more weight than the rest, and a change that breaks either needs a very good
reason rather than an updated expectation:

- **`tests/roundtrip.test.ts`** — `import(export(import(f)))` equals `import(f)`. This is the
  promise that opening someone's file and saving it back does not quietly take anything out of it.
  If a change makes it fail, the change is wrong until proven otherwise.
- **`src/layout/oracle.test.ts`** — the layout produces the same coordinates as the Python
  implementation it was ported from. A layout bug impersonates a data bug, which is what made
  these expensive the first time around.

New behaviour comes with tests. Not because of a coverage number, but because the failure modes
here are silent: a dropped tag or a mis-decoded character does not throw, it just quietly changes
somebody's file.

## The layering rule

```
layout/  never imports from render/, editor/, storage/ or gedcom/
render/  never mutates the document
```

This is enforced by `no-restricted-imports` in [`eslint.config.js`](eslint.config.js) rather than
left to review, because a single convenience import is all it takes to lose it and it looks
harmless in a diff. Keeping `layout/` free of the DOM is what lets its geometric invariants be
asserted as ordinary unit tests with no browser at all.

## Style

- **Immutability throughout.** Every type in the model is `readonly`, and edits are pure functions
  returning a new document. This is what makes undo exact rather than approximately correct.
- **Never swallow an error.** A parse problem is reported with the text that was actually there.
  `no-empty` and `@typescript-eslint/only-throw-error` are on for this reason.
- **Comments say why, not what.** The codebase is full of decisions that look arbitrary until you
  know what went wrong without them; if you undo one, the comment is where the reason is.
- Conventional commit subjects (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## Scope

Media, sources, notes, places and merge tooling are deliberately outside the scope of this editor.
They still **survive a round trip untouched** — they are kept verbatim rather than modelled — and
that is the intended treatment, not a gap waiting to be filled.

If you want to propose something larger, open an issue before writing it. It is a better use of
your afternoon than a rejected pull request.

## Reporting a bug in someone's file

Please do not attach the file. Describe the shape of the problem, or reduce it to an invented
example that reproduces the same failure — a handful of records with made-up names is almost
always enough, and it is the only kind of example that can go in a public issue.
