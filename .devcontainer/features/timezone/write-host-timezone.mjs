import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Runs on the host (as both the meta.json beforeUp hook and a "custom"
// test): records the host's IANA zone next to install.sh, which reads it
// at build time when the 'timezone' option is empty. Kept out of git by
// this dir's .gitignore.
const here = path.dirname(fileURLToPath(import.meta.url));

// config: the project's resolved devcontainer.json (parsed JSON object).
export default function writeHostTimezone(config) {
  // devcontainer-config may itself run inside a container (e.g. the
  // project's own devcontainer): there Intl reports the container's zone,
  // not the host's — leave whatever the host last recorded alone.
  if (existsSync("/.dockerenv") || existsSync("/run/.containerenv")) return { pass: true };

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone) {
    return { pass: false, message: "could not determine the host's timezone; the container will fall back to UTC" };
  }
  writeFileSync(path.join(here, "host-timezone"), zone + "\n");
  return { pass: true };
}
