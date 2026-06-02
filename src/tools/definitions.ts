import {
  listFlowsInput,
  getFlowInput,
  getAccountInput,
  runFlowInput,
  runFlowAndWaitInput,
  executionIdInput,
  listRunsInput,
  getBlockCatalogInput,
  validateFlowInput,
  createFlowInput,
  updateFlowInput,
  patchFlowInput,
} from "./schemas.js";

export const toolDefinitions = [
  {
    name: "scrapeer_list_flows",
    description:
      "List your saved scraping flows. " +
      "USE THIS TOOL WHEN: you need to find a flow ID, the user says \"list my flows/scrapers\", or you need to discover available flows before running one. " +
      "DO NOT USE: to get details about a specific flow (use scrapeer_get_flow).",
    inputSchema: listFlowsInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_get_flow",
    description:
      "Get details about a specific scraping flow - its blocks (with full config, selectors, and variables), edges, and metadata. " +
      "Accepts either a flow ID (UUID) or a flow name. " +
      "NOTE: Only blocks reachable from the Start block are returned. Orphaned/disconnected blocks on the canvas are pruned. " +
      "USE THIS TOOL WHEN: you know which flow you want details about (by name or ID), you need to inspect selectors or block config, or you're debugging a flow. " +
      "DO NOT USE: to list all flows (use scrapeer_list_flows).",
    inputSchema: getFlowInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_run_flow",
    description:
      "Trigger a cloud run of a scraping flow. Returns immediately with an execution ID. " +
      "Accepts either a flow ID (UUID) or a flow name. " +
      "USE THIS TOOL WHEN: you want to start a run and manage polling yourself, or you want to trigger multiple runs in parallel. " +
      "DO NOT USE: if you want results in one call (use scrapeer_run_flow_and_wait instead). " +
      "The run executes in the cloud and typically takes 30s-5min.",
    inputSchema: runFlowInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "scrapeer_run_flow_and_wait",
    description:
      "Execute a scraping flow and wait for results. This is the recommended way to run flows. " +
      "Accepts either a flow ID (UUID) or a flow name. " +
      "USE THIS TOOL WHEN: user says \"run my scraper\", \"scrape X\", \"execute my flow\", or you need data from a pre-built flow. " +
      "DO NOT USE: to check status of an already-running flow (use scrapeer_get_run_status), " +
      "to list available flows (use scrapeer_list_flows first to find the flow). " +
      "Triggers a cloud run, polls until complete, returns structured results. " +
      "Runs typically take 30s-5min. Each run costs credits.",
    inputSchema: runFlowAndWaitInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "scrapeer_get_run_status",
    description:
      "Check the status of a cloud run. " +
      "USE THIS TOOL WHEN: you started a run with scrapeer_run_flow and need to check if it's done, " +
      "or you're monitoring a run that was started elsewhere (web app, schedule). " +
      "DO NOT USE: to get results (use scrapeer_get_run_results after status is \"completed\").",
    inputSchema: executionIdInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_get_run_results",
    description:
      "Get the variables and per-block output previews from a completed run. " +
      "USE THIS TOOL WHEN: scrapeer_get_run_status shows \"completed\" and you need the scraped output. " +
      "DO NOT USE: if the run is still active (check status first). " +
      "Returns the final variables map (scraped values written by Extract/Collect/Variable blocks) " +
      "and block_previews - one envelope per block at the (blockId, loopContextHash) grain. " +
      "Each envelope is {kind:\"single\", data, truncated} for non-looped blocks or " +
      "{kind:\"iterated\", iterations:[...], iterationsTruncated} for blocks that ran inside a loop. " +
      "Subscription tier controls preview availability: Free tier returns empty block_previews.",
    inputSchema: executionIdInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_get_run_steps",
    description:
      "Get block-by-block execution breakdown of a run. " +
      "USE THIS TOOL WHEN: a run failed and you need to know which block caused the error, " +
      "or you want to understand execution timing, or you want to see which blocks have preview envelopes before calling scrapeer_get_run_results. " +
      "DO NOT USE: to get the actual scraped values (use scrapeer_get_run_results). " +
      "Each step includes has_preview - true when that block produced an envelope the detail endpoint is carrying.",
    inputSchema: executionIdInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_list_runs",
    description:
      "List execution history. " +
      "USE THIS TOOL WHEN: user asks about past runs, wants to see execution history, or you need to find a specific run. " +
      "Supports filtering by status and flow. " +
      "DO NOT USE: to get details of a specific run (use scrapeer_get_run_status or scrapeer_get_run_results).",
    inputSchema: listRunsInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_cancel_run",
    description:
      "Cancel a running cloud execution. " +
      "USE THIS TOOL WHEN: a run is taking too long, the user wants to stop it, " +
      "or scrapeer_run_flow_and_wait timed out and you want to abort the run. " +
      "DO NOT USE: on already-completed or already-failed runs.",
    inputSchema: executionIdInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_get_account",
    description:
      "Get your Scrapeer account info - credit balance, subscription plan, and whether cloud runs are enabled. " +
      "USE THIS TOOL WHEN: you need to check if the user has enough credits before running a flow, " +
      "or the user asks about their plan, balance, or account status. " +
      "DO NOT USE: to list flows or runs.",
    inputSchema: getAccountInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_get_block_catalog",
    description:
      "List the block types available for use in flows, with their custom-field schemas. " +
      "USE THIS TOOL WHEN: you are about to create or modify a flow and need to know which block types exist, what their type strings are (e.g. `clickElement`, `extractText`), and what config fields each block accepts. " +
      "ALWAYS call this BEFORE scrapeer_create_flow, scrapeer_update_flow, or scrapeer_patch_flow - guessing block types or config keys leads to validation failures. " +
      "DO NOT USE: to read an existing flow's blocks (use scrapeer_get_flow).",
    inputSchema: getBlockCatalogInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_validate_flow",
    description:
      "Dry-run validate a flow without saving it. " +
      "USE THIS TOOL WHEN: you've constructed a flow and want to check whether it will be accepted by the gateway before calling scrapeer_create_flow / scrapeer_update_flow. " +
      "Returns { ok, errors[], warnings[] }. Errors block save; warnings are advisory. " +
      "DO NOT USE: to validate a stored flow (no persistent flow lookup - pass the flow JSON directly).",
    inputSchema: validateFlowInput,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: "scrapeer_create_flow",
    description:
      "Create a new (empty) flow with the given title. " +
      "Returns the new flow's ID. Use scrapeer_update_flow or scrapeer_patch_flow afterwards to add blocks. " +
      "USE THIS TOOL WHEN: the user asks to create a new automation/scraper. " +
      "DO NOT USE: to overwrite an existing flow's data (use scrapeer_update_flow with the existing flow's ID).",
    inputSchema: createFlowInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
  },
  {
    name: "scrapeer_update_flow",
    description:
      "Replace a flow's entire definition with the supplied flow JSON. " +
      "WARNING: this overwrites the WHOLE flow - every block, edge, and config. " +
      "PREFER scrapeer_patch_flow for incremental edits (adding a block, changing one selector). " +
      "USE THIS TOOL WHEN: you need to apply a wholesale rewrite (e.g. importing a flow from elsewhere) or the change touches most of the flow at once. " +
      "Always call scrapeer_get_block_catalog first to know valid block types and config keys, and consider scrapeer_validate_flow to dry-run. " +
      "Optimistic concurrency: the MCP server automatically attaches the version stamp from your last scrapeer_get_flow on this flow. If the flow was modified elsewhere since, the call returns 409 - re-fetch with scrapeer_get_flow and retry.",
    inputSchema: updateFlowInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
  {
    name: "scrapeer_patch_flow",
    description:
      "Apply a list of granular patch operations to a flow's graph: add_block, update_block_custom, remove_block, add_edge, remove_edge. " +
      "PREFERRED over scrapeer_update_flow for incremental edits - smaller blast radius and validated per-op server-side. " +
      "USE THIS TOOL WHEN: making targeted changes (adding a block to an existing flow, fixing a selector, rewiring an edge). " +
      "DO NOT USE: when the change touches most of the flow at once (use scrapeer_update_flow). " +
      "Always call scrapeer_get_block_catalog first; ALWAYS call scrapeer_get_flow on this flow earlier in the session so the MCP server can attach the version stamp for optimistic concurrency. " +
      "Returns the post-patch flow plus a summary of each operation's effect.",
    inputSchema: patchFlowInput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
  },
] as const;
