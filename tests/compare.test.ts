import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { compareSurfaces } from "../src/compare";
import { loadSource } from "../src/load";
import { buildSurface } from "../src/surface";
import type { ApiSurface } from "../src/types";
import {
  compareFixture,
  comparePaths,
  fixturePath,
  rulePaths,
  surfaceAt,
} from "./helpers";

function rp(rule: string, path: string, review = false) {
  return { rule, path, review };
}

describe("function and overload comparison", () => {
  const result = compareFixture("functions");

  it("summarizes changes and recommends a major bump", () => {
    expect(result.summary).toEqual({
      breaking: 9,
      compatible: 4,
      total: 13,
      oldExports: 14,
      newExports: 14,
      recommendedBump: "major",
    });
  });

  it("applies directional parameter, return, overload, and export rules", () => {
    expect(rulePaths(result)).toEqual([
      rp("function-parameter-added-required", "add(c)"),
      rp("function-parameter-type-changed", "changeParam(value)", true),
      rp("function-return-type-changed", "changeReturn.return", true),
      rp("function-type-parameters-changed", "generic.typeParameters", true),
      rp(
        "function-parameter-became-required",
        "optionalToRequired(value)",
      ),
      rp("overload-removed", "removeOverload (overload 2)"),
      rp("function-parameter-removed", "removeParam(legacy)"),
      rp("export-removed", "removedFromNew"),
      rp("function-parameter-type-changed", "rest(values)", true),
      rp("overload-added", "addOverload (overload 2)"),
      rp("export-added", "addedExport"),
      rp("function-parameter-added-optional", "optionalParam(signal)"),
      rp("function-parameter-became-optional", "requiredToOptional(value)"),
    ]);
  });

  it("records the before and after text of a required parameter", () => {
    const change = result.changes.find((candidate) => candidate.path === "add(c)");
    expect(change).toMatchObject({
      severity: "breaking",
      rule: "function-parameter-added-required",
      label: "Required parameter added",
      review: false,
      before: null,
      after: "c: number",
    });
  });

  it("flags type changes for review instead of claiming assignability", () => {
    const change = result.changes.find(
      (candidate) => candidate.path === "changeParam(value)",
    );
    expect(change).toMatchObject({
      severity: "breaking",
      review: true,
      before: "string",
      after: "number",
    });
    expect(change?.message).toContain("assignability was not proven");
  });

  it("does not report a parameter rename when the signature is equivalent", () => {
    expect(result.changes.some((change) => change.path.startsWith("rename"))).toBe(
      false,
    );
  });

  it("inverts additions and removals when the comparison direction is reversed", () => {
    const reversed = comparePaths(
      fixturePath("functions", "v2"),
      fixturePath("functions", "v1"),
    );
    expect(rulePaths(reversed)).toContainEqual(
      rp("export-removed", "addedExport"),
    );
    expect(rulePaths(reversed)).toContainEqual(
      rp("function-parameter-removed", "add(c)"),
    );
    expect(rulePaths(reversed)).toContainEqual(
      rp("overload-removed", "addOverload (overload 2)"),
    );
    expect(rulePaths(reversed)).toContainEqual(
      rp("function-parameter-became-required", "requiredToOptional(value)"),
    );
  });
});

describe("interface and type literal comparison", () => {
  const result = compareFixture("interfaces");

  it("summarizes interface, call signature, and index signature changes", () => {
    expect(result.summary).toEqual({
      breaking: 8,
      compatible: 7,
      total: 15,
      oldExports: 4,
      newExports: 4,
      recommendedBump: "major",
    });
    expect(rulePaths(result)).toEqual([
      rp("index-signature-type-changed", "Account.index(string)", true),
      rp("member-removed", "Account.legacy"),
      rp("property-readonly-added", "Account.mutable"),
      rp("member-became-required", "Account.nickname"),
      rp("overload-removed", "Account.overloaded (overload 2)"),
      rp("member-removed", "Account.removeMe"),
      rp("member-type-changed", "Account.role", true),
      rp("export-removed", "RemovedIface"),
      rp("function-parameter-added-optional", "Account(radix)"),
      rp("member-added", "Account.avatar"),
      rp("property-readonly-removed", "Account.removable"),
      rp("member-added", "Account.reset"),
      rp("export-added", "AddedIface"),
      rp("member-added", "Extended.added"),
      rp("member-added", "Shape.fill"),
    ]);
  });

  it("handles type literals as object shapes, not opaque text", () => {
    const fill = result.changes.find((change) => change.path === "Shape.fill");
    expect(fill).toMatchObject({
      severity: "compatible",
      label: "Member added",
      before: null,
      after: 'method "fill"',
    });
  });
});

