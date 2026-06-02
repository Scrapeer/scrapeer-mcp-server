/**
 * Integration tests for the MCP server entry point.
 *
 * These tests spawn the compiled server through the official MCP stdio client
 * transport. HTTP request behavior is covered by unit tests against
 * ScrapeerClient.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../dist/index.js");
const TEST_API_KEY = "sk_integration_test_key";

let client: Client | null = null;
let stderr = "";

function childEnv(): Record<string, string> {
  return {
    ...process.env,
    SCRAPEER_API_KEY: TEST_API_KEY,
  };
}

async function connectClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: childEnv(),
    stderr: "pipe",
  });

  transport.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  client = new Client(
    { name: "integration-test", version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

beforeEach(() => {
  stderr = "";
  client = null;
});

afterEach(async () => {
  if (client) {
    await client.close();
  }
});

describe("MCP server integration", () => {
  it("connects and initializes successfully", async () => {
    const connected = await connectClient();
    const serverVersion = connected.getServerVersion();

    expect(serverVersion?.name).toBe("scrapeer");
    expect(serverVersion?.version).toBe("0.1.1");
    expect(stderr).toBe("");
  });

  it("tools/list returns all registered tools", async () => {
    const connected = await connectClient();
    const result = await connected.listTools();

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
    const connected = await connectClient();
    const result = await connected.callTool({
      name: "scrapeer_nonexistent_tool",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("scrapeer_nonexistent_tool");
  });
});
