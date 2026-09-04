#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runBashContainer, runBashContainerShape } from "./tools/runBashContainer.js";
import { bashOutput, bashOutputShape } from "./tools/bashOutput.js";
import { killShell, killShellShape } from "./tools/killShell.js";
import { wait, waitShape } from "./tools/wait.js";
import { listBackgroundRunning, listBackgroundRunningShape } from "./tools/listBackgroundRunning.js";

/** Build the MCP server and register every tool this package exposes. */
function buildServer(): McpServer {
  const server = new McpServer({ name: "claude-split-container", version: "0.1.0" });

  server.registerTool(
    "run_bash_container",
    {
      title: "container bash",
      description:
        "Run a bash command inside the project's devcontainer (shares the project dir with the host). " +
        "No approval needed. This is the default way to run shell commands; the built-in Bash tool is " +
        "host-only and gated. Mirrors the built-in Bash tool: optional `timeout` (ms), and " +
        "`run_in_background` to return a shell id you read from with bash_output.",
      inputSchema: runBashContainerShape,
      annotations: { title: "container bash", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    runBashContainer
  );

  server.registerTool(
    "bash_output",
    {
      title: "Read background shell output",
      description:
        "Retrieve output from a background shell started by run_bash_container. Returns only new output " +
        "since the last read, plus the shell's status and (once exited) its exit code. Mirrors the " +
        "built-in BashOutput tool.",
      inputSchema: bashOutputShape,
      annotations: { title: "read background shell output", readOnlyHint: true },
    },
    bashOutput
  );

  server.registerTool(
    "kill_shell",
    {
      title: "Kill a background shell",
      description: "Kill a running background shell by its id. Mirrors the built-in KillShell tool.",
      inputSchema: killShellShape,
      annotations: { title: "kill background shell", readOnlyHint: false, destructiveHint: true },
    },
    killShell
  );

  server.registerTool(
    "wait",
    {
      title: "Wait for a background shell",
      description:
        "Block until a background shell finishes (or the given timeout in ms elapses), then report its " +
        "status and exit code. The MCP alternative to polling bash_output, since (unlike the built-in " +
        "Bash tools) this server can't auto-notify on completion.",
      inputSchema: waitShape,
      annotations: { title: "wait for background shell", readOnlyHint: true },
    },
    wait
  );

  server.registerTool(
    "list_background_running",
    {
      title: "List running background shells",
      description: "List the background shells (started with run_bash_container run_in_background) still running.",
      inputSchema: listBackgroundRunningShape,
      annotations: { title: "list running background shells", readOnlyHint: true },
    },
    listBackgroundRunning
  );

  return server;
}

async function main() {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
