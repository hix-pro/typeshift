import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { Project, ts, type SourceFile } from "ts-morph";

const DECLARATION_FILE_RE = /\.d\.(?:ts|mts|cts)$/i;
const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
]);
const NPM_VERSION_OR_TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._+~-]*$/;
const NPM_PACKAGE_NAME_RE =
  /^(?:@[A-Za-z0-9][A-Za-z0-9._~-]*\/)?[A-Za-z0-9][A-Za-z0-9._~-]*$/;
const NODE_MODULES_DIRECTORY_RE = /[\\/]node_modules[\\/]/;

/**
 * Directory of the TypeScript installation whose compiler builds the program.
 * Its default library files (lib.es5.d.ts and friends) live beside the
 * compiler itself, wherever that installation is rooted.
 */
const TYPESCRIPT_LIB_DIRECTORY = (() => {
  try {
    return dirname(ts.sys.getExecutingFilePath());
  } catch {
    return null;
  }
})();

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export interface LoadedSource {
  /** The argument exactly as the user supplied it. */
  label: string;
  /** Declaration files reachable from the analyzed entry point(s), relative to the source root. */
  files: string[];
  project: Project;
  roots: SourceFile[];
  /** Removes temporary npm extraction directories. Safe to call more than once. */
  cleanup: () => void;
}

interface PackageJson {
  types?: unknown;
  typings?: unknown;
  exports?: unknown;
}

interface ParsedNpmSpec {
  packageName: string;
  versionOrTag: string;
  spec: string;
}

/** Returns true for `.d.ts`, `.d.mts`, and `.d.cts` paths. */
export function isDeclarationFile(filePath: string): boolean {
  return DECLARATION_FILE_RE.test(filePath);
}

/**
 * Resolves a CLI source to a ts-morph project and its declaration entry points.
 *
 * Supported sources:
 *   - a declaration file
 *   - a directory with a package.json types entry, index declaration, or a set
 *     of declaration files
 *   - npm:pkg@version / npm:@scope/pkg@version, downloaded with `npm pack`
 */
export function loadSource(source: string, cwd = process.cwd()): LoadedSource {
  if (source.startsWith("npm:")) {
    return loadNpmSource(source, cwd);
  }

  if (source.trim() === "") {
    throw new SourceError("Source path cannot be empty.");
  }

  const absolute = resolve(cwd, source);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    throw new SourceError(
      `Cannot read "${source}". Check that the path exists and is accessible.`,
    );
  }

  if (stats.isDirectory()) {
    return loadDirectory(source, absolute);
  }

  if (stats.isFile()) {
    if (!isDeclarationFile(absolute)) {
      throw new SourceError(
        `"${source}" is not a declaration file. Expected a .d.ts, .d.mts, or .d.cts file.`,
      );
    }
    return loadFile(source, absolute);
  }

  throw new SourceError(`"${source}" is neither a file nor a directory.`);
}

function loadFile(label: string, filePath: string): LoadedSource {
  return createLoadedSource(label, [filePath], dirname(filePath), () => {});
}

function loadDirectory(label: string, directory: string): LoadedSource {
  const declarationFiles = collectDeclarationFiles(directory);
  if (declarationFiles.length === 0) {
    throw new SourceError(
      `No declaration files found in "${label}". Expected at least one .d.ts, .d.mts, or .d.cts file.`,
    );
  }

  const packageJson = readPackageJson(directory, false);
  const packageEntry = packageJson
    ? resolvePackageEntry(directory, packageJson, declarationFiles)
    : null;
  const entry = packageEntry ?? findIndexEntry(declarationFiles, directory);
  const roots = entry ? [entry] : declarationFiles;

  return createLoadedSource(label, roots, directory, () => {});
}

