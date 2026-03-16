import {
  listFlowsInput,
  getFlowInput,
  runFlowInput,
  runFlowAndWaitInput,
  executionIdInput,
  listRunsInput,
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
      "Get details about a specific scraping flow — what blocks it contains, when it was last modified. " +
      "Accepts either a flow ID (UUID) or a flow name. " +
      "USE THIS TOOL WHEN: you know which flow you want details about (by name or ID). " +
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
      "Get structured output data from a completed run. " +
      "USE THIS TOOL WHEN: scrapeer_get_run_status shows \"completed\" and you need the scraped data. " +
      "DO NOT USE: if the run is still active (check status first). " +
      "Returns the extracted data from all data-extraction blocks in the flow.",
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
      "or you want to understand execution timing. " +
      "DO NOT USE: to get scraped data (use scrapeer_get_run_results).",
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
] as const;