describe("class comparison", () => {
  const result = compareFixture("classes");

  it("summarizes constructor, member, heritage, and kind changes", () => {
    expect(result.summary).toEqual({
      breaking: 13,
      compatible: 6,
      total: 19,
      oldExports: 11,
      newExports: 11,
      recommendedBump: "major",
    });
    expect(rulePaths(result)).toEqual([
      rp("class-became-abstract", "Abstracted"),
      rp("function-parameter-added-required", "CtorRequired.constructor(id)"),
      rp("member-type-changed", "KindChange.value", true),
      rp("export-kind-changed", "KindSwap"),
      rp("constructor-removed", "Lifetime.constructor"),
      rp("export-removed", "RemovedClass"),
      rp("member-removed", "Service.disconnect"),
      rp("heritage-changed", "Service.heritage", true),
      rp("heritage-changed", "Service.heritage", true),
      rp("heritage-changed", "Service.heritage", true),
      rp("overload-removed", "Service.parse (overload 2)"),
      rp("member-type-changed", "Service.static.DEFAULT_TIMEOUT", true),
      rp("function-parameter-became-required", "Service.stop(force)"),
      rp("export-added", "AddedClass"),
      rp("class-became-concrete", "ConcreteAgain"),
      rp("member-added", "Service.cancel"),
      rp("function-parameter-added-optional", "Service.constructor(region)"),
      rp("property-readonly-removed", "Service.static.DEFAULT_TIMEOUT"),
      rp(
        "function-parameter-added-optional",
        "Service.static.create(options)",
      ),
    ]);
  });

  it("ignores private, protected, and ECMAScript-private members", () => {
    expect(
      result.changes.some((change) =>
        /secret|internal|#hidden/.test(change.path),
      ),
    ).toBe(false);
  });

  it("does not flag a redundant zero-argument constructor removal", () => {
    expect(
      result.changes.some((change) =>
        change.path.startsWith("EmptyConstructor"),
      ),
    ).toBe(false);
  });

  it("treats a class becoming abstract as breaking", () => {
    expect(
      result.changes.find((change) => change.path === "Abstracted"),
    ).toMatchObject({
      rule: "class-became-abstract",
      severity: "breaking",
      before: "concrete",
      after: "abstract",
    });
  });

  it("explains all three heritage changes", () => {
    const heritage = result.changes.filter(
      (change) => change.rule === "heritage-changed",
    );
    expect(heritage.map((change) => change.message)).toEqual([
      "Heritage entry \"Base\" (extends) was removed.",
      "Heritage entry \"Disposable\" (implements) was removed.",
      "Heritage entry \"Other\" (extends) was added; inherited API changes were not proven safe.",
    ]);
  });
});

describe("enum comparison", () => {
  const result = compareFixture("enums");

  it("tracks members, explicit values, and implicit numeric values", () => {
    expect(result.summary).toEqual({
      breaking: 5,
      compatible: 1,
      total: 6,
      oldExports: 5,
      newExports: 4,
      recommendedBump: "major",
    });
    expect(rulePaths(result)).toEqual([
      rp("enum-value-changed", "Code.ServerError"),
      rp("enum-value-changed", "Color.Green"),
      rp("export-removed", "RemovedEnum"),
      rp("enum-value-changed", "Size.Large"),
      rp("enum-member-removed", "Size.Medium"),
      rp("enum-member-added", "Color.Yellow"),
    ]);
  });

  it("resolves implicit numeric enum values from their position", () => {
    const serverError = result.changes.find(
      (change) => change.path === "Code.ServerError",
    );
    expect(serverError).toMatchObject({ before: "405", after: "500" });

    const large = result.changes.find((change) => change.path === "Size.Large");
    expect(large).toMatchObject({ before: "2", after: "1" });
  });
});

