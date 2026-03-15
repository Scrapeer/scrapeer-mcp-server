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
} from "./schemas.js";

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
      const total = response.projectCount;
      return formatToolResponse({
        flows: response.projects,
        total,
        has_more: offset + limit < total,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_flow
  // -------------------------------------------------------------------------
  async function getFlow(args: z.infer<typeof getFlowInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const project = await client.getProject(args.flow_id);
      let blockCount = 0;
      const blockTypes: string[] = [];

      const flowData = project.data as { nodes?: Array<{ type?: string }> };
      if (Array.isArray(flowData?.nodes)) {
        blockCount = flowData.nodes.length;
        const types = new Set(
          flowData.nodes.map((n) => n.type).filter(Boolean) as string[],
        );
        blockTypes.push(...types);
      }

      return formatToolResponse({
        id: project.id,
        title: project.title,
        block_count: blockCount,
        block_types: blockTypes,
        created_at: project.created_at,
        updated_at: project.updated_at,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_run_flow
  // -------------------------------------------------------------------------
  async function runFlow(args: z.infer<typeof runFlowInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const run = await client.triggerCloudRun(args.flow_id, args.max_credits);
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
      const run = await client.triggerCloudRun(args.flow_id, args.max_credits);
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
          return formatToolResponseWithUntrustedData(
            {
              execution_id: executionId,
              status,
              credits_used: execution.creditsUsed,
              duration_ms: execution.durationMs,
              steps: steps.steps.map((s) => ({
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
            },
            execution.data,
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
            steps: steps.steps.map((s) => ({
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
        execution.data,
      );
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_get_run_steps
  // -------------------------------------------------------------------------
  async function getRunSteps(args: z.infer<typeof executionIdInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const response = await client.getExecutionSteps(args.execution_id);
      return formatToolResponse({
        steps: response.steps.map((s) => ({
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
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_list_runs
  // -------------------------------------------------------------------------
  async function listRuns(args: z.infer<typeof listRunsInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const limit = args.limit ?? 20;
      const offset = args.offset ?? 0;
      // Map MCP "active" → gateway "started"
      const gatewayStatus = args.status === "active" ? "started" : args.status;

      const response = await client.listExecutions({
        limit,
        offset,
        status: gatewayStatus,
        projectId: args.flow_id,
      });

      return formatToolResponse({
        executions: response.executions.map((e) => ({
          id: e.id,
          flow_id: e.projectId,
          flow_title: e.projectTitle,
          status: normalizeStatus(e.status),
          trigger: e.trigger,
          created_at: e.createdAt,
          duration_ms: e.durationMs,
          credits_used: e.creditsUsed,
        })),
        total: response.total,
        has_more: offset + limit < response.total,
      });
    });
  }

  // -------------------------------------------------------------------------
  // scrapeer_cancel_run
  // -------------------------------------------------------------------------
  async function cancelRun(args: z.infer<typeof executionIdInput>): Promise<ToolResult> {
    return withErrorHandling(async () => {
      const execution = await client.getExecution(args.execution_id);

      // Resolve workflow_id from execution response (field may appear in different positions)
      const workflowId =
        ((execution as unknown as Record<string, unknown>).workflowId as string | undefined) ??
        (execution.data?.workflow_id as string | undefined);

      if (!workflowId) {
        return formatErrorResponse(
          "Cannot cancel this run — workflow ID not found.",
        );
      }

      await client.cancelRun(workflowId);
      return formatToolResponse({
        execution_id: args.execution_id,
        status: "cancelled",
      });
    });
  }

  return {
    listFlows,
    getFlow,
    runFlow,
    runFlowAndWait,
    getRunStatus,
    getRunResults,
    getRunSteps,
    listRuns,
    cancelRun,
  };
}
