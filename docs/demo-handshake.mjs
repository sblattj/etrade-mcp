#!/usr/bin/env node
// Minimal MCP stdio client: sends `initialize` + `tools/list` to a running
// MCP server binary and prints the server info + the resulting tool list.
//
// Useful on its own — a zero-dependency way to sanity-check any MCP stdio
// server (not just etrade-mcp) without pulling in a full client SDK or an
// AI assistant. Also what generates the handshake shown in docs/demo.gif.
//
// Usage:
//   node docs/demo-handshake.mjs [command] [...args]
//
// Defaults to `etrade-mcp` (the installed bin) with no args. Example:
//   node docs/demo-handshake.mjs
//   node docs/demo-handshake.mjs node dist/mcp.js

import { spawn } from "node:child_process";

const [cmd = "etrade-mcp", ...args] = process.argv.slice(2);

const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });

/** @type {Record<string, any>} */
const responses = {};
let buf = "";

child.stdout.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let idx = buf.indexOf("\n");
  while (idx !== -1) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) responses[msg.id] = msg;
      } catch {
        // Not a JSON-RPC line (e.g. stray server log) — ignore.
      }
    }
    idx = buf.indexOf("\n");
  }
});

child.on("error", (err) => {
  console.error(`Failed to start "${cmd}": ${err.message}`);
  process.exit(1);
});

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

// 1. initialize — the handshake every MCP client performs before anything else.
send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "demo-handshake", version: "1.0.0" },
  },
});

// 2. notifications/initialized + tools/list — once initialize resolves, ask
// the server what tools it registered. Poll for the initialize response
// instead of a fixed sleep so this stays reliable under load.
function afterInitialize() {
  if (!responses[1]) {
    setTimeout(afterInitialize, 25);
    return;
  }
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  waitForToolsList();
}

function waitForToolsList() {
  if (!responses[2]) {
    setTimeout(waitForToolsList, 25);
    return;
  }
  report();
}

function report() {
  const init = responses[1]?.result;
  const list = responses[2]?.result;
  const tools = list?.tools ?? [];

  console.log(`server: ${init?.serverInfo?.name ?? "?"} v${init?.serverInfo?.version ?? "?"}`);
  console.log(`tools (${tools.length}):`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}`);
  }

  child.kill();
  process.exit(0);
}

afterInitialize();

// Fail loudly instead of hanging the terminal forever if the server never
// answers (e.g. missing credentials it needs just to boot).
setTimeout(() => {
  console.error("Timed out waiting for the server to respond.");
  child.kill();
  process.exit(1);
}, 5000);
