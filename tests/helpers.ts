import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { compareSurfaces } from "../src/compare";
import { loadSource } from "../src/load";
import { buildSurface } from "../src/surface";
import type { ApiSurface, ComparisonResult } from "../src/types";

/**
 * Vitest runs from the package root, which keeps fixture and CLI paths stable
 * without relying on `__dirname` semantics across ESM and CommonJS transforms.
 */
export const ROOT = process.cwd();
export const FIXTURES = resolve(ROOT, "tests", "fixtures");

export function fixturePath(...segments: string[]): string {
  return resolve(FIXTURES, ...segments);
}

export function surfaceAt(source: string, cwd = ROOT): ApiSurface {
  const loaded = loadSource(source, cwd);
  try {
    return buildSurface(loaded);
  } finally {
    loaded.cleanup();
  }
}

export function comparePaths(
  oldSource: string,
  newSource: string,
  cwd = ROOT,
): ComparisonResult {
  return compareSurfaces(
    surfaceAt(oldSource, cwd),
    surfaceAt(newSource, cwd),
  );
}

export function compareFixture(name: string): ComparisonResult {
  return comparePaths(
    fixturePath(name, "v1"),
    fixturePath(name, "v2"),
  );
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the TypeScript entry point in a child process so exit codes, stderr,
 * and stdout are observed exactly as a user would see them. The asynchronous
 * spawn keeps the Vitest worker responsive while the child parses declarations.
 */
export function runCli(
  args: string[],
  options: { cwd?: string } = {},
): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    const builtCli = resolve(ROOT, "dist", "cli.js");
    const command = existsSync(builtCli)
      ? [builtCli, ...args]
      : ["--import", "tsx", resolve(ROOT, "src", "cli.ts"), ...args];
    const child = spawn(
      process.execPath,
      command,
      {
        cwd: options.cwd ?? ROOT,
        env: {
          ...process.env,
          NO_COLOR: "1",
          FORCE_COLOR: "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 60_000);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolveResult({ status, stdout, stderr });
    });
  });
}

export interface RulePath {
  rule: string;
  path: string;
  review: boolean;
}

/** A compact, order-preserving view used to assert exact comparison rules. */
export function rulePaths(
  result: ComparisonResult,
): RulePath[] {
  return result.changes.map((change) => ({
    rule: change.rule,
    path: change.path,
    review: change.review,
  }));
}
