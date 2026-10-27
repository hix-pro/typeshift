# Examples

`v1/` and `v2/` are two versions of a small fictional package. The v2 surface
contains a mix of breaking and compatible declaration changes, including a
removed export, an enum value change, an overload return-type change, and a
re-export.

From the repository root:

```sh
npm ci
npm run build

# Human report
node dist/cli.js compare examples/v1 examples/v2

# Stable machine-readable report
node dist/cli.js compare examples/v1 examples/v2 --json

# Markdown report for a PR
node dist/cli.js compare examples/v1 examples/v2 --markdown

# Validate the version bump and fail on breaking changes
node dist/cli.js compare examples/v1 examples/v2 \
  --from 1.4.0 --to 2.0.0 --fail-on-breaking
```

The comparison has **9 breaking** and **7 compatible** changes, so the
recommended bump is **major**. Without `--fail-on-breaking` it exits `0`; with
the flag it exits `2`. A version such as `--to 1.5.0` exits `1` because it is
smaller than the recommended major bump.

These files are fixtures, not a published package. They exist to make the tool's
behaviour easy to inspect and are exercised by the test suite and README.
