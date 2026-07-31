import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Same trick vagrant-config.py uses for snippets/*.rb: stamp the vendored
// copy with a comment recording where it came from, then use that stamp
// both to refuse clobbering unmanaged files and to detect updates later.
// Unlike vagrant-config.py (which stamps a git revision), staleness here
// is judged by content hash, not git history — a repo with no commits
// yet (or a rewritten history) would otherwise make every vendored copy
// look permanently "current" even after the source changed.
// devcontainer-feature.json/meta.json are JSON (no comments allowed), so
// only install.sh — a real shell script — carries the stamp for local
// features; external features (no install.sh) carry it as a real JSON
// field in their vendored meta.json instead (see types.ts Provenance).

const MARKER = "# Installed using devcontainer-config from";
const PROVENANCE_RE = /^# Installed using devcontainer-config from (.+), dir (.+), content-hash (.+)$/;

export interface Provenance {
  remote: string;
  pathInRepo: string;
  contentHash: string;
}

function collectRelativeFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRelativeFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out.sort();
}

// Deterministic hash of a feature source directory's content (path +
// bytes of every file, sorted) — used for local features.
export function hashDirectory(dir: string): string {
  const hash = createHash("sha256");
  for (const rel of collectRelativeFiles(dir)) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(path.join(dir, rel)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// Hash of a single file's raw bytes — used for external features, whose
// only source-of-truth file is their meta.json.
export function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function buildHeaderLine(remote: string, pathInRepo: string, contentHash: string): string {
  return `${MARKER} ${remote}, dir ${pathInRepo}, content-hash ${contentHash}`;
}

// Inserts the header comment right after a leading shebang (if present) so
// `install.sh` still executes correctly — a shebang must be the file's
// first line — otherwise prepends it.
export function withProvenanceHeader(source: string, headerLine: string): string {
  const lines = source.split("\n");
  if (lines[0]?.startsWith("#!")) {
    return [lines[0], headerLine, ...lines.slice(1)].join("\n");
  }
  return [headerLine, source].join("\n");
}

export function isManaged(installShContent: string): boolean {
  return installShContent
    .split("\n")
    .slice(0, 3)
    .some((line) => line.startsWith(MARKER));
}

export function parseProvenance(installShContent: string): Provenance | undefined {
  for (const line of installShContent.split("\n").slice(0, 3)) {
    const m = PROVENANCE_RE.exec(line.trim());
    if (m) return { remote: m[1]!, pathInRepo: m[2]!, contentHash: m[3]! };
  }
  return undefined;
}
