#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ScrapeerClient } from "./client.js";
import { toolDefinitions } from "./tools/definitions.js";
import { createHandlers } from "./tools/handlers.js";

const API_KEY = process.env.SCRAPEER_API_KEY;
const BASE_URL = "https://auth.scrapeer.com";

if (!API_KEY) {
  process.stderr.write(
    "Error: SCRAPEER_API_KEY environment variable is required.\n" +
      "Generate one at https://app.scrapeer.com/settings\n\n" +
      "Usage:\n" +
      "  SCRAPEER_API_KEY=sk_... npx -y @scrapeer/mcp-server\n",
  );
  process.exit(1);
}

const client = new ScrapeerClient(API_KEY, BASE_URL);
const handlers = createHandlers(client);

// Map tool names (snake_case) to handler keys (camelCase)
const TOOL_TO_HANDLER: Record<string, keyof typeof handlers> = {
  scrapeer_list_flows: "listFlows",
  scrapeer_get_flow: "getFlow",
  scrapeer_get_account: "getAccount",
  scrapeer_run_flow: "runFlow",
  scrapeer_run_flow_and_wait: "runFlowAndWait",
  scrapeer_get_run_status: "getRunStatus",
  scrapeer_get_run_results: "getRunResults",
  scrapeer_get_run_steps: "getRunSteps",
  scrapeer_list_runs: "listRuns",
  scrapeer_cancel_run: "cancelRun",
  scrapeer_get_block_catalog: "getBlockCatalog",
  scrapeer_validate_flow: "validateFlow",
  scrapeer_create_flow: "createFlow",
  scrapeer_update_flow: "updateFlow",
  scrapeer_patch_flow: "patchFlow",
};

const server = new McpServer({
  name: "scrapeer",
  version: "0.1.1",
});

// Register all tools
for (const def of toolDefinitions) {
  const handlerKey = TOOL_TO_HANDLER[def.name];
  if (!handlerKey) {
    process.stderr.write(`No handler for tool: ${def.name}\n`);
    continue;
  }

  const handler = handlers[handlerKey];

  server.tool(
    def.name,
    def.description,
    def.inputSchema.shape,
    def.annotations,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (args: any) => handler(args),
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);

process.stdin.resume();
// Keep the stdio server alive until the MCP client terminates the process.
const keepAlive = setInterval(() => undefined, 1_000_000_000);
const shutdown = () => {
  clearInterval(keepAlive);
  void server.close().finally(() => process.exit(0));
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
