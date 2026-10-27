# Contributing to TypeShift

Thanks for helping improve TypeShift! This guide covers what you need to work on
the codebase and get a PR merged.

## Development setup

You need Node.js 22+ (a `.nvmrc` is provided — `nvm use` picks it up):

```bash
git clone https://github.com/hix-pro/typeshift.git
cd typeshift
npm ci
```

## Checks before you push

CI runs the same commands, so run them locally first:

```bash
npm run check
```

Ground rules:

- Keep TypeScript strict; do not loosen compiler options to make an error go away.
- New behavior needs tests; bug fixes need a test that fails before the fix.
- Update the README when you add or change a rule, option, or export.

## Submitting changes

1. Open an issue first for anything bigger than a small fix, so the approach can
   be agreed on before you invest time.
2. Keep PRs focused — one behavior change per PR.
3. Use conventional commit messages (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`);
   they feed the changelog.
4. Fill out the PR template and make sure CI is green.

## Reporting bugs

Open a bug report with steps to reproduce, the version or commit you are on, and
your browser/runtime. Minimal input files that trigger the bug are especially
helpful. For security issues, see [SECURITY.md](SECURITY.md) — please do not open
public issues for those.
