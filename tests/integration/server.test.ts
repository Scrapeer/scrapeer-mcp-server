/**
 * Integration tests for the MCP server entry point.
 *
 * These tests spawn the compiled server as a child process and communicate
 * with it over newline-delimited JSON-RPC on stdio. HTTP request behavior is
 * covered by unit tests against ScrapeerClient.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../dist/index.js");
const TEST_API_KEY = "sk_integration_test_key";

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

let child: ChildProcessWithoutNullStreams;
let stderr = "";
let buffer = "";
let messages: JsonRpcMessage[] = [];
let waiters: Array<{
  predicate: (message: JsonRpcMessage) => boolean;
  resolve: (message: JsonRpcMessage) => void;
}> = [];

function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SCRAPEER_API_KEY: TEST_API_KEY,
  };
}

function handleMessage(message: JsonRpcMessage): void {
  messages.push(message);
  const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
  if (waiterIndex === -1) return;

  const [waiter] = waiters.splice(waiterIndex, 1);
  waiter.resolve(message);
}

function parseStdout(chunk: Buffer): void {
  buffer += chunk.toString("utf8");
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) return;

    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length === 0) continue;

    handleMessage(JSON.parse(line) as JsonRpcMessage);
  }
}

function waitForMessage(
  predicate: (message: JsonRpcMessage) => boolean,
  timeoutMs = 3000,
): Promise<JsonRpcMessage> {
  const existing = messages.find(predicate);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters = waiters.filter((waiter) => waiter.resolve !== resolve);
      reject(new Error(`Timed out waiting for server response. stderr: ${stderr}`));
    }, timeoutMs);

    waiters.push({
      predicate,
      resolve: (message) => {
        clearTimeout(timeout);
        resolve(message);
      },
    });
  });
}

function send(message: JsonRpcMessage): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function initializeServer(): Promise<JsonRpcMessage> {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "integration-test", version: "0.0.1" },
    },
  });

  const response = await waitForMessage((message) => message.id === 1);
  send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
  return response;
}

beforeEach(() => {
  stderr = "";
  buffer = "";
  messages = [];
  waiters = [];

  child = spawn("node", [SERVER_ENTRY], {
    env: childEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout.on("data", parseStdout);
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
});

afterEach(async () => {
  for (const waiter of waiters) {
    waiter.resolve({ jsonrpc: "2.0" });
  }
  waiters = [];

  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1000);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
});

describe("MCP server integration", () => {
  it("connects and initializes successfully", async () => {
    const response = await initializeServer();
    const result = response.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
    };

    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.serverInfo.name).toBe("scrapeer");
    expect(result.serverInfo.version).toBe("0.1.0");
  });

  it("tools/list returns all registered tools", async () => {
    await initializeServer();
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

    const response = await waitForMessage((message) => message.id === 2);
    const result = response.result as { tools: Array<{ name: string }> };
    expect(result.tools).toHaveLength(15);

    const names = result.tools.map((tool) => tool.name);
    expect(names).toContain("scrapeer_list_flows");
    expect(names).toContain("scrapeer_get_flow");
    expect(names).toContain("scrapeer_run_flow");
    expect(names).toContain("scrapeer_run_flow_and_wait");
    expect(names).toContain("scrapeer_get_run_status");
    expect(names).toContain("scrapeer_get_run_results");
    expect(names).toContain("scrapeer_get_run_steps");
    expect(names).toContain("scrapeer_list_runs");
    expect(names).toContain("scrapeer_cancel_run");
    expect(names).toContain("scrapeer_get_account");
    expect(names).toContain("scrapeer_get_block_catalog");
    expect(names).toContain("scrapeer_validate_flow");
    expect(names).toContain("scrapeer_create_flow");
    expect(names).toContain("scrapeer_update_flow");
    expect(names).toContain("scrapeer_patch_flow");
  });

  it("unknown tool name returns an error response", async () => {
    await initializeServer();
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "scrapeer_nonexistent_tool",
        arguments: {},
      },
    });

    const response = await waitForMessage((message) => message.id === 2);
    const result = response.result as {
      isError: boolean;
      content: Array<{ type: "text"; text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("scrapeer_nonexistent_tool");
  });
});