describe("type alias and variable comparison", () => {
  it("compares unions, callable aliases, object aliases, and generics", () => {
    const result = compareFixture("types");
    expect(result.summary).toEqual({
      breaking: 4,
      compatible: 2,
      total: 6,
      oldExports: 5,
      newExports: 5,
      recommendedBump: "major",
    });
    expect(rulePaths(result)).toEqual([
      rp("function-parameter-type-changed", "Callback(value)", true),
      rp("type-parameters-changed", "Generic.typeParameters", true),
      rp("export-kind-changed", "KindSwap"),
      rp("type-changed", "Mode", true),
      rp("member-added", "Generic.fallback"),
      rp("member-added", "Options.signal"),
    ]);
  });

  it("compares exported variable type text", () => {
    const result = compareFixture("variables");
    expect(rulePaths(result)).toEqual([
      rp("type-changed", "VERSION", true),
      rp("export-added", "NEW_FLAG"),
    ]);
    const version = result.changes[0];
    expect(version).toMatchObject({
      severity: "breaking",
      before: "string",
      after: "number",
    });
  });
});

describe("re-export comparison", () => {
  const result = compareFixture("reexports");

  it("resolves aliases, star exports, and reachable files", () => {
    expect(result.summary).toEqual({
      breaking: 2,
      compatible: 3,
      total: 5,
      oldExports: 5,
      newExports: 5,
      recommendedBump: "major",
    });
    expect(rulePaths(result)).toEqual([
      rp("export-removed", "EXTRA"),
      rp("export-removed", "OldName"),
      rp("export-added", "NewName"),
      rp("member-added", "Thing.label"),
      rp("export-added", "newFn"),
    ]);
  });

  it("exposes the resolved export names rather than file-local names", () => {
    const oldSurface = surfaceAt(fixturePath("reexports", "v1"));
    const newSurface = surfaceAt(fixturePath("reexports", "v2"));
    expect(oldSurface.exports.map((exported) => exported.name)).toEqual([
      "EXTRA",
      "OldName",
      "Thing",
      "extra",
      "useThing",
    ]);
    expect(newSurface.exports.map((exported) => exported.name)).toEqual([
      "NewName",
      "Thing",
      "extra",
      "newFn",
      "useThing",
    ]);
  });

  it("works when comparing individual declaration files", () => {
    const fileResult = comparePaths(
      fixturePath("reexports", "v1", "index.d.ts"),
      fixturePath("reexports", "v2", "index.d.ts"),
    );
    expect(fileResult.summary).toEqual(result.summary);
    expect(rulePaths(fileResult)).toEqual(rulePaths(result));
  });

  it("lists the reachable declaration files for file sources", () => {
    const loaded = loadSource(fixturePath("reexports", "v2", "index.d.ts"));
    try {
      expect(loaded.files).toEqual([
        "extra.d.ts",
        "index.d.ts",
        "legacy.d.ts",
        "new.d.ts",
        "thing.d.ts",
      ]);
    } finally {
      loaded.cleanup();
    }
  });
});

