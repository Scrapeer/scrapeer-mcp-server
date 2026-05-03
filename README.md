# @scrapeer/mcp-server

MCP server for Scrapeer — lets AI agents trigger, monitor, and retrieve results from scraping flows.

## Quick Start

### Claude Code (`~/.claude.json`)

```json
{
  "mcpServers": {
    "scrapeer": {
      "command": "pnpx",
      "args": ["-y", "@scrapeer/mcp-server"],
      "env": { "SCRAPEER_API_KEY": "sk_..." }
    }
  }
}
```

### Cursor (`~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "scrapeer": {
      "command": "pnpx",
      "args": ["-y", "@scrapeer/mcp-server"],
      "env": { "SCRAPEER_API_KEY": "sk_..." }
    }
  }
}
```

### VS Code Copilot (`.vscode/mcp.json`)

```json
{
  "servers": {
    "scrapeer": {
      "type": "stdio",
      "command": "pnpx",
      "args": ["-y", "@scrapeer/mcp-server"],
      "env": { "SCRAPEER_API_KEY": "sk_..." }
    }
  }
}
```

Generate your API key at [app.scrapeer.com/settings](https://app.scrapeer.com/settings).

## Available Tools

### Read

| Tool | Description |
|------|-------------|
| `scrapeer_list_flows` | List your saved scraping flows |
| `scrapeer_get_flow` | Get details about a specific flow |
| `scrapeer_get_block_catalog` | List the block types available for use in flows, with their custom-field schemas. Call this before any create/update/patch — guessing types or config keys leads to validation failures |
| `scrapeer_validate_flow` | Dry-run validate a flow JSON without saving |
| `scrapeer_get_account` | Account info — credit balance, subscription plan, cloud-run availability |

### Run

| Tool | Description |
|------|-------------|
| `scrapeer_run_flow` | Trigger a cloud run and return immediately with an execution ID |
| `scrapeer_run_flow_and_wait` | Run a flow and poll until results are ready (recommended) |
| `scrapeer_get_run_status` | Check the status of a running or completed execution |
| `scrapeer_get_run_results` | Get structured output data from a completed run |
| `scrapeer_get_run_steps` | Get block-by-block execution breakdown (useful for debugging failures) |
| `scrapeer_list_runs` | List execution history, with optional filtering by status or flow |
| `scrapeer_cancel_run` | Cancel an active cloud execution |

### Mutate

| Tool | Description |
|------|-------------|
| `scrapeer_create_flow` | Create a new (empty) flow with the given title |
| `scrapeer_update_flow` | Replace a flow's entire definition (whole-flow overwrite). Prefer `scrapeer_patch_flow` for incremental edits |
| `scrapeer_patch_flow` | Apply granular patch operations: add_block, update_block_custom, remove_block, add_edge, remove_edge |

### Building flows: recommended sequence

The mutation tools enforce **optimistic concurrency** — every save sends the version stamp the caller saw on its last read, and the gateway rejects stale writes with 409 so concurrent edits from a human in the editor and an LLM via MCP can't silently overwrite each other. The MCP server tracks this version stamp automatically across calls in the same session, so the LLM doesn't have to manage it manually.

Typical sequences:

**Create from scratch:**
```
scrapeer_get_block_catalog       → learn valid block types
scrapeer_create_flow             → returns flow_id (event_id cached)
scrapeer_patch_flow flow_id […]  → add_block ops; cache → baseProjectEventID
```

**Modify an existing flow:**
```
scrapeer_get_block_catalog       → learn valid block types
scrapeer_get_flow flow_id        → caches the current event_id
scrapeer_validate_flow {…}       → optional dry-run before commit
scrapeer_patch_flow flow_id […]  → uses cached event_id automatically
```

If a 409 fires, the cached event_id is invalidated automatically — re-call `scrapeer_get_flow` and retry the mutation.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCRAPEER_API_KEY` | Yes | — | API key from app.scrapeer.com/settings |
| `SCRAPEER_BASE_URL` | No | `https://api.scrapeer.com` | Override for self-hosted or staging |

## Development

```bash
pnpm install
pnpm test
pnpm run build
```

Tests use [msw](https://mswjs.io/) to mock the Scrapeer API — no real credentials needed.
