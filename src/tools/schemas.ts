import { z } from "zod";

const paginationSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum number of items to return. Default 20, max 100."),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Number of items to skip for pagination. Default 0."),
};

export const listFlowsInput = z.object(paginationSchema);

// Shared: accepts either a UUID or a flow name (case-insensitive match)
const flowIdentifier = z
  .string()
  .describe(
    "The flow ID (UUID) or flow name. If a name is provided, it will be resolved to an ID. If multiple flows match the name, all matches are returned so the user can choose.",
  );

export const getFlowInput = z.object({
  flow: flowIdentifier,
});

export const runFlowInput = z.object({
  flow: flowIdentifier,
  max_credits: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Maximum credits to spend on this run. The run will fail if the estimated cost exceeds this limit.",
    ),
});

export const runFlowAndWaitInput = z.object({
  flow: flowIdentifier,
  max_credits: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum credits to spend on this run."),
  timeout_seconds: z
    .number()
    .int()
    .min(0)
    .max(600)
    .optional()
    .describe(
      "Maximum seconds to wait for completion. Default 300 (5 min). Set 0 to return immediately after triggering.",
    ),
});

export const executionIdInput = z.object({
  execution_id: z
    .string()
    .uuid()
    .describe(
      "The execution ID returned by scrapeer_run_flow or scrapeer_run_flow_and_wait.",
    ),
});

export const getAccountInput = z.object({});

export const listRunsInput = z.object({
  ...paginationSchema,
  status: z
    .enum(["active", "completed", "failed", "cancelled"])
    .optional()
    .describe("Filter by execution status."),
  flow: z
    .string()
    .optional()
    .describe("Filter runs by flow name or ID. Accepts either a UUID or a flow name."),
});

// ---------------------------------------------------------------------------
// Flow mutation tools
// ---------------------------------------------------------------------------

// Loose flow shape — the LLM constructs a ReactFlowJSON; the gateway's
// validator is the source of truth for what's allowed. Strict typing
// here would just duplicate the catalog.
const flowPayloadSchema = z
  .object({
    nodes: z
      .array(z.record(z.unknown()))
      .describe(
        "Array of blocks (React Flow nodes). Each must have an `id`, a `type` from scrapeer_get_block_catalog, and a `custom` object with the block's config fields. Position fields (`position.x`, `position.y`) are optional — auto-layout fills them in.",
      ),
    edges: z
      .array(z.record(z.unknown()))
      .describe(
        "Array of connections between blocks. Each must have `id`, `source`, and `target`. `sourceHandle`/`targetHandle` default to `main` when omitted.",
      ),
  })
  .describe(
    "ReactFlowJSON-style flow payload — the same shape returned by scrapeer_get_flow. Use scrapeer_validate_flow to dry-run before writing.",
  );

const patchOperationSchema = z
  .object({
    op: z
      .enum([
        "add_block",
        "update_block_custom",
        "remove_block",
        "add_edge",
        "remove_edge",
      ])
      .describe("Operation kind. See gateway/internal/copilot/patch.go."),
    node: z.unknown().optional().describe("New block (required for add_block)."),
    blockId: z
      .string()
      .optional()
      .describe(
        "ID of the block to modify (required for update_block_custom, remove_block).",
      ),
    custom: z
      .record(z.unknown())
      .optional()
      .describe(
        "Partial custom-fields object (required for update_block_custom). Only the listed keys are merged into the block; absent keys are unchanged.",
      ),
    edge: z
      .unknown()
      .optional()
      .describe("New edge (required for add_edge)."),
    edgeId: z
      .string()
      .optional()
      .describe("ID of the edge to remove (required for remove_edge)."),
  })
  .describe("A single patch operation against a flow's graph.");

export const getBlockCatalogInput = z.object({});

export const validateFlowInput = z.object({
  flow: flowPayloadSchema,
});

export const createFlowInput = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Display name for the new flow."),
});

export const updateFlowInput = z.object({
  flow: flowIdentifier,
  data: flowPayloadSchema.describe(
    "The complete replacement flow. WARNING: this overwrites the entire flow definition — prefer scrapeer_patch_flow for incremental changes.",
  ),
  baseProjectEventID: z
    .string()
    .optional()
    .describe(
      "Version stamp from the last scrapeer_get_flow on this flow. Auto-populated by the MCP server when you've called scrapeer_get_flow earlier in the session — only set this manually if you need to override the cached value.",
    ),
});

export const patchFlowInput = z.object({
  flow: flowIdentifier,
  operations: z
    .array(patchOperationSchema)
    .min(1)
    .describe("List of patch operations to apply, in order."),
  baseProjectEventID: z
    .string()
    .optional()
    .describe(
      "Version stamp from the last scrapeer_get_flow on this flow. Auto-populated when available.",
    ),
});
