import { shellStore, type ShellStatus } from "../src/shells.js";

/** Poll the shared shellStore until a shell reaches one of the given statuses, or time out. */
export async function waitForShellStatus(
  id: string,
  statuses: ShellStatus[],
  timeoutMs = 2000
): Promise<ReturnType<typeof shellStore.get>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rec = shellStore.get(id);
    if (rec && statuses.includes(rec.status)) return rec;
    if (Date.now() > deadline) {
      throw new Error(`shell ${id} did not reach [${statuses.join(", ")}] within ${timeoutMs}ms (status: ${rec?.status})`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** The plain text of an MCP tool call's first content block. */
export function toolText(result: { content: Array<{ type: string; text?: string }> }): string {
  const text = result.content[0]?.text;
  if (typeof text !== "string") throw new Error("tool result had no text content");
  return text;
}
