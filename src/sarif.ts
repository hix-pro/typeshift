/**
 * SARIF 2.1.0 output for GitHub code scanning.
 *
 * TypeShift reports semantic declaration changes, not parser findings. Each
 * change is attached to the declaration file that owns the changed export so
 * pull requests can annotate the right file. npm sources have no repository
 * file, so they fall back to the source argument as a logical artifact.
 */

import type { Change, ChangeRule, ReportData } from "./types";
import { REVIEW_RULES, RULE_LABELS, RULE_SEVERITY } from "./types";

type SarifLevel = "error" | "warning" | "note";

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const SARIF_HELP_URI =
  "https://github.com/hix-pro/typeshift#what-it-compares";

const RULES = (Object.keys(RULE_LABELS) as ChangeRule[]).map((rule) => ({
  id: `typeshift/${rule}`,
  name: rule
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(""),
  shortDescription: { text: RULE_LABELS[rule] },
  helpUri: SARIF_HELP_URI,
  defaultConfiguration: { level: levelFor(rule) },
}));

function levelFor(rule: ChangeRule): SarifLevel {
  if (REVIEW_RULES.has(rule)) return "warning";
  return RULE_SEVERITY[rule] === "breaking" ? "error" : "note";
}

function messageFor(change: Change): string {
  const lines = [`${change.label}: ${change.path}`, "", change.message];
  if (change.before !== null || change.after !== null) {
    lines.push(
      "",
      `Before: ${change.before ?? "(none)"}`,
      `After: ${change.after ?? "(none)"}`,
    );
  }
  return lines.join("\n");
}

function fallbackSource(report: ReportData): string {
  for (const source of [report.new.source, report.old.source]) {
    if (!source.startsWith("npm:")) return source.replaceAll("\\", "/");
  }
  return report.new.source.replaceAll("\\", "/");
}

/** Renders SARIF 2.1.0 for code scanning and other SARIF consumers. */
export function formatSarif(report: ReportData): string {
  const ruleIndexes = new Map(RULES.map((rule, index) => [rule.id, index]));
  const results = report.changes.map((change) => {
    const ruleId = `typeshift/${change.rule}`;
    const local = change.file !== undefined;

    return {
      ruleId,
      ruleIndex: ruleIndexes.get(ruleId) ?? 0,
      level: levelFor(change.rule),
      message: { text: messageFor(change) },
      locations: [
        {
          physicalLocation: {
            artifactLocation: {
              uri: local ? change.file : fallbackSource(report),
            },
            ...(local ? { region: { startLine: 1 } } : {}),
          },
          logicalLocations: [
            {
              name: change.path,
              fullyQualifiedName: change.path,
              kind: "member",
            },
          ],
        },
      ],
      properties: {
        severity: change.severity,
        review: change.review,
        before: change.before,
        after: change.after,
      },
    };
  });

  const log = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "TypeShift",
            informationUri: "https://github.com/hix-pro/typeshift",
            version: report.tool.version,
            rules: RULES,
          },
        },
        results,
      },
    ],
  };

  return `${JSON.stringify(log, null, 2)}\n`;
}
