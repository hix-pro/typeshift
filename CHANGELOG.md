# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial public release.

### Fixed
- Parse errors are no longer silently dropped for declaration files reached
  through imports but stored outside the source root. Both the diagnostics
  scope and the `files` list now follow what the TypeScript module graph
  actually reaches instead of directory containment: a declaration with a
  syntax error outside the root exits `1` with the file named, valid
  outside-root declarations are listed and compared, and `node_modules`
  typings plus the TypeScript built-in libraries stay out of scope.
- `--markdown` output no longer produces invalid CommonMark code spans for
  values containing backticks, such as template-literal types like
  `` `prefix-${string}` ``. Spans now use the N+1 backtick delimiter form.
- `npm:` sources no longer fail on Windows with "npm: sources require npm on
  PATH". Node's CVE-2024-27980 hardening rejects spawning `npm.cmd` without a
  shell, so Windows now runs it through one; the npm spec charset already
  excludes spaces and shell metacharacters.
