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

export const getFlowInput = z.object({
  flow_id: z
    .string()
    .uuid()
    .describe(
      "The ID of the flow to get details for. Use scrapeer_list_flows to find available flow IDs.",
    ),
});

export const runFlowInput = z.object({
  flow_id: z
    .string()
    .uuid()
    .describe(
      "The ID of the flow to run. Use scrapeer_list_flows to find available flow IDs.",
    ),
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
  flow_id: z
    .string()
    .uuid()
    .describe(
      "The ID of the flow to run. Use scrapeer_list_flows to find available flow IDs.",
    ),
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

export const listRunsInput = z.object({
  ...paginationSchema,
  status: z
    .enum(["active", "completed", "failed", "cancelled"])
    .optional()
    .describe("Filter by execution status."),
  flow_id: z
    .string()
    .uuid()
    .optional()
    .describe("Filter runs by flow ID."),
});
