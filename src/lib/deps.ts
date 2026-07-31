import { featureSourceDir, readMeta } from "./featureSource.js";

export interface ResolvedDep {
  name: string;
  requiredBy?: string;
}

// Recursive dependency walk mirroring vagrant-config.py's add_one() /
// snippet_deps(): each requested name pulls in its meta.json `deps`
// transitively, dependencies-before-dependents, each name appearing once
// (first requirement wins for the `requiredBy` annotation).
export function resolveDeps(names: string[]): ResolvedDep[] {
  const seen = new Set<string>();
  const visiting = new Set<string>();
  const order: ResolvedDep[] = [];

  function addOne(name: string, requiredBy?: string): void {
    if (seen.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`dependency cycle involving ${name.length ? name : "<unknown>"}`);
    }
    visiting.add(name);

    const dir = featureSourceDir(name); // throws if unknown
    const meta = readMeta(dir);
    for (const dep of meta.deps ?? []) {
      addOne(dep, name);
    }

    visiting.delete(name);
    seen.add(name);
    order.push({ name, requiredBy });
  }

  for (const name of names) addOne(name);
  return order;
}
