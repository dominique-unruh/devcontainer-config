// Shapes shared across commands. Kept minimal — only the fields we read/write.

import type { Provenance } from "./provenance.js";

export interface FeatureOptionSchema {
  type: "boolean" | "string";
  description?: string;
  default?: boolean | string;
  enum?: string[];
  proposals?: string[];
}

export interface DevcontainerFeatureJson {
  id: string;
  version?: string;
  name?: string;
  description?: string;
  options?: Record<string, FeatureOptionSchema>;
  dependsOn?: Record<string, Record<string, unknown>>;
  installsAfter?: string[];
  onCreateCommand?: string | string[];
  postCreateCommand?: string | string[];
  postStartCommand?: string | string[];
  postAttachCommand?: string | string[];
  updateContentCommand?: string | string[];
}

export type TestSpec =
  | { kind: "incompatibleWith"; feature: string; message?: string }
  | {
      kind: "dependsOnOptions";
      feature: string;
      options: Record<string, unknown>;
      message?: string;
    }
  | { kind: "custom"; script: string; message?: string };

// A feature is "external" (a public/OCI-published feature we don't own
// install.sh for) when this is set. We still vendor a meta.json for it —
// deps/tests/options for our own tooling — but `add`/`config` write `ref`
// itself into devcontainer.json's features map instead of a local
// "./features/<name>" path, and never touch install.sh/devcontainer-
// feature.json (they don't exist locally; the registry owns them).
export interface ExternalFeatureRef {
  ref: string;
  description?: string;
  options?: Record<string, FeatureOptionSchema>;
}

export interface FeatureMeta {
  deps?: string[];
  tests?: TestSpec[];
  external?: ExternalFeatureRef;
  // Only present on a *vendored* copy (never in the source repo's own
  // meta.json) — where install.sh's provenance-comment trick doesn't
  // apply because there is no install.sh for an external feature.
  provenance?: Provenance;
}

export interface TestResult {
  featureName: string;
  test: TestSpec;
  pass: boolean;
  message?: string;
}

export interface DevcontainerJson {
  image?: string;
  remoteUser?: string;
  features?: Record<string, Record<string, unknown>>;
  hostRequirements?: Record<string, unknown>;
  runArgs?: string[];
  overrideFeatureInstallOrder?: string[];
  customizations?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CustomValidator {
  (config: DevcontainerJson): { pass: boolean; message?: string } | Promise<{ pass: boolean; message?: string }>;
}
