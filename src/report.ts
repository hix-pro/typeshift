import pc from "picocolors";

import type { Change, ReportData, SemverCheck } from "./types";

export interface HumanReportOptions {
  failOnBreaking: boolean;
}

/** Renders the terminal report. */
export function formatHuman(
  report: ReportData,
  options: HumanReportOptions,
): string {
  const lines: string[] = [];
  const { summary } = report;

  lines.push(
    `${pc.bold(`TypeShift ${report.tool.version}`)} ${pc.dim("API compatibility report")}`,
  );
  lines.push("");
  lines.push(
    `${pc.dim("Old:")} ${pc.cyan(report.old.source)} ${pc.dim(`(${fileCount(report.old.files.length)})`)}`,
  );
  lines.push(
    `${pc.dim("New:")} ${pc.cyan(report.new.source)} ${pc.dim(`(${fileCount(report.new.files.length)})`)}`,
  );
  lines.push(
    `${pc.dim("Exports:")} ${exportCount(summary.oldExports, summary.newExports)}  ${pc.dim("|")}  ${pc.red(`${summary.breaking} breaking`)}  ${pc.dim("|")}  ${pc.green(`${summary.compatible} compatible`)}`,
  );
  lines.push("");

  if (report.changes.length === 0) {
    lines.push(pc.green("No API changes detected."));
  } else {
    appendHumanSection(lines, "BREAKING", report.changes, "breaking");
    appendHumanSection(lines, "COMPATIBLE", report.changes, "compatible");
  }

  lines.push("");
  lines.push(
    `${pc.bold("Recommended bump:")} ${colorBump(summary.recommendedBump)}`,
  );

  if (summary.breaking > 0) {
    const semverMismatch = report.semver !== null && !report.semver.ok;
    if (options.failOnBreaking) {
      lines.push(
        pc.dim(
          semverMismatch
            ? "--fail-on-breaking is active; the semver mismatch determines exit code 1."
            : "--fail-on-breaking is active; this run exits with code 2.",
        ),
      );
    } else {
      lines.push(
        pc.dim(
          "Hint: re-run with --fail-on-breaking to fail CI when breaking changes are found.",
        ),
      );
    }
  }

  if (report.semver !== null) {
    lines.push("");
    lines.push(formatHumanSemver(report.semver));
  }

  return `${lines.join("\n")}\n`;
}

function appendHumanSection(
  lines: string[],
  title: string,
  changes: Change[],
  severity: "breaking" | "compatible",
): void {
  const sectionChanges = changes.filter(
    (change) => change.severity === severity,
  );
  if (sectionChanges.length === 0) return;

  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  const heading =
    severity === "breaking"
      ? pc.bold(pc.red(`${title} (${sectionChanges.length})`))
      : pc.bold(pc.green(`${title} (${sectionChanges.length})`));
  lines.push(heading);

  for (const change of sectionChanges) {
    const symbol = severity === "breaking" ? pc.red("✖") : pc.green("+");
    const label = change.review
      ? `${change.label} ${pc.yellow("(review)")}`
      : change.label;
    lines.push(`  ${symbol} ${label}: ${pc.bold(change.path)}`);
    for (const messageLine of wrapText(change.message, 96)) {
      lines.push(`      ${messageLine}`);
    }
  }
}

function formatHumanSemver(check: SemverCheck): string {
  const status = check.ok ? pc.green("OK") : pc.red("MISMATCH");
  const lines = [
    `${pc.bold("Semver check:")} ${check.message} ${status}`,
  ];
  if (!check.ok) {
    lines.push(
      pc.dim(
        "  Choose a release version that matches the recommendation, or intentionally override the check.",
      ),
    );
  }
  return lines.join("\n");
}

/** Renders the stable machine-readable schema. */
export function formatJson(report: ReportData): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/** Renders a Markdown report suitable for a PR or release note. */
export function formatMarkdown(report: ReportData): string {
  const { summary } = report;
  const lines: string[] = [];

  lines.push("# TypeShift API compatibility report");
  lines.push("");
  lines.push(
    `**Old:** ${inlineCode(report.old.source)} (${fileCount(report.old.files.length)})  `,
  );
  lines.push(
    `**New:** ${inlineCode(report.new.source)} (${fileCount(report.new.files.length)})`,
  );
  lines.push("");
  lines.push("| Summary | Value |");
  lines.push("| --- | ---: |");
  lines.push(`| Breaking | ${summary.breaking} |`);
  lines.push(`| Compatible | ${summary.compatible} |`);
  lines.push(
    `| Exports | ${summary.oldExports} -> ${summary.newExports} |`,
  );
  lines.push(
    `| Recommended bump | ${inlineCode(summary.recommendedBump)} |`,
  );
  lines.push("");

  if (report.changes.length === 0) {
    lines.push("No API changes detected.");
    lines.push("");
  } else {
    appendMarkdownSection(lines, "Breaking changes", report.changes, "breaking");
    appendMarkdownSection(
      lines,
      "Compatible changes",
      report.changes,
      "compatible",
    );
  }

  if (report.semver !== null) {
    lines.push("## Semver validation");
    lines.push("");
    const status = report.semver.ok ? "OK" : "**MISMATCH**";
    lines.push(
      `${inlineCode(report.semver.from)} -> ${inlineCode(report.semver.to)} · actual ${inlineCode(report.semver.actualBump)} · recommended ${inlineCode(report.semver.recommendedBump)} · ${status}`,
    );
    lines.push("");
    lines.push(report.semver.message);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function appendMarkdownSection(
  lines: string[],
  title: string,
  changes: Change[],
  severity: "breaking" | "compatible",
): void {
  const sectionChanges = changes.filter(
    (change) => change.severity === severity,
  );
  if (sectionChanges.length === 0) return;

  lines.push(`## ${title} (${sectionChanges.length})`);
  lines.push("");
  lines.push("| Change | Location | Details |");
  lines.push("| --- | --- | --- |");
  for (const change of sectionChanges) {
    const label = change.review
      ? `${change.label} (review)`
      : change.label;
    lines.push(
      `| ${escapeTableCell(label)} | ${inlineCode(change.path)} | ${escapeTableCell(change.message)} |`,
    );
  }
  lines.push("");
}

function exportCount(oldCount: number, newCount: number): string {
  return oldCount === newCount
    ? `${oldCount}`
    : `${oldCount} -> ${newCount}`;
}

function fileCount(count: number): string {
  return count === 1 ? "1 declaration file" : `${count} declaration files`;
}

function colorBump(bump: ReportData["summary"]["recommendedBump"]): string {
  if (bump === "major") return pc.bold(pc.red(bump));
  if (bump === "minor") return pc.bold(pc.green(bump));
  if (bump === "patch") return pc.bold(pc.yellow(bump));
  return pc.bold(pc.dim(bump));
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, "\\`")}\``;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current === "") {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines;
}
