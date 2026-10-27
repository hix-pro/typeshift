import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ReportData } from "../src/types";
import { FIXTURES, ROOT, runCli } from "./helpers";

const PACKAGE_VERSION = (
  JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    version: string;
  }
).version;

function fixture(...parts: string[]): string {
  return resolve(FIXTURES, ...parts);
}

function compareArgs(name: string, ...options: string[]): string[] {
  return [
    "compare",
    fixture(name, "v1"),
    fixture(name, "v2"),
    ...options,
  ];
}

describe("CLI human output and exit codes", () => {
  it("exits 0 for breaking changes by default and recommends major", async () => {
    const result = await runCli(compareArgs("functions"));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain(`TypeShift ${PACKAGE_VERSION} API compatibility report`);
    expect(result.stdout).toContain("9 breaking");
    expect(result.stdout).toContain("4 compatible");
    expect(result.stdout).toContain("BREAKING (9)");
    expect(result.stdout).toContain("COMPATIBLE (4)");
    expect(result.stdout).toContain("Recommended bump: major");
    expect(result.stdout).toContain(
      "Hint: re-run with --fail-on-breaking to fail CI when breaking changes are found.",
    );
    expect(result.stdout).not.toContain("Semver check:");
  });

  it("exits 2 for breaking changes with --fail-on-breaking", async () => {
    const result = await runCli(compareArgs("functions", "--fail-on-breaking"));
    expect(result.status).toBe(2);
    expect(result.stdout).toContain(
      "--fail-on-breaking is active; this run exits with code 2.",
    );
  });

  it("exits 0 for compatible-only changes with --fail-on-breaking", async () => {
    const result = await runCli(compareArgs("compatible", "--fail-on-breaking"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 breaking");
    expect(result.stdout).toContain("Recommended bump: minor");
    expect(result.stdout).not.toContain("--fail-on-breaking is active");
  });

  it("exits 0 and reports no bump for an unchanged API", async () => {
    const result = await runCli(
      compareArgs("unchanged", "--fail-on-breaking"),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No API changes detected.");
    expect(result.stdout).toContain("Recommended bump: none");
  });

  it("exits 2 when a matching semver bump and --fail-on-breaking meet", async () => {
    const result = await runCli(
      compareArgs(
        "functions",
        "--from",
        "1.4.0",
        "--to",
        "2.0.0",
        "--fail-on-breaking",
      ),
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Semver check:");
    expect(result.stdout).toContain("satisfies the recommended major bump. OK");
  });

  it("exits 1 when the actual bump is too small", async () => {
    const result = await runCli(
      compareArgs("functions", "--from", "1.4.0", "--to", "1.5.0"),
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("MISMATCH");
    expect(result.stdout).toContain(
      "is lower than the recommended major bump",
    );
  });

  it("lets the semver mismatch take precedence over --fail-on-breaking", async () => {
    const result = await runCli(
      compareArgs(
        "functions",
        "--from",
        "1.4.0",
        "--to",
        "1.5.0",
        "--fail-on-breaking",
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      "the semver mismatch determines exit code 1",
    );
  });

  it("accepts a patch for an unchanged API", async () => {
    const result = await runCli(
      compareArgs("unchanged", "--from", "1.4.0", "--to", "1.4.1"),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "No API changes; the patch bump (1.4.0 -> 1.4.1) is acceptable. OK",
    );
  });
});

describe("CLI JSON output", () => {
  it("emits a stable schema, ordering, and null semver", async () => {
    const args = compareArgs("functions", "--json");
    const first = await runCli(args);

    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).not.toContain("\u001b[");

    const report = JSON.parse(first.stdout) as ReportData;
    expect(Object.keys(report)).toEqual([
      "schemaVersion",
      "tool",
      "old",
      "new",
      "summary",
      "changes",
      "semver",
    ]);
    expect(report.schemaVersion).toBe(1);
    expect(report.tool).toEqual({ name: "typeshift", version: PACKAGE_VERSION });
    expect(report.old.source).toBe(fixture("functions", "v1"));
    expect(report.old.files).toEqual(["index.d.ts"]);
    expect(report.new.files).toEqual(["index.d.ts"]);
    expect(report.summary).toEqual({
      breaking: 9,
      compatible: 4,
      total: 13,
      oldExports: 14,
      newExports: 14,
      recommendedBump: "major",
    });
    expect(report.changes).toHaveLength(13);
    expect(report.semver).toBeNull();

    expect(Object.keys(report.changes[0] as object)).toEqual([
      "severity",
      "rule",
      "label",
      "path",
      "message",
      "review",
      "before",
      "after",
    ]);
    expect(report.changes[0]).toEqual({
      severity: "breaking",
      rule: "function-parameter-added-required",
      label: "Required parameter added",
      path: "add(c)",
      message: 'Parameter "c" was added and is required.',
      review: false,
      before: null,
      after: "c: number",
    });

    const severities = report.changes.map((change) => change.severity);
    expect(severities.indexOf("compatible")).toBe(9);
    expect(severities.slice(0, 9)).toEqual(Array(9).fill("breaking"));
  });

  it("includes semver validation in JSON", async () => {
    const result = await runCli(
      compareArgs(
        "compatible",
        "--json",
        "--from",
        "1.4.0",
        "--to",
        "1.5.0",
      ),
    );
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as ReportData;
    expect(report.semver).toEqual({
      from: "1.4.0",
      to: "1.5.0",
      actualBump: "minor",
      recommendedBump: "minor",
      ok: true,
      message:
        "Version bump minor (1.4.0 -> 1.5.0) satisfies the recommended minor bump.",
    });
  });

  it("keeps JSON parseable when the version check fails", async () => {
    const result = await runCli(
      compareArgs("functions", "--json", "--from", "1.4.0", "--to", "1.5.0"),
    );
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout) as ReportData;
    expect(report.semver).toMatchObject({
      actualBump: "minor",
      recommendedBump: "major",
      ok: false,
    });
  });
});

describe("CLI Markdown output", () => {
  it("renders summary tables and escaped change tables", async () => {
    const result = await runCli(compareArgs("interfaces", "--markdown"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# TypeShift API compatibility report");
    expect(result.stdout).toContain("| Breaking | 8 |");
    expect(result.stdout).toContain("| Compatible | 7 |");
    expect(result.stdout).toContain("| Recommended bump | `major` |");
    expect(result.stdout).toContain("## Breaking changes (8)");
    expect(result.stdout).toContain("## Compatible changes (7)");
    expect(result.stdout).toContain(
      "| Member added | `Account.avatar` | Property \"avatar\" was added. |",
    );
    expect(result.stdout).toContain(
      '`"admin" \\| "user"`',
    );
    expect(result.stdout).not.toContain("Semver validation");
  });

  it("renders semver validation in Markdown", async () => {
    const result = await runCli(
      compareArgs("functions", "--markdown", "--from", "1.4.0", "--to", "1.5.0"),
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("## Semver validation");
    expect(result.stdout).toContain(
      "`1.4.0` -> `1.5.0` · actual `minor` · recommended `major` · **MISMATCH**",
    );
  });

  it("renders the unchanged state", async () => {
    const result = await runCli(compareArgs("unchanged", "--markdown"));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("No API changes detected.");
    expect(result.stdout).toContain("| Recommended bump | `none` |");
  });
});

describe("CLI help and usage errors", () => {
  it("prints help for the root command", async () => {
    const result = await runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: typeshift [options] [command]");
    expect(result.stdout).toContain("compare");
    expect(result.stdout).toContain(
      "Compare TypeScript declaration APIs and recommend a semantic version bump.",
    );
  });

  it("documents compare options, arguments, and examples", async () => {
    const result = await runCli(["compare", "--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: typeshift compare [options] <old> <new>");
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("--markdown");
    expect(result.stdout).toContain("--fail-on-breaking");
    expect(result.stdout).toContain("--from <version>");
    expect(result.stdout).toContain("--to <version>");
    expect(result.stdout).toContain("$ typeshift compare ./types/v1 ./types/v2");
  });

  it("prints the package version", async () => {
    const result = await runCli(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${PACKAGE_VERSION}\n`);
    expect(result.stderr).toBe("");
  });

  it("exits 1 with usage when no command is provided", async () => {
    const result = await runCli([]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: typeshift");
  });

  it("rejects --json with --markdown", async () => {
    const result = await runCli(compareArgs("unchanged", "--json", "--markdown"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--json and --markdown cannot be used together.",
    );
    expect(result.stdout).toBe("");
  });

  it("rejects --from without --to", async () => {
    const result = await runCli(compareArgs("unchanged", "--from", "1.0.0"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "--from and --to must be provided together",
    );
  });

  it("rejects empty version values", async () => {
    const result = await runCli(
      compareArgs("unchanged", "--from", "", "--to", "1.0.0"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--from and --to must not be empty.");
  });

  it("rejects malformed semantic versions", async () => {
    const result = await runCli(
      compareArgs("unchanged", "--from", "1.0", "--to", "1.0.1"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid semantic version");
  });

  it("rejects version downgrades", async () => {
    const result = await runCli(
      compareArgs("unchanged", "--from", "2.0.0", "--to", "1.0.0"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Version downgrades are not a valid");
  });
});

describe("CLI input errors", () => {
  it("reports a missing source", async () => {
    const result = await runCli([
      "compare",
      fixture("does-not-exist"),
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot read");
    expect(result.stderr).toContain("Check that the path exists");
  });

  it("rejects non-declaration files", async () => {
    const result = await runCli([
      "compare",
      resolve(ROOT, "examples", "README.md"),
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not a declaration file");
  });

  it("reports directories without declaration files", async () => {
    const result = await runCli([
      "compare",
      fixture("no-declarations"),
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No declaration files found");
  });

  it("reports declaration parse errors with file positions", async () => {
    const result = await runCli([
      "compare",
      fixture("invalid", "broken.d.ts"),
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed to parse declaration files");
    expect(result.stderr).toMatch(/broken\.d\.ts:\d+:\d+/);
    expect(result.stderr).toContain("TS");
  });

  it("reports parse errors in declaration files outside a file source root", async () => {
    const result = await runCli([
      "compare",
      fixture("external", "entry", "entry.d.ts"),
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed to parse declaration files");
    expect(result.stderr).toMatch(/broken\.d\.ts:\d+:\d+/);
    expect(result.stderr).toContain("TS");
  });

  it("reports parse errors in declaration files outside a directory source root", async () => {
    const result = await runCli([
      "compare",
      fixture("external", "pkg"),
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed to parse declaration files");
    expect(result.stderr).toMatch(/broken\.d\.ts:\d+:\d+/);
    expect(result.stderr).toContain("TS");
  });

  it("rejects npm sources without an explicit version", async () => {
    const result = await runCli([
      "compare",
      "npm:typeshift",
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Include an explicit version or tag");
  });

  it("rejects empty npm sources", async () => {
    const result = await runCli(["compare", "npm:", fixture("unchanged", "v2")]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid npm source");
  });

  it("rejects npm versions with shell metacharacters", async () => {
    const result = await runCli([
      "compare",
      "npm:pkg@1.0.0 & del /q *",
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid npm version or tag");
  });

  it("rejects npm package names with shell metacharacters", async () => {
    const result = await runCli([
      "compare",
      "npm:pkg&whoami@1.0.0",
      fixture("unchanged", "v2"),
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Invalid npm package name");
  });
});

describe("bundled examples", () => {
  const examples = (...segments: string[]): string =>
    resolve(ROOT, "examples", ...segments);

  it("matches the summary documented in the README", async () => {
    const result = await runCli([
      "compare",
      examples("v1"),
      examples("v2"),
      "--json",
      "--from",
      "1.4.0",
      "--to",
      "2.0.0",
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as ReportData;
    expect(report.summary).toEqual({
      breaking: 9,
      compatible: 7,
      total: 16,
      oldExports: 8,
      newExports: 9,
      recommendedBump: "major",
    });
    expect(report.semver).toMatchObject({
      actualBump: "major",
      recommendedBump: "major",
      ok: true,
    });
  });

  it("gates the documented example with exit code 2", async () => {
    const result = await runCli([
      "compare",
      examples("v1"),
      examples("v2"),
      "--fail-on-breaking",
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("9 breaking");
    expect(result.stdout).toContain("Recommended bump: major");
  });
});
