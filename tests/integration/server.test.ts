/**
 * Integration tests for the MCP server entry point.
 *
 * These tests spawn the compiled server as a child process and communicate
 * with it over stdio using the MCP SDK's Client + StdioClientTransport.
 *
 * HTTP mocking uses a real node:http server (msw only intercepts in-process
 * and cannot reach a child process).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOCK_PORT = 19283;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../../dist/index.js");
const TEST_API_KEY = "sk_integration_test_key";

// ---------------------------------------------------------------------------
// Mock gateway (real HTTP server, responds with canned JSON)
// ---------------------------------------------------------------------------

function createMockGateway(): HttpServer {
  return createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    const url = req.url ?? "";
    const method = req.method ?? "GET";

    // GET /api/v1/projects — list flows
    if (
      method === "GET" &&
      url.startsWith("/api/v1/projects") &&
      !url.match(/\/api\/v1\/projects\/[^/]+/)
    ) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          data: [
            {
              ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
              Title: "Test Flow",
              CreatedAt: "2026-01-01T00:00:00Z",
              UpdatedAt: "2026-01-02T00:00:00Z",
              BlockCount: 2,
              BlockTypes: ["start", "goToUrl"],
            },
          ],
          pagination: { total: 1, limit: 20, offset: 0, has_more: false },
        }),
      );
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: "not_found", message: "Not found." } }));
  });
}

// ---------------------------------------------------------------------------
// Test setup/teardown
// ---------------------------------------------------------------------------

let mockServer: HttpServer;

beforeAll(async () => {
  mockServer = createMockGateway();
  await new Promise<void>((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(MOCK_PORT, "127.0.0.1", resolve);
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    mockServer.close((err) => (err ? reject(err) : resolve()));
  });
});

// Each test gets its own client/transport so we can cleanly close between tests
let client: Client;
let transport: StdioClientTransport;

beforeEach(async () => {
  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      SCRAPEER_API_KEY: TEST_API_KEY,
      SCRAPEER_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    },
    stderr: "pipe",
  });

  client = new Client({ name: "test-client", version: "0.0.1" });
  await client.connect(transport);
});

afterEach(async () => {
  await client.close().catch(() => {});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP server integration", () => {
  it("connects and initializes successfully", async () => {
    const version = client.getServerVersion();
    expect(version).toBeDefined();
    expect(version?.name).toBe("scrapeer");
    expect(version?.version).toBe("0.1.0");
  });

  it("tools/list returns all registered tools", async () => {
    const result = await client.listTools();
    expect(result.tools).toHaveLength(15);

    const names = result.tools.map((t) => t.name);
    // Read/run/account tools (shipped earlier)
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
    // Flow mutation tools
    expect(names).toContain("scrapeer_get_block_catalog");
    expect(names).toContain("scrapeer_validate_flow");
    expect(names).toContain("scrapeer_create_flow");
    expect(names).toContain("scrapeer_update_flow");
    expect(names).toContain("scrapeer_patch_flow");
  });

  it("scrapeer_list_flows returns flows from mock gateway", async () => {
    const result = await client.callTool({
      name: "scrapeer_list_flows",
      arguments: {},
    });

    // Result should be non-error
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);

    const content = result.content[0];
    expect(content.type).toBe("text");
    const parsed = JSON.parse((content as { type: "text"; text: string }).text);

    expect(parsed.flows).toHaveLength(1);
    expect(parsed.flows[0].id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(parsed.flows[0].title).toBe("Test Flow");
    expect(parsed.total).toBe(1);
    expect(parsed.has_more).toBe(false);
  });

  it("unknown tool name returns an isError response", async () => {
    const result = await client.callTool({
      name: "scrapeer_nonexistent_tool",
      arguments: {},
    });

    // The SDK returns an error content block rather than throwing
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("scrapeer_nonexistent_tool");
  });
});
