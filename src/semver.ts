import type {
  ActualBump,
  RecommendedBump,
  SemverCheck,
} from "./types";

const SEMVER_RE =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const BUMP_RANK: Record<ActualBump, number> = {
  none: 0,
  prerelease: 1,
  patch: 2,
  minor: 3,
  major: 4,
};

export class VersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionError";
  }
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

/**
 * Version advice:
 *   - any breaking change -> major
 *   - otherwise any compatible change -> minor
 *   - otherwise no bump is required (not even a patch)
 */
export function recommendBump(
  breakingCount: number,
  compatibleCount: number,
): RecommendedBump {
  if (breakingCount > 0) return "major";
  if (compatibleCount > 0) return "minor";
  return "none";
}

/**
 * Classifies the actual release bump between two versions.
 *
 * Build metadata is ignored. Prerelease-only movement is classified as a
 * `prerelease` bump, which ranks below a patch release for validation.
 */
export function classifyBump(fromRaw: string, toRaw: string): ActualBump {
  const from = parseVersion(fromRaw);
  const to = parseVersion(toRaw);
  const comparison = compareParsedVersions(from, to);
  if (comparison === 0) return "none";
  if (comparison > 0) {
    throw new VersionError(
      `Version "${toRaw}" is lower than "${fromRaw}". Version downgrades are not a valid release bump.`,
    );
  }

  if (to.major !== from.major) return "major";
  if (to.minor !== from.minor) return "minor";
  if (to.patch !== from.patch) return "patch";
  return "prerelease";
}

/**
 * Validates that the actual release bump is at least the recommended bump.
 * Throws VersionError for malformed versions and downgrades.
 */
export function checkSemverBump(
  fromRaw: string,
  toRaw: string,
  recommended: RecommendedBump,
): SemverCheck {
  const from = fromRaw.trim();
  const to = toRaw.trim();
  const actual = classifyBump(from, to);
  const ok = BUMP_RANK[actual] >= BUMP_RANK[recommended];

  let message: string;
  if (ok) {
    if (recommended === "none" && actual === "none") {
      message = "No API changes; no version bump is required.";
    } else if (recommended === "none") {
      message = `No API changes; the ${actual} bump (${from} -> ${to}) is acceptable.`;
    } else {
      message = `Version bump ${actual} (${from} -> ${to}) satisfies the recommended ${recommended} bump.`;
    }
  } else {
    message = `Version bump ${actual} (${from} -> ${to}) is lower than the recommended ${recommended} bump.`;
  }

  return {
    from,
    to,
    actualBump: actual,
    recommendedBump: recommended,
    ok,
    message,
  };
}

export function parseVersion(input: string): ParsedVersion {
  const match = SEMVER_RE.exec(input.trim());
  if (match === null) {
    throw new VersionError(
      `Invalid semantic version "${input}". Expected a version like 1.2.3, 1.2.3-beta.1, or v1.2.3.`,
    );
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prereleaseText = match[4];
  const prerelease = prereleaseText === undefined ? [] : prereleaseText.split(".");

  for (const identifier of prerelease) {
    if (/^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) {
      throw new VersionError(
        `Invalid semantic version "${input}": numeric prerelease identifiers cannot have leading zeros.`,
      );
    }
  }

  return { major, minor, patch, prerelease };
}

function compareParsedVersions(
  from: ParsedVersion,
  to: ParsedVersion,
): number {
  if (from.major !== to.major) return from.major < to.major ? -1 : 1;
  if (from.minor !== to.minor) return from.minor < to.minor ? -1 : 1;
  if (from.patch !== to.patch) return from.patch < to.patch ? -1 : 1;
  return comparePrerelease(from.prerelease, to.prerelease);
}

function comparePrerelease(from: string[], to: string[]): number {
  if (from.length === 0 && to.length === 0) return 0;
  if (from.length === 0) return 1;
  if (to.length === 0) return -1;

  const count = Math.max(from.length, to.length);
  for (let index = 0; index < count; index += 1) {
    const fromIdentifier = from[index];
    const toIdentifier = to[index];
    if (fromIdentifier === undefined) return -1;
    if (toIdentifier === undefined) return 1;

    const fromNumeric = /^\d+$/.test(fromIdentifier);
    const toNumeric = /^\d+$/.test(toIdentifier);
    if (fromNumeric && toNumeric) {
      const fromNumber = Number(fromIdentifier);
      const toNumber = Number(toIdentifier);
      if (fromNumber !== toNumber) return fromNumber < toNumber ? -1 : 1;
      continue;
    }
    if (fromNumeric !== toNumeric) return fromNumeric ? -1 : 1;
    if (fromIdentifier !== toIdentifier) {
      return fromIdentifier < toIdentifier ? -1 : 1;
    }
  }
  return 0;
}