describe("source and no-change behavior", () => {
  it("reports only compatible changes for a minor release", () => {
    const result = compareFixture("compatible");
    expect(result.summary).toEqual({
      breaking: 0,
      compatible: 4,
      total: 4,
      oldExports: 4,
      newExports: 5,
      recommendedBump: "minor",
    });
    expect(new Set(result.changes.map((change) => change.severity))).toEqual(
      new Set(["compatible"]),
    );
  });

  it("recommends no bump for identical surfaces", () => {
    const result = compareFixture("unchanged");
    expect(result.changes).toEqual([]);
    expect(result.summary).toEqual({
      breaking: 0,
      compatible: 0,
      total: 0,
      oldExports: 4,
      newExports: 4,
      recommendedBump: "none",
    });
  });

  it("unions every declaration file when a directory has no index entry", () => {
    const surface = surfaceAt(fixturePath("flat", "v1"));
    expect(surface.exports.map((exported) => exported.name)).toEqual([
      "Alpha",
      "BETA",
      "alpha",
    ]);

    const result = compareFixture("flat");
    expect(rulePaths(result)).toEqual([
      rp("member-added", "Alpha.label"),
      rp("export-added", "GAMMA"),
    ]);
    expect(result.summary.recommendedBump).toBe("minor");
  });

  it("honors a package.json types entry and ignores unreachable declarations", () => {
    const surface = surfaceAt(fixturePath("package-entry", "v1"));
    expect(surface.exports.map((exported) => exported.name)).toEqual([
      "entryPoint",
    ]);

    const loaded = loadSource(fixturePath("package-entry", "v1"));
    try {
      expect(loaded.files).toEqual(["lib/main.d.ts"]);
    } finally {
      loaded.cleanup();
    }

    const result = compareFixture("package-entry");
    expect(rulePaths(result)).toEqual([
      rp("function-parameter-added-optional", "entryPoint(value)"),
    ]);
  });
});

describe("declaration files outside the source root", () => {
  it("lists reachable outside-root declarations and includes their types", () => {
    const loaded = loadSource(fixturePath("external", "ok", "entry.d.ts"));
    try {
      expect(loaded.files).toEqual(["../outside/good.d.ts", "entry.d.ts"]);
      expect(
        buildSurface(loaded).exports.map((exported) => exported.name),
      ).toEqual(["Good", "Local"]);
    } finally {
      loaded.cleanup();
    }
  });

  it("surfaces parse errors in reachable outside-root declarations", () => {
    expect(() =>
      loadSource(fixturePath("external", "entry", "entry.d.ts")),
    ).toThrow(/broken\.d\.ts:\d+:\d+/);
    expect(() => loadSource(fixturePath("external", "pkg"))).toThrow(
      /broken\.d\.ts:\d+:\d+/,
    );
  });

  it("keeps node_modules typings out of the files list", () => {
    // Built in a temporary directory because a tracked fixture directory
    // named node_modules would be dropped by .gitignore.
    const root = mkdtempSync(join(tmpdir(), "typeshift-test-"));
    try {
      const depDirectory = join(root, "node_modules", "dep");
      mkdirSync(depDirectory, { recursive: true });
      writeFileSync(
        join(root, "entry.d.ts"),
        'export * from "dep";\n\nexport interface Local {\n  value: number;\n}\n',
      );
      writeFileSync(
        join(depDirectory, "index.d.ts"),
        "export interface Dep {\n  kind: string;\n}\n",
      );

      const loaded = loadSource(join(root, "entry.d.ts"));
      try {
        expect(loaded.files).toEqual(["entry.d.ts"]);
        expect(
          buildSurface(loaded).exports.map((exported) => exported.name),
        ).toEqual(["Dep", "Local"]);
      } finally {
        loaded.cleanup();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("type text quoting in change messages", () => {
  function typeAliasSurface(typeText: string): ApiSurface {
    return {
      exports: [
        {
          name: "Mode",
          kind: "type",
          signatures: [],
          callSignatures: [],
          constructSignatures: [],
          members: [],
          indexSignatures: [],
          heritage: [],
          enumMembers: null,
          typeParameters: [],
          abstract: false,
          typeText,
        },
      ],
    };
  }

  it("quotes template-literal types with valid CommonMark code spans", () => {
    const result = compareSurfaces(
      typeAliasSurface("`prefix-${string}`"),
      typeAliasSurface("string"),
    );
    const change = result.changes[0];
    expect(change).toMatchObject({ rule: "type-changed", review: true });
    expect(change?.message).toContain("`` `prefix-${string}` ``");
    expect(change?.message).not.toContain("\\`");
  });
});
