# Release Process

Registry name: `com.scrapeer/mcp-server`

The `Publish MCP Server` GitHub Actions workflow publishes both:

- npm package: `@scrapeer/mcp-server`
- official MCP Registry metadata: `com.scrapeer/mcp-server`

## Required Secrets

Configure these GitHub repository secrets:

- `NPM_TOKEN` - npm automation token with publish access to `@scrapeer/mcp-server`
- `MCP_REGISTRY_PRIVATE_KEY` - hex private key used for `mcp-publisher login dns`

Generate the registry private key value from `key.pem` with:

```bash
openssl pkey -in key.pem -noout -text | grep -A3 "priv:" | tail -n +2 | tr -d ' :\n'
```

Do not commit `key.pem`.

## Version Sync

Before publishing, keep these versions in sync:

- `package.json` -> `version`
- `server.json` -> top-level `version`
- `server.json` -> `packages[0].version`
- `src/index.ts` -> `McpServer({ version })`

The release verifier enforces this:

```bash
pnpm run verify:release
```

## Release Flow

```bash
pnpm run verify:release
pnpm test
pnpm run build

git tag v0.1.1
git push origin v0.1.1
```

The workflow runs on `vX.Y.Z` tag pushes, published GitHub releases, or manual dispatch. The tag version must match `package.json`.

If the npm version already exists, the workflow skips npm publish and still syncs `server.json` to the MCP Registry.

## Manual Fallback

```bash
pnpm install
pnpm audit
pnpm test
pnpm run build
pnpm pack --dry-run
pnpm publish --access public

mcp-publisher login dns --domain scrapeer.com --private-key "$MCP_REGISTRY_PRIVATE_KEY"
mcp-publisher validate
mcp-publisher publish
```

The npm package must include `mcpName: "com.scrapeer/mcp-server"` in `package.json`; the value must match `server.json`.
