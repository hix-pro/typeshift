import { describe, expect, it } from "vitest";

import { formatSarif } from "../src/sarif";
import type { Change, ReportData } from "../src/types";

function baseReport(changes: Change[]): ReportData {
  return {
    schemaVersion: 1,
    tool: { name: "typeshift", version: "1.2.3" },
    old: { source: "npm:left-pad@1.0.0", files: ["index.d.ts"] },
    new: { source: "npm:left-pad@2.0.0", files: ["index.d.ts"] },
    summary: {
      breaking: changes.filter((change) => change.severity === "breaking")
        .length,
      compatible: changes.filter((change) => change.severity === "compatible")
        .length,
      total: changes.length,
      oldExports: 1,
      newExports: 1,
      recommendedBump: "major",
    },
    changes,
    semver: null,
  };
}

function change(overrides: Partial<Change>): Change {
  return {
    severity: "breaking",
    rule: "export-removed",
    label: "Export removed",
    path: "Legacy",
    message: 'Export "Legacy" was removed.',
    review: false,
    before: "interface",
    after: null,
    ...overrides,
  };
}

describe("SARIF rendering", () => {
  it("uses stable rule ids and maps change kinds to levels", () => {
    const sarif = JSON.parse(
      formatSarif(
        baseReport([
          change({}),
          change({
            severity: "compatible",
            rule: "export-added",
            label: "Export added",
            path: "Next",
            message: 'Export "Next" was added.',
            before: null,
            after: "interface",
          }),
          change({
            rule: "member-type-changed",
            label: "Member type changed",
            path: "User.role",
            review: true,
            message: "Type changed; assignability was not proven.",
          }),
        ]),
      ),
    ) as {
      version: string;
      runs: Array<{
        tool: { driver: { name: string; version: string; rules: unknown[] } };
        results: Array<{
          ruleId: string;
          level: string;
          locations: Array<{
            physicalLocation: {
              artifactLocation: { uri: string };
              region?: { startLine: number };
            };
          }>;
        }>;
      }>;
    };

    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]?.tool.driver.name).toBe("TypeShift");
    expect(sarif.runs[0]?.tool.driver.version).toBe("1.2.3");
    expect(sarif.runs[0]?.tool.driver.rules.length).toBeGreaterThan(30);

    const results = sarif.runs[0]?.results ?? [];
    expect(results.map((result) => result.level)).toEqual([
      "error",
      "note",
      "warning",
    ]);
    expect(results[0]?.ruleId).toBe("typeshift/export-removed");
  });

  it("falls back to the source argument when there is no repository file", () => {
    const sarif = JSON.parse(formatSarif(baseReport([change({})]))) as {
      runs: Array<{
        results: Array<{
          locations: Array<{
            physicalLocation: {
              artifactLocation: { uri: string };
              region?: { startLine: number };
            };
          }>;
        }>;
      }>;
    };
    const location = sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation;

    expect(location?.artifactLocation.uri).toBe("npm:left-pad@2.0.0");
    expect(location?.region).toBeUndefined();
  });

  it("annotates a known declaration file at line 1", () => {
    const sarif = JSON.parse(
      formatSarif(
        baseReport([change({ file: "src/index.d.ts" })]),
      ),
    ) as {
      runs: Array<{
        results: Array<{
          locations: Array<{
            physicalLocation: {
              artifactLocation: { uri: string };
              region?: { startLine: number };
            };
          }>;
        }>;
      }>;
    };
    const location = sarif.runs[0]?.results[0]?.locations[0]?.physicalLocation;

    expect(location?.artifactLocation.uri).toBe("src/index.d.ts");
    expect(location?.region?.startLine).toBe(1);
  });
});
