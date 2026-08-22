#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runBashHost, runBashHostShape } from "./tools/runBashHost.js";
import { runBashContainer, runBashContainerShape } from "./tools/runBashContainer.js";
import { readFile, readFileShape } from "./tools/readFile.js";
import { writeFile, writeFileShape } from "./tools/writeFile.js";
import { patchFile, patchFileShape } from "./tools/patchFile.js";
import { status, statusShape } from "./tools/status.js";
import { wait, waitShape } from "./tools/wait.js";
import { kill, killShape } from "./tools/kill.js";
import { running, runningShape } from "./tools/running.js";

/** Build the MCP server and register every tool this package exposes. */
function buildServer(): McpServer {
  const server = new McpServer({ name: "claude-split-container", version: "0.1.0" });

  server.registerTool(
    "run_bash_host",
    {
      title: "Run bash on host",
      description:
        "Run a bash command on the HOST machine. Requires human approval via the approval UI. " +
        "stdout/stderr are written to new files in the shared .tmp dir; exit code and file names/sizes are returned.",
      inputSchema: runBashHostShape,
    },
    runBashHost
  );

  server.registerTool(
    "run_bash_container",
    {
      title: "Run bash in devcontainer",
      description:
        "Run a bash command inside the project's devcontainer (shares the project dir with the host). " +
        "No approval needed. Prefer this over run_bash_host whenever possible.",
      inputSchema: runBashContainerShape,
    },
    runBashContainer
  );

  server.registerTool(
    "read_file",
    {
      title: "Read host file",
      description:
        "Copy a host file into the shared .tmp dir so it can be inspected. Requires human approval.",
      inputSchema: readFileShape,
    },
    readFile
  );

  server.registerTool(
    "write_file",
    {
      title: "Write host file",
      description:
        "Write a file on the host, either by copying a file from the shared .tmp dir or from literal " +
        "content. Requires human approval.",
      inputSchema: writeFileShape,
    },
    writeFile
  );

  server.registerTool(
    "patch_file",
    {
      title: "Patch host file",
      description:
        "Apply a unified diff to a host file, atomically (dry-run checked first, backed up before the " +
        "real apply). Prefer this over write_file for editing existing text files. Requires human approval.",
      inputSchema: patchFileShape,
    },
    patchFile
  );

  server.registerTool(
    "status",
    {
      title: "Command status",
      description: "Non-blocking lookup of the current status/result for one or more command ids.",
      inputSchema: statusShape,
    },
    status
  );

  server.registerTool(
    "wait",
    {
      title: "Wait for a command",
      description: "Block until any of the given command ids finishes or is rejected, or until timeout.",
      inputSchema: waitShape,
    },
    wait
  );

  server.registerTool(
    "kill",
    {
      title: "Kill a command",
      description: "Cancel a pending or running command.",
      inputSchema: killShape,
    },
    kill
  );

  server.registerTool(
    "running",
    {
      title: "List running commands",
      description: "Return the ids of all commands currently running.",
      inputSchema: runningShape,
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
