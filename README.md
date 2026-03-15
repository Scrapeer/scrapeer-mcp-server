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

| Tool | Description |
|------|-------------|
| `scrapeer_list_flows` | List your saved scraping flows |
| `scrapeer_get_flow` | Get details about a specific flow |
| `scrapeer_run_flow` | Trigger a cloud run and return immediately with an execution ID |
| `scrapeer_run_flow_and_wait` | Run a flow and poll until results are ready (recommended) |
| `scrapeer_get_run_status` | Check the status of a running or completed execution |
| `scrapeer_get_run_results` | Get structured output data from a completed run |
| `scrapeer_get_run_steps` | Get block-by-block execution breakdown (useful for debugging failures) |
| `scrapeer_list_runs` | List execution history, with optional filtering by status or flow |
| `scrapeer_cancel_run` | Cancel an active cloud execution |

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
