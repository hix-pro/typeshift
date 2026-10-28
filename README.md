# TypeShift

**Read a TypeScript declaration diff. Decide the semver bump.**

[![CI](https://github.com/hix-pro/typeshift/actions/workflows/ci.yml/badge.svg)](https://github.com/hix-pro/typeshift/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/hix-pro/typeshift)](https://github.com/hix-pro/typeshift/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](https://nodejs.org/)

TypeShift compares two versions of a TypeScript package's public declarations and
reports what changed, whether each change can break consumers, and whether the
version bump is large enough. It is a local CLI: no upload, no GitHub token, and
no TypeScript project setup.

```console
$ typeshift compare examples/v1 examples/v2 --fail-on-breaking
TypeShift 0.1.0 API compatibility report

Old: examples/v1 (2 declaration files)
New: examples/v2 (2 declaration files)
Exports: 8 -> 9  |  9 breaking  |  7 compatible

BREAKING (9)
  ✖ Export removed: LegacyOptions
      Export "LegacyOptions" was removed.
  ✖ Enum member removed: LogLevel.Debug
      Enum member "LogLevel.Debug" was removed.
  ✖ Enum value changed: LogLevel.Error
      Enum member "LogLevel.Error" changed value from "error" to "fatal".
  ✖ Member became required: User.email
      Property "email" changed from optional to required.
  ✖ Readonly modifier added: User.id
      Readonly modifier added to property "User.id".
  ✖ Member type changed (review): User.role
      Type of property "User.role" changed from `"admin" | "member"` to `"admin" | "member" |
      "guest"`; assignability was not proven.
  ✖ Type changed (review): UserId
      Type of type "UserId" changed from `string | number` to `string | number | bigint`;
      assignability was not proven.
  ✖ Return type changed (review): format (overload 2).return
      Return type changed from `string` to `number`; assignability was not proven.
  ✖ Parameter became required: greet(punctuation)
      Parameter "punctuation" changed from optional to required.

COMPATIBLE (7)
  + Member added: ApiClient.cancel
      Method "cancel" was added.
  + Optional parameter added: ApiClient.constructor(region)
      Parameter "region" was added and is optional.
  + Optional parameter added: ApiClient.static.create(options)
      Parameter "options" was added and is optional.
  + Enum member added: LogLevel.Warn
      Enum member "LogLevel.Warn" was added with value "warn".
  + Export added: NewLegacyOptions
      Export "NewLegacyOptions" was added.
  + Member added: User.avatar
      Property "avatar" was added.
  + Export added: createUser
      Export "createUser" was added.

Recommended bump: major
--fail-on-breaking is active; this run exits with code 2.
```

The report above is the complete stdout from the bundled example; the `$` line
shows the command. The test suite checks its documented summary and the `2` exit
code against those files.

## Why

`tsc` tells you whether the new source compiles. It does not tell you that
`email?: string` became required, that `LogLevel.Error` changed from `"error"` to
`"fatal"`, or that removing a public constructor is a major release. Those are
API compatibility questions, and they belong in the release decision.

TypeShift reads the `.d.ts` files consumers actually see, compares them
structurally, and gives you a rule-level explanation for every finding.

## Features

- **Three input styles** — a declaration file, a directory (using
  `package.json` `types`/`typings`/`exports` when present), or
  `npm:pkg@version` downloaded with `npm pack --ignore-scripts`.
- **Structural comparison** — exports, functions and overloads, classes,
  interfaces, type literals, constructors, call/construct/index signatures,
  enums, variables, heritage clauses, type parameters, readonly and optional
  modifiers.
- **Semver advice** — `major` when anything is breaking, `minor` for
  compatible-only changes, and `none` when the API is unchanged.
- **Version gate** — pass `--from` and `--to` to validate the bump you are about
  to publish, including prerelease and downgrade rules.
- **Four reports** — readable terminal output, a stable JSON schema, Markdown
  for a pull request or release note, and SARIF for code scanning.
- **Honest uncertainty** — type-text changes are marked **review** instead of
  claiming that TypeScript assignability was proven.
- **CI-friendly exit codes** — `0` success, `1` usage/source/semver error,
  `2` breaking changes under `--fail-on-breaking`.

## Install

TypeShift is not published to the npm registry. Build it from source:

```sh
git clone https://github.com/hix-pro/typeshift.git
cd typeshift
npm ci
npm run build
npm link          # optional: makes `typeshift` available on PATH
```

Without `npm link`:

```sh
node dist/cli.js compare old/ new/
```

Requires **Node.js 20 or newer**. The npm source mode also needs `npm` and `tar`
on `PATH`.

## Quick start

```sh
# Compare two declaration directories
typeshift compare ./types/v1 ./types/v2

# Compare one file from each release
typeshift compare ./v1/index.d.ts ./v2/index.d.ts

# Compare two published versions
typeshift compare npm:zod@3.24.4 npm:zod@3.25.76

# Machine-readable report
typeshift compare ./old ./new --json > api-report.json

# PR comment
typeshift compare ./old ./new --markdown > api-report.md

# Fail CI when the release is breaking
typeshift compare ./old ./new --fail-on-breaking

# Also verify the version number
typeshift compare ./old ./new --from 1.4.0 --to 2.0.0 --fail-on-breaking
```

Run the bundled demo:

```sh
npm run demo
```

## Inputs

| Source | What happens |
| --- | --- |
| `./types/v1` | Reads `package.json` `types`, `typings`, or a compatible `exports` target; otherwise `index.d.*`; otherwise every declaration file in the directory. |
| `./v1/index.d.ts` | Loads that file and every declaration file it reaches through imports and re-exports. |
| `npm:zod@3.25.76` | Downloads the package tarball into a temporary directory, reads its type entry, and deletes the directory on exit. `--ignore-scripts` is always set. |

Supported declaration extensions are `.d.ts`, `.d.mts`, and `.d.cts`.
`node_modules` and VCS directories are skipped when scanning a directory.
Only explicit versions or tags are accepted for `npm:` sources, so a bare package
name cannot silently select the default tag. Tags such as `latest` are still
mutable; pin an exact version in CI for reproducible comparisons.

## Options

| Option | Description |
| --- | --- |
| `--json` | Write the stable JSON report to stdout. Cannot be combined with `--markdown` or `--sarif`. |
| `--markdown` | Write a Markdown report with summary and change tables. |
| `--sarif` | Write a SARIF 2.1.0 report for GitHub code scanning. |
| `--fail-on-breaking` | Exit `2` when at least one breaking change is found. |
| `--from <version>` | Currently published version; requires `--to`. |
| `--to <version>` | Intended release version; validated against the recommendation. |
| `-h, --help` | Show command help. |
| `-V, --version` | Show the TypeShift version. |

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Report written; no gating failure. |
| `1` | Usage error, unreadable input, parse error, invalid version, version downgrade, or a semver mismatch. |
| `2` | `--fail-on-breaking` was set and at least one breaking change was found. |

A semver mismatch takes precedence over `--fail-on-breaking`: a release that
uses `1.5.0` for a breaking change exits `1`, not `2`. This distinguishes "your
version is wrong" from "your version is right, but the change is breaking".

Without `--fail-on-breaking`, breaking changes still exit `0`, so TypeShift can
be used as a report-only review tool before a team turns on gating.

## How the bump is decided

| Comparison result | Recommended bump |
| --- | --- |
| Any breaking change | `major` |
| Compatible changes only | `minor` |
| No declaration changes | `none` |

`none` means no release is required; a patch (or larger) release is still
accepted when the API is unchanged, because docs or runtime behavior may have
changed.

TypeShift always recommends `major` for a breaking change, including on `0.x`
versions. That is deliberately stricter than the semver specification, which
permits breaking changes in a `0.x` minor release. If your project uses the
`0.x` convention, treat the recommendation as "this needs a deliberate,
breaking-change release" rather than an instruction to publish `1.0.0`.

`--from`/`--to` validates the actual bump against that recommendation. A larger
bump is accepted; a smaller one fails. A prerelease-only move such as
`1.4.0-rc.1` to `1.4.0-rc.2` counts as a `prerelease` bump and is considered
smaller than a patch.

## What it compares

| Area | Changes reported |
| --- | --- |
| Exports | Added, removed, kind changed (`class` to `interface`, etc.), class became abstract or concrete |
| Functions | Required/optional parameter added, parameter removed, optionality changed, type changed (review), rest changed, return type changed (review), type parameters changed (review), overload added/removed |
| Classes | Public members added/removed, method vs property, optionality, readonly, member type, constructor added/removed/changed, heritage, call/construct signatures |
| Interfaces and object types | Members, call signatures, construct signatures, index signatures, heritage |
| Enums | Member added/removed, value changed, implicit numeric values resolved |
| Variables and type aliases | Type text changed (review), type parameters changed (review) |

Additions are generally compatible, removals and changed semantics are
breaking. Interface and class **public** members are compared; `private`,
`protected`, and ECMAScript `#private` members are ignored. Files are normalized
before comparison, so whitespace and line wrapping do not create noise.

### Type changes are flagged, not proven

TypeShift is a syntax-level tool. When two type texts differ, it reports a
breaking change marked `(review)` with the before and after text. It does not run
the TypeScript assignability checker and does not claim to prove that a change is
safe or unsafe. A change such as `string` to `string | number` is reported for a
human to judge. This is intentional: a false "safe" is worse than a finding that
asks for review.

Overloads are matched by exact signature first, then remaining signatures are
paired in order. That keeps ordinary edits stable, but a heavily reordered
overload set can produce more than one finding for the same conceptual change.

## JSON report

`--json` writes one stable object to stdout. Diagnostics go to stderr, so the
output can be piped directly into `jq` or saved as an artifact.

```json
{
  "schemaVersion": 1,
  "tool": { "name": "typeshift", "version": "0.1.0" },
  "old": { "source": "examples/v1", "files": ["index.d.ts", "legacy.d.ts"] },
  "new": { "source": "examples/v2", "files": ["index.d.ts", "next.d.ts"] },
  "summary": {
    "breaking": 9,
    "compatible": 7,
    "total": 16,
    "oldExports": 8,
    "newExports": 9,
    "recommendedBump": "major"
  },
  "changes": [
    {
      "severity": "breaking",
      "rule": "export-removed",
      "label": "Export removed",
      "path": "LegacyOptions",
      "message": "Export \"LegacyOptions\" was removed.",
      "review": false,
      "before": "interface",
      "after": null,
      "file": "examples/v1/legacy.d.ts"
    }
  ],
  "semver": null
}
```

Changes are ordered with every breaking change first, then by path, rule, and
message. The order is deterministic across runs. `semver` is `null` unless both
`--from` and `--to` are supplied. `file` is the declaration file that owns the
changed export, relative to the repository; it is omitted for npm sources
because their declarations live outside the checkout.

## SARIF output

`--sarif` emits [SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html) for GitHub code scanning and other SARIF consumers:

```sh
typeshift compare ./types/v1 ./types/v2 --sarif > typeshift.sarif
```

Every change rule gets a stable identifier (`typeshift/export-removed`, `typeshift/member-became-required`, and so on). Levels follow the same model as the rest of the tool:

| Change | Level |
| --- | --- |
| Breaking | `error` |
| Breaking, marked for review | `warning` |
| Compatible | `note` |

Results point at the declaration file that owns the changed export, so pull requests annotate the file that needs attention. The exact line is not tracked; the annotation is file-level. For `npm:` sources there is no repository file, so the artifact location falls back to the package source and the alert is not attached to a line.

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 20
  - run: npm ci && npm run build
  - run: >
      node dist/cli.js compare npm:your-package@1.4.0 ./dist
      --from 1.4.0 --to 2.0.0 --fail-on-breaking --sarif > typeshift.sarif
  - uses: github/codeql-action/upload-sarif@v3
    if: always()
    with:
      sarif_file: typeshift.sarif
      category: typeshift
```

`--sarif` cannot be combined with `--json` or `--markdown`.

## Use in CI

Run TypeShift after building the package, comparing the published declaration
surface with the working tree:

```yaml
name: API compatibility

on:
  pull_request:

jobs:
  compare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Compare published API with this build
        run: >
          node dist/cli.js compare
          npm:your-package@1.4.0
          ./dist
          --from 1.4.0
          --to 2.0.0
          --fail-on-breaking
```

Replace the package name and versions. The step exits `2` when a breaking change
is present and `1` when the planned version is too small. This repository's own
workflow, including the test matrix, is in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### Composite action

The repository ships a composite action that builds TypeShift, runs the comparison, uploads SARIF, and preserves the comparison exit code:

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v4
  - run: npm ci && npm run build
  - uses: hix-pro/typeshift@main # pin the next release tag once it is published
    with:
      old: npm:your-package@1.4.0
      new: ./dist
      from: 1.4.0
      to: 2.0.0
      fail-on-breaking: true
```

The action is available from `main` until the next tagged release; pin the tag after it is published. Inputs: `old` and `new` (required), `fail-on-breaking` (default `false`), `from` and `to`, `args` for extra CLI flags, `sarif` (default `true`), and `category` (default `typeshift`). With `sarif: true`, the action writes and uploads a report and then re-exits with the comparison code. The caller needs `security-events: write` for the upload.

## Examples

[`examples/v1`](examples/v1) and [`examples/v2`](examples/v2) are two versions of
a small fictional package. They cover interface members, overloads, a class, an
enum, a type alias, a re-export, and a new export. [`examples/README.md`](examples/README.md)
shows the demo commands, including JSON, Markdown, and the failing version gate.

## How it works

```text
source argument
      │  src/load.ts          resolve files, package entries, npm tarballs
      ▼
declaration files
      │  src/surface.ts       ts-morph + TypeScript checker: exports -> normalized API
      ▼
ApiSurface
      │  src/compare.ts       directional rules, severity, before/after
      ▼
ComparisonResult
      │  src/report.ts        human, JSON, Markdown
      ▼
stdout + exit code
```

`load.ts` creates a ts-morph project with `skipAddingFilesFromTsConfig`, adds the
entry file(s), and lets TypeScript resolve imports and re-exports. `surface.ts`
uses `getExportedDeclarations()` so aliases and `export *` resolve to the names
consumers see. `compare.ts` is pure: it takes two `ApiSurface` values and returns
changes, with no file system or process access. `report.ts` renders only.

## Project layout

```text
src/
  cli.ts        Commander wiring, input validation, exit codes
  load.ts       declaration discovery, package entries, npm: sources
  surface.ts    normalized API surface from ts-morph
  compare.ts    directional comparison rules
  semver.ts     bump classification and validation
  report.ts     terminal, JSON, and Markdown renderers
  types.ts      data model, rule labels, severities
tests/
  cli.test.ts   child-process tests for output and exit codes
  compare.test.ts
  semver.test.ts
  fixtures/     declaration fixtures for every rule family
examples/       the demo package shown in this README
```

## Development

```sh
npm ci
npm test          # builds dist/, then runs 104 Vitest tests
npm run typecheck
npm run build
npm run check     # tests + typecheck
```

The CLI tests run the compiled `dist/cli.js` in a child process, so they exercise
the same entry point users run. Unit tests import the TypeScript sources
directly.

## Limitations

- **Not a type checker.** Type text changes are reported for review; full
  TypeScript assignability is not evaluated.
- **Declarations only.** TypeShift compares `.d.ts`, `.d.mts`, and `.d.cts` files.
  It does not infer declarations from `.ts` source.
- **Public surface only.** Protected members are not compared, even though they
  matter to subclasses. Namespace internals and CommonJS `export =` bodies are
  treated as opaque or ignored.
- **Abstract member effects.** Class-level abstractness is compared. Adding an
  abstract method to an already abstract class is treated as a compatible member
  addition, although it can force subclasses to change.
- **Static analysis only.** Runtime behavior, JSDoc, deprecation tags, emitted
  JavaScript, and `package.json` metadata are out of scope.
- **Overload pairing is heuristic.** Exact signatures are matched first; edits
  can produce multiple findings.
- **`npm:` sources download code metadata.** The tarball is extracted with
  `--ignore-scripts` and removed afterwards, but it is still third-party content.
  Pin versions in CI.
- **No configuration file.** Rules, severities, and bump policy are fixed. Use
  the JSON report if you need custom policy on top.
- **Windows npm sources** need `tar` on `PATH` (included with modern Windows and
  Git Bash).

## Related tools

| Tool | What it does |
| --- | --- |
| [EnvAudit](https://github.com/hix-pro/env-audit) | find missing, undocumented, and unused environment variables |
| [Migration Guard](https://github.com/hix-pro/migration-guard) | statically catch dangerous SQL migrations before they run |
| [API Watch](https://github.com/hix-pro/api-watch) | catch breaking changes in your OpenAPI and JSON contracts |
| [RepoRace](https://github.com/hix-pro/reporace) | see which GitHub repositories are accelerating |
| [ActionLens](https://github.com/hix-pro/action-lens) | see what a GitHub Actions workflow really does, before it hits main |
| [ComposeMap](https://github.com/hix-pro/compose-map) | understand your Docker Compose stack and its production risks at a glance |
| [OpenCode Telegram](https://github.com/hix-pro/opencode-telegram) | control a local OpenCode server from Telegram |
---

_Part of the **[hix tools](https://github.com/hix-pro#readme)** suite — local-first, no backend, CI-ready._

## License

[MIT](LICENSE) © hix-pro

Third-party dependencies and licenses are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