function loadNpmSource(source: string, cwd: string): LoadedSource {
  const spec = parseNpmSpec(source);
  const tempRoot = mkdtempSync(join(tmpdir(), "typeshift-"));
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    rmSync(tempRoot, { recursive: true, force: true });
  };

  try {
    const packDirectory = join(tempRoot, "pack");
    const extractDirectory = join(tempRoot, "extract");
    mkdirSync(packDirectory, { recursive: true });
    mkdirSync(extractDirectory, { recursive: true });

    const isWindows = process.platform === "win32";
    const npm = isWindows ? "npm.cmd" : "npm";
    // Node's CVE-2024-27980 hardening (>=18.20.2/20.12.2) refuses to spawn
    // .cmd/.bat wrappers without a shell (EINVAL), so Windows has to run
    // npm.cmd through cmd.exe. That is safe here: parseNpmSpec() restricts
    // the spec to a charset without spaces or shell metacharacters, and the
    // pack destination is quoted for the shell because temp paths may
    // contain spaces.
    const packDestination = isWindows ? `"${packDirectory}"` : packDirectory;
    const packResult = spawnSync(
      npm,
      [
        "pack",
        spec.spec,
        "--pack-destination",
        packDestination,
        "--json",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        shell: isWindows,
        env: {
          ...process.env,
          npm_config_loglevel: "error",
          npm_config_update_notifier: "false",
        },
      },
    );

    if (packResult.error) {
      throw new SourceError(
        `Could not run npm to download "${spec.spec}": ${packResult.error.message}. npm: sources require npm on PATH.`,
      );
    }

    if (packResult.status !== 0) {
      const details = compactCommandError(packResult.stderr, packResult.stdout);
      throw new SourceError(
        `npm pack failed for "${spec.spec}"${details ? `:\n${details}` : "."}`,
      );
    }

    const tarballName = parsePackOutput(packResult.stdout);
    const tarballPath = resolve(packDirectory, tarballName);
    if (!isWithin(packDirectory, tarballPath) || !existsSync(tarballPath)) {
      throw new SourceError(
        `npm pack returned an unexpected archive path for "${spec.spec}".`,
      );
    }

    const tarResult = spawnSync(
      "tar",
      ["-xzf", tarballPath, "-C", extractDirectory],
      {
        encoding: "utf8",
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    if (tarResult.error) {
      throw new SourceError(
        `Could not extract the package archive for "${spec.spec}": ${tarResult.error.message}. npm: sources require tar on PATH.`,
      );
    }
    if (tarResult.status !== 0) {
      const details = compactCommandError(tarResult.stderr, tarResult.stdout);
      throw new SourceError(
        `Could not extract the package archive for "${spec.spec}"${details ? `:\n${details}` : "."}`,
      );
    }

    const packageRoot = findExtractedPackageRoot(extractDirectory);
    const packageJson = readPackageJson(packageRoot, true);
    if (packageJson === null) {
      throw new SourceError(
        `The downloaded package "${spec.spec}" does not contain a package.json file.`,
      );
    }
    const declarationFiles = collectDeclarationFiles(packageRoot);
    if (declarationFiles.length === 0) {
      throw new SourceError(
        `Package "${spec.spec}" does not contain any declaration files. TypeShift can only compare packages that ship .d.ts, .d.mts, or .d.cts files.`,
      );
    }

    const entry = resolvePackageEntry(
      packageRoot,
      packageJson,
      declarationFiles,
    );
    if (entry === null) {
      throw new SourceError(
        `Could not determine the type entry point for "${spec.spec}". Compare a local directory or declaration file explicitly instead.`,
      );
    }

    const loaded = createLoadedSource(source, [entry], packageRoot, cleanup);
    return loaded;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function createLoadedSource(
  label: string,
  rootPaths: string[],
  displayRoot: string,
  cleanup: () => void,
): LoadedSource {
  const project = new Project({
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      lib: ["ES2022"],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowJs: false,
    },
    skipAddingFilesFromTsConfig: true,
  });

  try {
    for (const rootPath of rootPaths) {
      project.addSourceFileAtPath(rootPath);
    }
  } catch (error) {
    throw new SourceError(
      `Could not load declaration files: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const program = project.getProgram();
  const rootSet = new Set(rootPaths.map((rootPath) => resolve(rootPath)));

  // The compiler follows imports and re-exports anywhere on disk, so both the
  // diagnostics scope and the files list are built from reachability rather
  // than directory containment: the root files plus every declaration file
  // the program actually reaches. Installed packages (node_modules) and the
  // TypeScript default libraries are type-resolution inputs, not part of the
  // analyzed package's surface.
  const reachableFiles = new Set(rootSet);
  for (const sourceFile of program.compilerObject.getSourceFiles()) {
    const filePath = resolve(sourceFile.fileName);
    if (
      !isDeclarationFile(filePath) ||
      reachableFiles.has(filePath) ||
      isExternalScope(filePath)
    ) {
      continue;
    }
    reachableFiles.add(filePath);
  }

  const relevantDiagnostics = program
    .getSyntacticDiagnostics()
    .filter((diagnostic) => {
      const sourceFile = diagnostic.getSourceFile();
      if (sourceFile === undefined) return false;
      const filePath = resolve(sourceFile.getFilePath());
      return isDeclarationFile(filePath) && reachableFiles.has(filePath);
    });

  if (relevantDiagnostics.length > 0) {
    const lines = relevantDiagnostics.slice(0, 5).map((diagnostic) => {
      const sourceFile = diagnostic.getSourceFile();
      if (sourceFile === undefined) return diagnostic.getMessageText();
      const filePath = resolve(sourceFile.getFilePath());
      const position = sourceFile.getLineAndColumnAtPos(diagnostic.getStart());
      const message = getDiagnosticMessage(diagnostic);
      return `${toDisplayPath(displayRoot, filePath)}:${position.line}:${position.column} - TS${diagnostic.getCode()}: ${message}`;
    });
    const remaining = relevantDiagnostics.length - lines.length;
    const suffix = remaining > 0 ? `\n  ...and ${remaining} more parse error(s)` : "";
    throw new SourceError(
      `Failed to parse declaration files:\n  ${lines.join("\n  ")}${suffix}`,
    );
  }

  const roots: SourceFile[] = [];
  for (const rootPath of rootPaths) {
    const sourceFile = project.getSourceFile(rootPath);
    if (sourceFile === undefined) {
      throw new SourceError(
        `Could not load declaration file "${toDisplayPath(displayRoot, rootPath)}".`,
      );
    }
    roots.push(sourceFile);
  }

  const files = [...reachableFiles]
    .map((filePath) => toDisplayPath(displayRoot, filePath))
    .sort();

  return {
    label,
    files,
    project,
    roots,
    cleanup,
  };
}

function collectDeclarationFiles(directory: string): string[] {
  const files: string[] = [];

  const walk = (current: string): void => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      throw new SourceError(`Cannot read directory "${current}".`);
    }

    entries.sort((a, b) => compareStrings(a.name, b.name));
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && isDeclarationFile(entry.name)) {
        files.push(resolve(fullPath));
      }
    }
  };

  walk(directory);
  return files.sort();
}

function findIndexEntry(files: string[], root: string): string | null {
  const indexed = files
    .filter((filePath) => basename(filePath).toLowerCase().startsWith("index.d."))
    .sort((a, b) => {
      const aRelative = relative(root, a);
      const bRelative = relative(root, b);
      const depthDifference =
        countPathSegments(aRelative) - countPathSegments(bRelative);
      if (depthDifference !== 0) return depthDifference;
      return compareStrings(aRelative, bRelative);
    });
  return indexed[0] ?? null;
}

function readPackageJson(directory: string, required: boolean): PackageJson | null {
  const packageJsonPath = join(directory, "package.json");
  let text: string;
  try {
    text = readFileSync(packageJsonPath, "utf8");
  } catch (error) {
    if (
      !required &&
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw new SourceError(`Could not read "${packageJsonPath}".`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SourceError(`Could not parse "${packageJsonPath}" as JSON.`);
  }

  if (!isRecord(parsed)) {
    throw new SourceError(`"${packageJsonPath}" does not contain a JSON object.`);
  }
  return parsed;
}

function resolvePackageEntry(
  packageRoot: string,
  packageJson: PackageJson,
  declarationFiles: string[],
): string | null {
  for (const field of [packageJson.types, packageJson.typings]) {
    const target = resolveDeclarationTarget(packageRoot, field);
    if (target !== null) return target;
  }

  const exportsTarget = resolveExportsTarget(packageJson.exports);
  const resolvedExportsTarget = resolveDeclarationTarget(
    packageRoot,
    exportsTarget,
  );
  if (resolvedExportsTarget !== null) return resolvedExportsTarget;

  const candidateNames = [
    "index.d.ts",
    "index.d.mts",
    "index.d.cts",
    "dist/index.d.ts",
    "dist/index.d.mts",
    "dist/index.d.cts",
    "lib/index.d.ts",
    "lib/index.d.mts",
    "lib/index.d.cts",
    "build/index.d.ts",
    "types/index.d.ts",
  ];
  for (const candidateName of candidateNames) {
    const candidate = resolve(packageRoot, candidateName);
    if (isFile(candidate) && isDeclarationFile(candidate)) {
      return candidate;
    }
  }

  const indexEntry = findIndexEntry(declarationFiles, packageRoot);
  if (indexEntry !== null) return indexEntry;

  if (declarationFiles.length === 1) {
    return declarationFiles[0] ?? null;
  }

  return null;
}

function resolveExportsTarget(exportsField: unknown): unknown {
  if (!isRecord(exportsField)) {
    return pickExportTarget(exportsField);
  }

  const keys = Object.keys(exportsField);
  if (keys.some((key) => key.startsWith("."))) {
    return pickExportTarget(exportsField["."]);
  }
  return pickExportTarget(exportsField);
}

function pickExportTarget(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const picked = pickExportTarget(candidate, depth + 1);
      if (picked !== null) return picked;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const condition of ["types", "import", "default", "require", "node"]) {
      if (!(condition in value)) continue;
      const picked = pickExportTarget(value[condition], depth + 1);
      if (picked !== null) return picked;
    }
  }
  return null;
}

function resolveDeclarationTarget(
  packageRoot: string,
  target: unknown,
): string | null {
  if (typeof target !== "string" || target.trim() === "") return null;
  if (target.includes("*")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return null;

  const candidateBase = resolve(packageRoot, target);
  if (!isWithin(packageRoot, candidateBase)) return null;

  const candidates = [candidateBase];
  if (/\.(?:m|c)?js$/i.test(candidateBase)) {
    candidates.push(
      candidateBase.replace(/\.(m|c)?js$/i, (_match, moduleKind: string | undefined) => {
        if (moduleKind === "m") return ".d.mts";
        if (moduleKind === "c") return ".d.cts";
        return ".d.ts";
      }),
    );
  }
  if (!/\.[^/\\]+$/.test(candidateBase)) {
    candidates.push(`${candidateBase}.d.ts`);
    candidates.push(join(candidateBase, "index.d.ts"));
  }

  for (const candidate of candidates) {
    if (isFile(candidate) && isDeclarationFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function parseNpmSpec(source: string): ParsedNpmSpec {
  const body = source.slice("npm:".length).trim();
  if (body === "") {
    throw new SourceError(
      "Invalid npm source. Use npm:pkg@version or npm:@scope/pkg@version.",
    );
  }

  const atIndex = body.lastIndexOf("@");
  if (atIndex <= 0) {
    throw new SourceError(
      `Invalid npm source "${source}". Include an explicit version or tag, for example npm:${body}@1.2.3.`,
    );
  }

  const packageName = body.slice(0, atIndex);
  const versionOrTag = body.slice(atIndex + 1);
  if (!NPM_PACKAGE_NAME_RE.test(packageName)) {
    throw new SourceError(`Invalid npm package name "${packageName}".`);
  }
  if (!NPM_VERSION_OR_TAG_RE.test(versionOrTag)) {
    throw new SourceError(
      `Invalid npm version or tag "${versionOrTag}" in "${source}".`,
    );
  }

  return {
    packageName,
    versionOrTag,
    spec: `${packageName}@${versionOrTag}`,
  };
}

function parsePackOutput(stdout: string): string {
  const parsed = parseJsonWithFallback(stdout);
  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && typeof parsed.filename === "string"
      ? [parsed]
      : isRecord(parsed)
        ? Object.values(parsed)
        : [];

  for (const entry of entries) {
    if (isRecord(entry) && typeof entry.filename === "string") {
      return entry.filename;
    }
  }

  throw new SourceError(
    "npm pack did not return the expected JSON output. Check your npm installation.",
  );
}

function parseJsonWithFallback(stdout: string): unknown {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // Fall through to the friendly error below.
      }
    }
    throw new SourceError(
      "npm pack did not return valid JSON. Check your npm installation.",
    );
  }
}

function findExtractedPackageRoot(extractDirectory: string): string {
  const packageDirectory = join(extractDirectory, "package");
  if (isDirectory(packageDirectory)) return packageDirectory;

  const entries = readdirSync(extractDirectory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const onlyDirectory = directories[0];
  if (directories.length === 1 && onlyDirectory !== undefined) {
    return join(extractDirectory, onlyDirectory.name);
  }
  throw new SourceError(
    "The downloaded npm archive did not contain a single package directory.",
  );
}

function compactCommandError(stderr: string | null, stdout: string | null): string {
  const combined = [stderr, stdout]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .join("\n")
    .trim();
  if (combined === "") return "";
  const lines = combined.split(/\r?\n/).slice(0, 12);
  return lines.join("\n");
}

function getDiagnosticMessage(diagnostic: {
  getMessageText(): string | { getMessageText(): string };
}): string {
  const message = diagnostic.getMessageText();
  return typeof message === "string" ? message : message.getMessageText();
}

function toDisplayPath(root: string, filePath: string): string {
  const relativePath = relative(root, filePath) || basename(filePath);
  return relativePath.split(sep).join("/");
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function countPathSegments(filePath: string): number {
  return filePath.split(/[\\/]/).filter(Boolean).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath))
  );
}

/**
 * Returns true for declaration files that belong to installed packages (any
 * `node_modules` directory) or to the TypeScript compiler's own default
 * libraries. Both are external scope: they feed type resolution but are not
 * the API surface under comparison.
 */
function isExternalScope(filePath: string): boolean {
  return (
    NODE_MODULES_DIRECTORY_RE.test(filePath) ||
    (TYPESCRIPT_LIB_DIRECTORY !== null &&
      isWithin(TYPESCRIPT_LIB_DIRECTORY, filePath))
  );
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
