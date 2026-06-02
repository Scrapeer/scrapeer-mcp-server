import { classifyHttpError } from "./errors.js";

export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ProjectListResponse {
  data: Array<{
    ID: string;
    Title: string;
    CreatedAt: string;
    UpdatedAt: string;
    BlockCount: number;
    BlockTypes: string[];
  }>;
  pagination: PaginationMeta;
}

export interface ProjectResponse {
  ID: string;
  Title: string;
  Data: unknown;
  CreatedAt: string;
  UpdatedAt: string;
  EventID: string | null;
}

export interface BlockCatalogField {
  name: string;
  type: string;
  required: boolean;
  default?: string;
  description?: string;
  enumValues?: string[];
}

export interface BlockCatalogEntry {
  type: string;
  displayName: string;
  description?: string;
  category?: string;
  hasErrorHandle: boolean;
  customFields: BlockCatalogField[];
}

export interface BlockCatalogResponse {
  version: string;
  blocks: BlockCatalogEntry[];
}

export interface FlowDiagnostic {
  blockId?: string;
  blockType?: string;
  severity?: "error" | "warning";
  code: string;
  message: string;
}

export interface ValidateFlowResponse {
  ok: boolean;
  errors?: FlowDiagnostic[];
  warnings?: FlowDiagnostic[];
}

/**
 * Minimal ReactFlowJSON shape - enough to construct a flow body without
 * importing the full block schemas. Callers pass arbitrary nested
 * config under each block's `custom` field; the gateway's validator is
 * the source of truth for what's allowed.
 */
export interface FlowPayload {
  nodes: Array<{
    id: string;
    type: string;
    position?: { x: number; y: number };
    width?: number;
    height?: number;
    parentId?: string;
    custom?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
    [key: string]: unknown;
  }>;
}

/**
 * Patch operation shape mirrors the gateway's `copilot.PatchOperation`.
 * The wire format is the same; we keep it loose here so the LLM doesn't
 * need to know about Go's tagged-union serialization quirks.
 */
export interface PatchOperationPayload {
  op:
    | "add_block"
    | "update_block_custom"
    | "remove_block"
    | "add_edge"
    | "remove_edge";
  node?: unknown;
  blockId?: string;
  custom?: Record<string, unknown>;
  edge?: unknown;
  edgeId?: string;
}

export interface OperationSummary {
  index: number;
  op: string;
  detail: string;
}

export interface ProjectSaveResponse {
  id: string;
  message: string;
  projectEventID: string;
}

export interface PatchProjectResponse {
  id: string;
  message: string;
  projectEventID: string;
  operationSummaries: OperationSummary[];
  flow: FlowPayload;
}

export interface CreateProjectResponse {
  id: string;
  message: string;
  projectId: string;
  /**
   * Initial event_id of the freshly-created project. Cached by the
   * client so the LLM can call create_flow -> patch_flow without an
   * intervening get_flow.
   */
  projectEventID: string;
}

export interface RunResponse {
  workflow_id: string;
  execution_id: string;
  run_id: string;
}

// Cloud Run Inspector envelope - field names mirror the worker source of truth
// at scrapeer-worker/src/inspector/previewEnvelope.ts. Keep in sync when the
// worker envelope shape evolves.
export type PreviewEnvelope =
  | {
      kind: "single";
      data: unknown;
      truncated: boolean;
      truncationMeta?: {
        originalItemCount?: number;
        originalBytes?: number;
      };
    }
  | {
      kind: "iterated";
      iterations: Array<{
        loopContext: Array<{ loopBlockId: string; iteration: number }>;
        data: unknown;
        truncated: boolean;
        truncationMeta?: {
          originalItemCount?: number;
          originalBytes?: number;
        };
      }>;
      iterationsTruncated: boolean;
    };

export interface ExecutionBlockPreview {
  blockId: string;
  loopContextHash?: string;
  outputPreview: PreviewEnvelope;
  previewTruncated: boolean;
}

export interface ExecutionResponse {
  id: string;
  projectId: string | null;
  projectTitle: string | null;
  status: string;
  mode: string;
  trigger: string;
  createdAt: string;
  updatedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  creditsUsed: number | null;
  error: { code: string; message: string } | null;
  workflowId?: string;
  variables?: Record<string, unknown> | null;
  blockPreviews?: ExecutionBlockPreview[];
}

export interface ExecutionStepsResponse {
  steps: Array<{
    id: string;
    blockId: string;
    blockType: string;
    label: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    stepIndex: number;
    error: string | null;
  }>;
}

export interface ExecutionListResponse {
  data: ExecutionResponse[];
  pagination: PaginationMeta;
}

export interface ExecutionFilters {
  limit?: number;
  offset?: number;
  status?: string;
  projectId?: string;
}

