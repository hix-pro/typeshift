import { describe, expect, it } from "vitest";

import {
  checkSemverBump,
  classifyBump,
  recommendBump,
  VersionError,
} from "../src/semver";

describe("recommendBump", () => {
  it("recommends major for any breaking change", () => {
    expect(recommendBump(1, 0)).toBe("major");
    expect(recommendBump(3, 12)).toBe("major");
  });

  it("recommends minor for compatible-only changes", () => {
    expect(recommendBump(0, 1)).toBe("minor");
    expect(recommendBump(0, 25)).toBe("minor");
  });

  it("recommends no bump when the API is unchanged", () => {
    expect(recommendBump(0, 0)).toBe("none");
  });
});

describe("classifyBump", () => {
  it.each([
    ["1.2.3", "1.2.3", "none"],
    ["1.2.3", "1.2.4", "patch"],
    ["1.2.3", "1.3.0", "minor"],
    ["1.2.3", "2.0.0", "major"],
    ["0.1.0", "0.2.0", "minor"],
    ["0.1.0", "1.0.0", "major"],
    ["v1.2.3", "v1.3.0", "minor"],
    [" 1.2.3 ", " 2.0.0 ", "major"],
  ] as const)("classifies %s -> %s as %s", (from, to, expected) => {
    expect(classifyBump(from, to)).toBe(expected);
  });

  it("ignores build metadata when comparing versions", () => {
    expect(classifyBump("1.2.3+sha.abc", "1.2.3+sha.def")).toBe("none");
    expect(classifyBump("1.2.3+sha.abc", "1.2.4+sha.def")).toBe("patch");
  });

  it("classifies prerelease-only movement as a prerelease bump", () => {
    expect(classifyBump("1.0.0-alpha.1", "1.0.0-alpha.2")).toBe("prerelease");
    expect(classifyBump("1.0.0-alpha.1", "1.0.0")).toBe("prerelease");
    expect(classifyBump("1.0.0-alpha", "1.0.0-beta")).toBe("prerelease");
    expect(classifyBump("1.0.0-beta.2", "1.0.0-beta.11")).toBe("prerelease");
  });

  it("follows semver prerelease precedence", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let index = 1; index < ordered.length; index += 1) {
      expect(
        classifyBump(ordered[index - 1] as string, ordered[index] as string),
      ).toBe("prerelease");
    }
  });

  it("classifies a core version change with a prerelease as that core bump", () => {
    expect(classifyBump("1.0.0", "1.0.1-beta.1")).toBe("patch");
    expect(classifyBump("1.0.0", "1.1.0-rc.1")).toBe("minor");
    expect(classifyBump("1.0.0", "2.0.0-rc.1")).toBe("major");
  });

  it("rejects downgrades", () => {
    expect(() => classifyBump("2.0.0", "1.9.9")).toThrowError(VersionError);
    expect(() => classifyBump("1.0.0", "1.0.0-alpha")).toThrowError(
      /lower than/,
    );
  });

  it.each([
    "",
    "1",
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-",
    "1.2.3-01",
    "1.2.3-rc..1",
    "not-a-version",
  ])("rejects malformed version %j", (version) => {
    expect(() => classifyBump("1.0.0", version)).toThrowError(VersionError);
  });
});

describe("checkSemverBump", () => {
  it("accepts a major bump for breaking changes", () => {
    const check = checkSemverBump("1.4.0", "2.0.0", "major");
    expect(check).toEqual({
      from: "1.4.0",
      to: "2.0.0",
      actualBump: "major",
      recommendedBump: "major",
      ok: true,
      message:
        "Version bump major (1.4.0 -> 2.0.0) satisfies the recommended major bump.",
    });
  });

  it("rejects a minor bump for breaking changes", () => {
    const check = checkSemverBump("1.4.0", "1.5.0", "major");
    expect(check.ok).toBe(false);
    expect(check.actualBump).toBe("minor");
    expect(check.message).toContain("is lower than the recommended major bump");
  });

  it("accepts a bump larger than the recommendation", () => {
    expect(checkSemverBump("1.4.0", "3.0.0", "minor").ok).toBe(true);
  });

  it("rejects a patch release for compatible changes", () => {
    const check = checkSemverBump("1.4.0", "1.4.1", "minor");
    expect(check.ok).toBe(false);
    expect(check.actualBump).toBe("patch");
  });

  it("allows a patch or no release when the API is unchanged", () => {
    const unchanged = checkSemverBump("1.4.0", "1.4.0", "none");
    expect(unchanged).toMatchObject({ ok: true, actualBump: "none" });
    expect(unchanged.message).toBe(
      "No API changes; no version bump is required.",
    );

    const patch = checkSemverBump("1.4.0", "1.4.1", "none");
    expect(patch).toMatchObject({ ok: true, actualBump: "patch" });
    expect(patch.message).toBe(
      "No API changes; the patch bump (1.4.0 -> 1.4.1) is acceptable.",
    );
  });

  it("treats prerelease-only movement as insufficient for a patch", () => {
    const check = checkSemverBump("1.4.0-rc.1", "1.4.0-rc.2", "patch");
    expect(check).toMatchObject({ ok: false, actualBump: "prerelease" });
  });

  it("trims versions and reports them trimmed", () => {
    const check = checkSemverBump(" v1.4.0 ", " v1.5.0 ", "minor");
    expect(check.from).toBe("v1.4.0");
    expect(check.to).toBe("v1.5.0");
    expect(check.ok).toBe(true);
  });

  it("propagates malformed versions and downgrades", () => {
    expect(() => checkSemverBump("1.0", "2.0.0", "major")).toThrowError(
      VersionError,
    );
    expect(() => checkSemverBump("2.0.0", "1.0.0", "major")).toThrowError(
      /downgrades/,
    );
  });
});
