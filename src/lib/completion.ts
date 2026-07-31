import { writeSync } from "node:fs";

// Implements the wire side of argcomplete's *global* completion hook
// (activate-global-python-argcomplete's `_python_argcomplete_global`,
// language-agnostic despite the name — it just greps the first 1KB of
// whatever executable is being completed for the "PYTHON_ARGCOMPLETE_OK"
// magic string, stamped into dist/devcontainer-config's banner at build
// time, then re-invokes that same executable instead of running it
// normally). Protocol taken from the hook's own source, since there is no
// spec doc and no existing Node port:
// https://github.com/kislyuk/argcomplete/blob/main/argcomplete/bash_completion.d/_python-argcomplete
//
// On a completion request the hook sets _ARGCOMPLETE plus COMP_LINE/
// COMP_POINT (the typed command line and cursor offset), redirects our
// stdout/stderr to /dev/null, and expects candidates written to fd 8,
// joined by \013 (its hardcoded IFS for splitting the result back into an
// array) — then reads our exit code: nonzero and it discards whatever we
// wrote and falls back to filename completion.
const ARGCOMPLETE_IFS = "\x0b";

export interface CompletionSubcommand {
  name: string;
  options?: string[];
  // "none": no positional args (init, check). "single": at most one (config
  // takes one optional feature name). "variadic": any number (add, update).
  positionals?: "none" | "single" | "variadic";
}

export interface CompletionSpec {
  subcommands: CompletionSubcommand[];
}

// Called unconditionally near the top of cli.ts, before any real argument
// parsing. No-op (returns normally) unless _ARGCOMPLETE is set, i.e. unless
// we're being invoked by the shell hook rather than by a user directly —
// in that case it never returns, per the protocol above.
export function tryHandleCompletion(spec: CompletionSpec, featureNames: () => string[]): void {
  if (!process.env._ARGCOMPLETE) return;

  const compLine = process.env.COMP_LINE ?? "";
  const compPoint = Number(process.env.COMP_POINT ?? compLine.length);
  const candidates = computeCompletions(spec, featureNames, compLine.slice(0, compPoint));

  writeSync(8, candidates.join(ARGCOMPLETE_IFS));
  process.exit(0);
}

function splitWords(line: string): string[] {
  return line.split(/\s+/).filter((w) => w.length > 0);
}

// Exported separately from tryHandleCompletion so it's testable without
// faking fd 8 / env vars / process.exit.
export function computeCompletions(spec: CompletionSpec, featureNames: () => string[], lineUpToCursor: string): string[] {
  const endsWithSpace = /\s$/.test(lineUpToCursor);
  const words = splitWords(lineUpToCursor);
  const args = words.slice(1); // words[0] is the program name itself
  const current = endsWithSpace ? "" : (args.pop() ?? "");

  if (args.length === 0) {
    return spec.subcommands.map((s) => s.name).filter((n) => n.startsWith(current));
  }

  const sub = spec.subcommands.find((s) => s.name === args[0]);
  if (!sub) return [];

  const positionals = sub.positionals ?? "none";
  const canPositional =
    positionals === "variadic" || (positionals === "single" && !args.slice(1).some((a) => !a.startsWith("-")));

  // Concat unconditionally rather than branching on current's shape: prefix
  // filtering alone already excludes options when current is a feature-name
  // prefix (no option starts with a non-'-' char) and excludes feature names
  // when current is "-..." (no feature name starts with '-').
  const optionMatches = (sub.options ?? []).filter((o) => o.startsWith(current));
  const positionalMatches = canPositional ? featureNames().filter((n) => n.startsWith(current)) : [];
  return [...optionMatches, ...positionalMatches];
}
