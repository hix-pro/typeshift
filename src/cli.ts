#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

import { Command } from "commander";

import { compareSurfaces } from "./compare";
import {
  loadSource,
  SourceError,
  type LoadedSource,
} from "./load";
import {
  formatHuman,
  formatJson,
  formatMarkdown,
} from "./report";
import { formatSarif } from "./sarif";
import { checkSemverBump, classifyBump, VersionError } from "./semver";
import { buildSurface } from "./surface";
import type { ReportData } from "./types";

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

interface CompareOptions {
  json?: boolean;
  markdown?: boolean;
  sarif?: boolean;
  failOnBreaking?: boolean;
  from?: string;
  to?: string;
}

const VERSION = readPackageVersion();

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("typeshift")
    .description(
      "Compare TypeScript declaration APIs and recommend a semantic version bump.",
    )
    .version(VERSION, "-V, --version", "print the TypeShift version")
    .showHelpAfterError();

  program
    .command("compare")
    .description("Compare two TypeScript package API surfaces")
    .argument(
      "<old>",
      "old .d.ts file, directory, or npm:pkg@version source",
    )
    .argument(
      "<new>",
      "new .d.ts file, directory, or npm:pkg@version source",
    )
    .option("--json", "print a stable JSON report")
    .option("--markdown", "print a Markdown report for a PR or release note")
    .option("--sarif", "print a SARIF 2.1.0 report for GitHub code scanning")
    .option(
      "--fail-on-breaking",
      "exit with code 2 when breaking changes are found",
    )
    .option(
      "--from <version>",
      "currently published version, used with --to to validate the actual bump",
    )
    .option(
      "--to <version>",
      "release version, used with --from to validate the actual bump",
    )
    .addHelpText(
      "after",
      `
Examples:
  $ typeshift compare ./types/v1 ./types/v2
  $ typeshift compare npm:my-lib@1.2.0 npm:my-lib@1.3.0 --json
  $ typeshift compare ./old.d.ts ./new.d.ts --from 1.2.0 --to 2.0.0 --fail-on-breaking`,
    )
    .action(
      (
        oldSource: string,
        newSource: string,
        options: CompareOptions,
      ): void => {
        runCompare(oldSource, newSource, options);
      },
    );

  program.addHelpText(
    "after",
    `
Run "typeshift compare --help" for comparison options and examples.`,
  );

  return program;
}

function runCompare(
  oldSource: string,
  newSource: string,
  options: CompareOptions,
): void {
  if (
    [options.json, options.markdown, options.sarif].filter(Boolean).length > 1
  ) {
    throw new UsageError(
      "--json, --markdown, and --sarif cannot be used together.",
    );
  }

  const hasFrom = options.from !== undefined;
  const hasTo = options.to !== undefined;
  if (hasFrom !== hasTo) {
    throw new UsageError(
      "--from and --to must be provided together to validate a version bump.",
    );
  }
  if (hasFrom && (options.from?.trim() === "" || options.to?.trim() === "")) {
    throw new UsageError("--from and --to must not be empty.");
  }
  if (options.from !== undefined && options.to !== undefined) {
    // Validate the version pair before reading sources so bad flags fail fast.
    classifyBump(options.from, options.to);
  }

  let oldLoaded: LoadedSource | undefined;
  let newLoaded: LoadedSource | undefined;

  try {
    oldLoaded = loadSource(oldSource);
    newLoaded = loadSource(newSource);

    const oldSurface = buildSurface(oldLoaded);
    const newSurface = buildSurface(newLoaded);
    const comparison = compareSurfaces(oldSurface, newSurface);

    const semver =
      options.from !== undefined && options.to !== undefined
        ? checkSemverBump(
            options.from,
            options.to,
            comparison.summary.recommendedBump,
          )
        : null;

    const report: ReportData = {
      schemaVersion: 1,
      tool: {
        name: "typeshift",
        version: VERSION,
      },
      old: {
        source: oldSource,
        files: oldLoaded.files,
      },
      new: {
        source: newSource,
        files: newLoaded.files,
      },
      summary: comparison.summary,
      changes: comparison.changes.map(repoRelativeChange),
      semver,
    };

    const output =
      options.json === true
        ? formatJson(report)
        : options.markdown === true
          ? formatMarkdown(report)
          : options.sarif === true
            ? formatSarif(report)
            : formatHuman(report, {
                failOnBreaking: options.failOnBreaking === true,
              });
    process.stdout.write(output);

    if (semver !== null && !semver.ok) {
      process.exitCode = 1;
    } else if (
      options.failOnBreaking === true &&
      comparison.summary.breaking > 0
    ) {
      process.exitCode = 2;
    } else {
      process.exitCode = 0;
    }
  } finally {
    newLoaded?.cleanup();
    oldLoaded?.cleanup();
  }
}

export function main(argv = process.argv): void {
  const program = buildProgram();
  try {
    if (argv.slice(2).length === 0) {
      process.stderr.write(program.helpInformation());
      process.exitCode = 1;
      return;
    }
    program.parse(argv);
  } catch (error) {
    if (
      error instanceof UsageError ||
      error instanceof SourceError ||
      error instanceof VersionError
    ) {
      process.stderr.write(`error: ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(
      `error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

function repoRelativeChange(
  change: ReportData["changes"][number],
): ReportData["changes"][number] {
  if (change.file === undefined) return change;

  const file = relative(process.cwd(), change.file);
  if (
    file === "" ||
    file === ".." ||
    file.startsWith(`..${sep}`) ||
    isAbsolute(file)
  ) {
    const copy = { ...change };
    delete copy.file;
    return copy;
  }
  return { ...change, file: file.split(sep).join("/") };
}

function readPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string"
      ? packageJson.version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

if (require.main === module) {
  main();
}
