import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse as parseJsonc, modify, applyEdits, type ParseError, printParseErrorCode } from "jsonc-parser";
import type { DevcontainerJson } from "./types.js";
import { DEVCONTAINER_JSON } from "./paths.js";

const FORMATTING_OPTIONS = { tabSize: 2, insertSpaces: true, eol: "\n" };

export function devcontainerJsonExists(): boolean {
  return existsSync(DEVCONTAINER_JSON);
}

function parseText(text: string): DevcontainerJson {
  const errors: ParseError[] = [];
  const config = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) {
    const first = errors[0]!;
    throw new Error(`${DEVCONTAINER_JSON}: ${printParseErrorCode(first.error)} at offset ${first.offset}`);
  }
  return config;
}

export function readDevcontainerJson(): DevcontainerJson {
  if (!existsSync(DEVCONTAINER_JSON)) {
    throw new Error(`${DEVCONTAINER_JSON} not found — run 'devcontainer-config init' first`);
  }
  return parseText(readFileSync(DEVCONTAINER_JSON, "utf8"));
}

// Plain overwrite — only for init's from-scratch scaffold, where there's no
// existing file (hence no comments/formatting) to lose. Any flow that edits
// an *existing* devcontainer.json must go through DevcontainerDocument
// below instead, so user comments/formatting survive the edit.
export function writeDevcontainerJson(config: DevcontainerJson): void {
  writeFileSync(DEVCONTAINER_JSON, JSON.stringify(config, null, 2) + "\n");
}

// A loaded devcontainer.json kept as source text, mutated via jsonc-parser's
// modify()+applyEdits() (surgical text edits) rather than
// parse-mutate-restringify — so comments and formatting outside the
// touched region survive.
export class DevcontainerDocument {
  #text: string;

  constructor(text: string) {
    this.#text = text;
  }

  get config(): DevcontainerJson {
    return parseText(this.#text);
  }

  get text(): string {
    return this.#text;
  }

  #edit(path: (string | number)[], value: unknown): void {
    const edits = modify(this.#text, path, value, { formattingOptions: FORMATTING_OPTIONS });
    this.#text = applyEdits(this.#text, edits);
  }

  setFeatureOptions(ref: string, options: Record<string, unknown>): void {
    this.#edit(["features", ref], options);
  }

  removeFeature(ref: string): void {
    this.#edit(["features", ref], undefined);
  }
}

export function loadDevcontainerDocument(): DevcontainerDocument {
  if (!existsSync(DEVCONTAINER_JSON)) {
    throw new Error(`${DEVCONTAINER_JSON} not found — run 'devcontainer-config init' first`);
  }
  return new DevcontainerDocument(readFileSync(DEVCONTAINER_JSON, "utf8"));
}

export function writeDevcontainerDocument(doc: DevcontainerDocument): void {
  writeFileSync(DEVCONTAINER_JSON, doc.text);
}

// All of these take the devcontainer.json features-map *key* directly
// (a local "./features/<name>" path or an external OCI ref) rather than
// our internal short name — callers compute the right key via
// featureSource.ts's featureRefFor(name, meta), since which one applies
// depends on whether the feature is local or external.

export function isFeatureInstalled(config: DevcontainerJson, ref: string): boolean {
  return Boolean(config.features && ref in config.features);
}

export function getFeatureOptions(config: DevcontainerJson, ref: string): Record<string, unknown> {
  return config.features?.[ref] ?? {};
}
