import type { ScrapeerClient } from "../client.js";
import { ScrapeerError } from "../errors.js";
import {
  formatToolResponse,
  formatErrorResponse,
  formatToolResponseWithUntrustedData,
} from "../utils.js";
import type { z } from "zod";
import type {
  listFlowsInput,
  getFlowInput,
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
import type {
  FlowPayload,
  PatchOperationPayload,
} from "../client.js";
import { FlowConflictError } from "../errors.js";

// ---------------------------------------------------------------------------
// Status normalization
// Gateway uses "started" for in-progress runs; MCP API surfaces "active".
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  started: "active",
  active: "active",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

function normalizeStatus(status: string): string {
  return STATUS_MAP[status] ?? status;
}

// ---------------------------------------------------------------------------
// Error handling wrapper
// ---------------------------------------------------------------------------

type ToolResult = ReturnType<typeof formatToolResponse> | ReturnType<typeof formatErrorResponse>;

async function withErrorHandling(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ScrapeerError) {
      return formatErrorResponse(err.message);
    }
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return formatErrorResponse(message);
  }
}

// ---------------------------------------------------------------------------
// Flow resolution: accepts UUID or name, resolves to a single flow ID
// ---------------------------------------------------------------------------

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveFlowId(
  client: ScrapeerClient,
  flowInput: string,
): Promise<{ id: string } | { error: ToolResult }> {
  // If it's a UUID, use it directly
  if (UUID_REGEX.test(flowInput)) {
    return { id: flowInput };
  }

  // Otherwise, search by name
  const response = await client.listProjects(100, 0);
  const projects = response.data;
  const matches = projects.filter(
    (p) => p.Title.toLowerCase() === flowInput.toLowerCase(),
  );

  if (matches.length === 0) {
    // Try partial match
    const partial = projects.filter(
      (p) => p.Title.toLowerCase().includes(flowInput.toLowerCase()),
    );
    if (partial.length === 0) {
      return {
        error: formatErrorResponse(
          `No flow found matching "${flowInput}". Use scrapeer_list_flows to see available flows.`,
        ),
      };
    }
    if (partial.length === 1) {
      return { id: partial[0].ID };
    }
    // Multiple partial matches
    const list = partial
      .map((p) => `  - "${p.Title}" (${p.ID})`)
      .join("\n");
    return {
      error: formatErrorResponse(
        `Multiple flows match "${flowInput}". Ask the user which one they mean:\n${list}`,
      ),
    };
  }

  if (matches.length === 1) {
    return { id: matches[0].ID };
  }

  // Multiple exact matches
  const list = matches
    .map((p) => `  - "${p.Title}" (${p.ID}, created ${p.CreatedAt})`)
    .join("\n");
  return {
    error: formatErrorResponse(
      `Multiple flows named "${flowInput}". Ask the user which one they mean:\n${list}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// Prune unreachable blocks - mirrors gateway's PruneUnreachableBlocks (BFS)
// ---------------------------------------------------------------------------

interface PrunableBlock {
  id: string;
  type?: string;
  parentId?: string;
}

interface PrunableEdge {
  source: string;
  target: string;
}

function pruneUnreachable<
  B extends PrunableBlock,
  E extends PrunableEdge,
>(allBlocks: B[], allEdges: E[]): { blocks: B[]; edges: E[] } {
  if (allBlocks.length === 0) return { blocks: [], edges: [] };

  // Find the start block
  const startBlock = allBlocks.find((b) => b.type === "start");
  if (!startBlock) return { blocks: allBlocks, edges: allEdges };

  // Build adjacency: edges + parent->child relationships
  const adj = new Map<string, string[]>();
  for (const b of allBlocks) adj.set(b.id, []);
  for (const e of allEdges) adj.get(e.source)?.push(e.target);
  for (const b of allBlocks) {
    if (b.parentId) adj.get(b.parentId)?.push(b.id);
  }

  // BFS from start
  const reachable = new Set<string>();
  const queue = [startBlock.id];
  reachable.add(startBlock.id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adj.get(current) ?? []) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return {
    blocks: allBlocks.filter((b) => reachable.has(b.id)),
    edges: allEdges.filter((e) => reachable.has(e.source) && reachable.has(e.target)),
  };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

// Injected sleep for testability (tests can pass a no-op)
type SleepFn = (ms: number) => Promise<void>;

const defaultSleep: SleepFn = (ms) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createHandlers(
  client: ScrapeerClient,
  _sleep: SleepFn = defaultSleep,
) {
  // -------------------------------------------------------------------------
  // scrapeer_list_flows
  // -------------------------------------------------------------------------
  async function listFlows(args: z.infer<typeof listFlowsInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;
      const response = await client.listProjects(limit, offset);
      return formatToolResponse({
        flows: response.data.map((p) => ({
          id: p.ID,
          title: p.Title,
          block_count: p.BlockCount,
          block_types: p.BlockTypes,
          created_at: p.CreatedAt,
          updated_at: p.UpdatedAt,
        })),
        total: response.pagination.total,
        has_more: response.pagination.has_more,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_flow
  // -------------------------------------------------------------------------
  async function getFlow(args: z.infer<typeof getFlowInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const resolved = await resolveFlowId(client, args.flow);
      if ("error" in resolved) return resolved.error;
      const project = await client.getProject(resolved.id);

      // Data comes from the gateway as base64-encoded JSON or a raw JSON string
      let rawData: unknown = project.Data;
      if (typeof rawData === "string") {
        try {
          // Try base64 decode first
          const decoded = Buffer.from(rawData, "base64").toString("utf-8");
          rawData = JSON.parse(decoded);
        } catch {
          try {
            // Fallback: raw JSON string
            rawData = JSON.parse(rawData as string);
          } catch {
            rawData = {};
          }
        }
      }

      interface FlowBlock {
        id: string;
        type?: string;
        custom?: Record<string, unknown>;
        parentId?: string;
      }
      interface FlowEdge {
        source: string;
        target: string;
      }
      // ReactFlow stores blocks as "nodes" in JSON - we map to our terminology
      const flowData = rawData as { nodes?: FlowBlock[]; edges?: FlowEdge[] };
      const allBlocks = flowData?.nodes ?? [];
      const allEdges = flowData?.edges ?? [];

      // Prune unreachable blocks (BFS from start block, following edges + parentId)
      const { blocks, edges } = pruneUnreachable(allBlocks, allEdges);

      const blockTypes = [...new Set(
        blocks.map((b) => b.type).filter(Boolean) as string[],
      )];

      return formatToolResponse({
        id: project.ID,
        title: project.Title,
        block_count: blocks.length,
        block_types: blockTypes,
        blocks: blocks.map((b) => ({
          id: b.id,
          type: b.type,
          custom: b.custom,
          parent_id: b.parentId || undefined,
        })),
        edges: edges.map((e) => ({
          source: e.source,
          target: e.target,
        })),
        created_at: project.CreatedAt,
        updated_at: project.UpdatedAt,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_run_flow
  // -------------------------------------------------------------------------
  async function runFlow(args: z.infer<typeof runFlowInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const resolved = await resolveFlowId(client, args.flow);
      if ("error" in resolved) return resolved.error;
      const run = await client.triggerCloudRun(resolved.id, args.max_credits);
      return formatToolResponse({
        execution_id: run.execution_id,
        workflow_id: run.workflow_id,
        status: "active",
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_run_flow_and_wait
  // -------------------------------------------------------------------------
  async function runFlowAndWait(
    args: z.infer<typeof runFlowAndWaitInput>,
  ): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const timeoutSeconds = args.timeout_seconds ?? 300;
      const resolved = await resolveFlowId(client, args.flow);
      if ("error" in resolved) return resolved.error;
      const run = await client.triggerCloudRun(resolved.id, args.max_credits);
      const executionId = run.execution_id;

      // Return immediately if timeout is 0
      if (timeoutSeconds === 0) {
        return formatToolResponse({
          execution_id: executionId,
          workflow_id: run.workflow_id,
          status: "active",
          message:
            "Run triggered. Use scrapeer_get_run_status to check progress.",
        });
      }

      const deadline = Date.now() + timeoutSeconds * 1000;
      const pollIntervalMs = 5_000;

      while (true) {
        const execution = await client.getExecution(executionId);
        const status = normalizeStatus(execution.status);

        if (status === "completed") {
          const steps = await client.getExecutionSteps(executionId);

          const durationSec = execution.durationMs ? Math.round(execution.durationMs / 1000) : 0;
          const variables = execution.variables ?? {};
          const itemCount =
            typeof variables === "object" && variables !== null
              ? Object.keys(variables).length
              : 0;
          const blockPreviews = execution.blockPreviews ?? [];
          const previewBlockIds = new Set(blockPreviews.map((p) => p.blockId));
          const summaryParts = [];
          if (itemCount > 0) summaryParts.push(`${itemCount} variable${itemCount !== 1 ? "s" : ""}`);
          summaryParts.push(`${durationSec}s`);
          if (execution.creditsUsed) summaryParts.push(`${execution.creditsUsed} credits`);
          const summary = `Completed: ${summaryParts.join(", ")}`;

          return formatToolResponseWithUntrustedData(
            {
              execution_id: executionId,
              status,
              summary,
              credits_used: execution.creditsUsed,
              duration_ms: execution.durationMs,
              steps: (steps.steps ?? []).map((s) => ({
                block_id: s.blockId,
                block_type: s.blockType,
                label: s.label,
                status: s.status,
                duration_ms:
                  s.startedAt && s.endedAt
                    ? new Date(s.endedAt).getTime() -
                      new Date(s.startedAt).getTime()
                    : null,
                error: s.error,
                has_preview: previewBlockIds.has(s.blockId),
              })),
            },
            {
              variables,
              block_previews: blockPreviews,
            },
          );
        }

        if (status === "failed") {
          const steps = await client.getExecutionSteps(executionId);
          return formatToolResponse({
            execution_id: executionId,
            status,
            error: execution.error,
            credits_used: execution.creditsUsed,
            duration_ms: execution.durationMs,
            steps: (steps.steps ?? []).map((s) => ({
              block_id: s.blockId,
              block_type: s.blockType,
              label: s.label,
              status: s.status,
              duration_ms:
                s.startedAt && s.endedAt
                  ? new Date(s.endedAt).getTime() -
                    new Date(s.startedAt).getTime()
                  : null,
              error: s.error,
            })),
          });
        }

        if (status === "cancelled") {
          return formatToolResponse({
            execution_id: executionId,
            status,
            message: "Run was cancelled before completing.",
          });
        }

        // Check timeout before sleeping
        if (Date.now() >= deadline) {
          return formatToolResponse({
            execution_id: executionId,
            status: "active",
            message: `Run did not complete within ${timeoutSeconds}s. Use scrapeer_get_run_status to check progress or scrapeer_cancel_run to abort it.`,
          });
        }

        // Sleep before next poll
        await _sleep(pollIntervalMs);

        // Check timeout again after sleep (catches edge case where sleep itself exceeded deadline)
        if (Date.now() >= deadline) {
          return formatToolResponse({
            execution_id: executionId,
            status: "active",
            message: `Run did not complete within ${timeoutSeconds}s. Use scrapeer_get_run_status to check progress or scrapeer_cancel_run to abort it.`,
          });
        }
      }
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_run_status
  // -------------------------------------------------------------------------
  async function getRunStatus(args: z.infer<typeof executionIdInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const execution = await client.getExecution(args.execution_id);
      return formatToolResponse({
        execution_id: execution.id,
        status: normalizeStatus(execution.status),
        created_at: execution.createdAt,
        duration_ms: execution.durationMs,
        error: execution.error,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_run_results
  // -------------------------------------------------------------------------
  async function getRunResults(args: z.infer<typeof executionIdInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const execution = await client.getExecution(args.execution_id);
      const status = normalizeStatus(execution.status);
      return formatToolResponseWithUntrustedData(
        {
          execution_id: execution.id,
          status,
          credits_used: execution.creditsUsed,
          duration_ms: execution.durationMs,
        },
        {
          variables: execution.variables ?? {},
          block_previews: execution.blockPreviews ?? [],
        },
      );
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_run_steps
  // -------------------------------------------------------------------------
  async function getRunSteps(args: z.infer<typeof executionIdInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      // Detail endpoint carries blockPreviews at (blockId, loopContextHash) grain.
      // Fetched in parallel with steps so each row can be tagged has_preview,
      // giving the LLM a cheap hint for whether to call scrapeer_get_run_results.
      // The detail fetch is best-effort: a transient error degrades has_preview to
      // false for all steps rather than discarding the steps result entirely.
      const [response, executionResult] = await Promise.all([
        client.getExecutionSteps(args.execution_id),
        client.getExecution(args.execution_id).catch(() => null),
      ]);
      const previewBlockIds = new Set(
        (executionResult?.blockPreviews ?? []).map((p) => p.blockId),
      );
      return formatToolResponse({
        steps: (response.steps ?? []).map((s) => ({
          block_id: s.blockId,
          block_type: s.blockType,
          label: s.label,
          status: s.status,
          duration_ms:
            s.startedAt && s.endedAt
              ? new Date(s.endedAt).getTime() -
                new Date(s.startedAt).getTime()
              : null,
          error: s.error,
          has_preview: previewBlockIds.has(s.blockId),
        })),
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_list_runs
  // -------------------------------------------------------------------------
  async function listRuns(args: z.infer<typeof listRunsInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;
      // Map MCP "active" -> gateway "started"
      const gatewayStatus = args.status === "active" ? "started" : args.status;

      // Resolve flow name to ID if provided
      let projectId: string | undefined;
      if (args.flow) {
        const resolved = await resolveFlowId(client, args.flow);
        if ("error" in resolved) return resolved.error;
        projectId = resolved.id;
      }

      const response = await client.listExecutions({
        limit,
        offset,
        status: gatewayStatus,
        projectId,
      });

      return formatToolResponse({
        executions: response.data.map((e) => ({
          id: e.id,
          flow_id: e.projectId,
          flow_title: e.projectTitle,
          status: normalizeStatus(e.status),
          trigger: e.trigger,
          created_at: e.createdAt,
          duration_ms: e.durationMs,
          credits_used: e.creditsUsed,
        })),
        total: response.pagination.total,
        has_more: response.pagination.has_more,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_cancel_run
  // -------------------------------------------------------------------------
  async function cancelRun(args: z.infer<typeof executionIdInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const execution = await client.getExecution(args.execution_id);

      if (!execution.workflowId) {
        return formatErrorResponse(
          "Cannot cancel this run - workflow ID not found.",
        );
      }

      await client.cancelRun(execution.workflowId);
      return formatToolResponse({
        execution_id: args.execution_id,
        status: "cancelled",
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_account
  // -------------------------------------------------------------------------
  async function getAccount(): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const [wallet, entitlements] = await Promise.all([
        client.getWallet(),
        client.getEntitlements(),
      ]);

      return formatToolResponse({
        credits: wallet.credits,
        plan: entitlements.plan.tier,
        plan_status: entitlements.plan.status,
        cloud_runs_enabled: entitlements.features.cloudRun.allowed,
        cloud_run_reason: entitlements.features.cloudRun.allowed
          ? undefined
          : entitlements.features.cloudRun.reason,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_block_catalog
  // -------------------------------------------------------------------------
  async function getBlockCatalog(
    _args: z.infer<typeof getBlockCatalogInput>,
  ): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const catalog = await client.getBlockCatalog();
      return formatToolResponse({
        version: catalog.version,
        block_count: catalog.blocks.length,
        blocks: catalog.blocks,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_validate_flow
  // -------------------------------------------------------------------------
  async function validateFlow(
    args: z.infer<typeof validateFlowInput>,
  ): Promise<ToolResult> {
    return withErrorHandling(async () => {
      // Cast through unknown - Zod widens nodes/edges to record<unknown>,
      // which is wider than the FlowPayload field types. Trust the
      // gateway validator to enforce real shape.
      const result = await client.validateFlow(args.flow as unknown as FlowPayload);
      return formatToolResponse({
        ok: result.ok,
        errors: result.errors ?? [],
        warnings: result.warnings ?? [],
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_create_flow
  // -------------------------------------------------------------------------
  async function createFlow(
    args: z.infer<typeof createFlowInput>,
  ): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const result = await client.createProject(args.title);
      return formatToolResponse({
        flow_id: result.projectId,
        title: args.title,
        message:
          "Flow created. Add blocks with scrapeer_patch_flow (preferred for incremental edits) or scrapeer_update_flow (whole-flow replacement).",
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_update_flow
  // -------------------------------------------------------------------------
  async function updateFlow(
    args: z.infer<typeof updateFlowInput>,
  ): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const resolved = await resolveFlowId(client, args.flow);
      if ("error" in resolved) return resolved.error;

      try {
        const result = await client.saveProjectData(
          resolved.id,
          args.data as unknown as FlowPayload,
          args.baseProjectEventID,
        );
        return formatToolResponse({
          flow_id: resolved.id,
          new_event_id: result.projectEventID,
          message: result.message,
        });
      } catch (err) {
        if (err instanceof FlowConflictError) {
          return formatErrorResponse(
            `${err.message}` +
              (err.currentProjectEventID
                ? ` Server's current event_id: ${err.currentProjectEventID}.`
                : ""),
          );
        }
        throw err;
      }
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_patch_flow
  // -------------------------------------------------------------------------
  async function patchFlow(
    args: z.infer<typeof patchFlowInput>,
  ): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const resolved = await resolveFlowId(client, args.flow);
      if ("error" in resolved) return resolved.error;

      try {
        const result = await client.patchProject(
          resolved.id,
          args.operations as unknown as PatchOperationPayload[],
          args.baseProjectEventID,
        );
        return formatToolResponse({
          flow_id: resolved.id,
          new_event_id: result.projectEventID,
          operations_applied: result.operationSummaries.length,
          summaries: result.operationSummaries,
          flow: result.flow,
          message: result.message,
        });
      } catch (err) {
        if (err instanceof FlowConflictError) {
          return formatErrorResponse(
            `${err.message}` +
              (err.currentProjectEventID
                ? ` Server's current event_id: ${err.currentProjectEventID}.`
                : ""),
          );
        }
        throw err;
      }
    });
  }

  return {
    listFlows,
    getFlow,
    getAccount,
    runFlow,
    runFlowAndWait,
    getRunStatus,
    getRunResults,
    getRunSteps,
    listRuns,
    cancelRun,
    getBlockCatalog,
    validateFlow,
    createFlow,
    updateFlow,
    patchFlow,
  };
}
