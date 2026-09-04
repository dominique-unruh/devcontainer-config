#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runBashContainer, runBashContainerShape } from "./tools/runBashContainer.js";
import { status, statusShape } from "./tools/status.js";
import { wait, waitShape } from "./tools/wait.js";
import { kill, killShape } from "./tools/kill.js";
import { running, runningShape } from "./tools/running.js";

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
        "host-only and gated.",
      inputSchema: runBashContainerShape,
      annotations: { title: "container bash", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    runBashContainer
  );

  server.registerTool(
    "status",
    {
      title: "Command status",
      description: "Non-blocking lookup of the current status/result for one or more command ids.",
      inputSchema: statusShape,
      annotations: { title: "command status", readOnlyHint: true },
    },
    status
  );

  server.registerTool(
    "wait",
    {
      title: "Wait for a command",
      description: "Block until any of the given command ids finishes or is rejected, or until timeout.",
      inputSchema: waitShape,
      annotations: { title: "wait for command", readOnlyHint: true },
    },
    wait
  );

  server.registerTool(
    "kill",
    {
      title: "Kill a command",
      description: "Cancel a pending or running command.",
      inputSchema: killShape,
      annotations: { title: "kill command", readOnlyHint: false, destructiveHint: true },
    },
    kill
  );

  server.registerTool(
    "running",
    {
      title: "List running commands",
      description: "Return the ids of all commands currently running.",
      inputSchema: runningShape,
      annotations: { title: "list running commands", readOnlyHint: true },
    },
    running
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