export class ScrapeerClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  /**
   * In-memory cache of the most recent event_id seen per flow.
   * Populated by getProject (and refreshed by saveProjectData /
   * patchProject responses). update_flow / patch_flow read from here
   * to populate baseProjectEventID, so MCP-vs-anything concurrency
   * is covered automatically - the LLM doesn't have to manage event
   * IDs by hand.
   *
   * Process-local. A fresh MCP server process starts with an empty
   * cache; the first save in a session falls through to the gateway's
   * Phase A unconditional path (logged as a warning server-side).
   * Once the model calls get_flow, we have the event_id and the
   * concurrency check fires for every subsequent mutation.
   */
  private readonly eventIDCache = new Map<string, string>();

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  /** Read a cached event_id for a flow. Used by patch/update tools. */
  getCachedEventID(flowId: string): string | undefined {
    return this.eventIDCache.get(flowId);
  }

  /** Manually clear a flow's cached event_id (e.g. after a 409). */
  invalidateEventID(flowId: string): void {
    this.eventIDCache.delete(flowId);
  }

  private setCachedEventID(flowId: string, eventID: string | null | undefined) {
    if (eventID && eventID.length > 0) {
      this.eventIDCache.set(flowId, eventID);
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw classifyHttpError(response.status, text);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async listProjects(limit = 20, offset = 0): Promise<ProjectListResponse> {
    return this.request("GET", `/api/v1/projects?limit=${limit}&offset=${offset}`);
  }

  async getProject(id: string): Promise<ProjectResponse> {
    const project = await this.request<ProjectResponse>("GET", `/api/v1/projects/${id}`);
    // Populate the event_id cache for downstream patch/update calls.
    this.setCachedEventID(project.ID, project.EventID);
    return project;
  }

  async getBlockCatalog(): Promise<BlockCatalogResponse> {
    return this.request("GET", "/api/v1/blocks/catalog");
  }

  async validateFlow(flow: FlowPayload): Promise<ValidateFlowResponse> {
    return this.request("POST", "/api/v1/flows/validate", { flow });
  }

  async createProject(title: string): Promise<CreateProjectResponse> {
    const result = await this.request<CreateProjectResponse>(
      "POST",
      "/api/v1/projects",
      { title },
    );
    // Cache the freshly-assigned event_id so a follow-up patch/update on
    // the new project doesn't 400 for missing baseProjectEventID.
    this.setCachedEventID(result.projectId, result.projectEventID);
    return result;
  }

  async saveProjectData(
    projectId: string,
    flow: FlowPayload,
    baseProjectEventID?: string,
  ): Promise<ProjectSaveResponse> {
    const body: Record<string, unknown> = { id: projectId, data: flow };
    // Send the cached event_id when available - this is what makes the
    // server's optimistic-concurrency check fire for MCP-driven saves.
    const baseID = baseProjectEventID ?? this.eventIDCache.get(projectId);
    if (baseID) body.baseProjectEventID = baseID;

    try {
      const result = await this.request<ProjectSaveResponse>(
        "PUT",
        `/api/v1/projects/${projectId}/data`,
        body,
      );
      this.setCachedEventID(projectId, result.projectEventID);
      return result;
    } catch (err) {
      // 409 means our cached event_id is stale. Drop it so the next
      // get_flow + retry path doesn't reuse the dead value.
      if (err instanceof Error && err.constructor.name === "FlowConflictError") {
        this.invalidateEventID(projectId);
      }
      throw err;
    }
  }

  async patchProject(
    projectId: string,
    operations: PatchOperationPayload[],
    baseProjectEventID?: string,
  ): Promise<PatchProjectResponse> {
    const body: Record<string, unknown> = { operations };
    const baseID = baseProjectEventID ?? this.eventIDCache.get(projectId);
    if (baseID) body.baseProjectEventID = baseID;

    try {
      const result = await this.request<PatchProjectResponse>(
        "POST",
        `/api/v1/projects/${projectId}/patch`,
        body,
      );
      this.setCachedEventID(projectId, result.projectEventID);
      return result;
    } catch (err) {
      if (err instanceof Error && err.constructor.name === "FlowConflictError") {
        this.invalidateEventID(projectId);
      }
      throw err;
    }
  }

  async triggerCloudRun(projectId: string, maxCredits?: number): Promise<RunResponse> {
    return this.request("POST", "/api/v1/cloud/run", {
      project_id: projectId,
      worker_count: 1,
      ...(maxCredits != null ? { max_total_credits: maxCredits } : {}),
    });
  }

  async getExecution(id: string): Promise<ExecutionResponse> {
    return this.request("GET", `/api/v1/executions/${id}`);
  }

  async getExecutionSteps(id: string): Promise<ExecutionStepsResponse> {
    return this.request("GET", `/api/v1/executions/${id}/steps`);
  }

  async listExecutions(filters: ExecutionFilters = {}): Promise<ExecutionListResponse> {
    const params = new URLSearchParams();
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.offset) params.set("offset", String(filters.offset));
    if (filters.status) params.set("status", filters.status);
    if (filters.projectId) params.set("projectId", filters.projectId);
    const qs = params.toString();
    return this.request("GET", `/api/v1/executions${qs ? `?${qs}` : ""}`);
  }

  async getWallet(): Promise<{ credits: number }> {
    return this.request("GET", "/api/v1/user/wallet");
  }

  async getEntitlements(): Promise<{
    plan: { tier: string; status: string };
    features: { cloudRun: { allowed: boolean; reason?: string } };
  }> {
    return this.request("GET", "/api/v1/user/entitlements");
  }

  async cancelRun(workflowId: string): Promise<void> {
    return this.request("POST", `/api/v1/cloud/run/${workflowId}/cancel`);
  }
}
