import { classifyHttpError } from "./errors.js";

export interface ProjectListResponse {
  projects: Array<{
    ID: string;
    Title: string;
    CreatedAt: string;
    UpdatedAt: string;
    BlockCount: number;
    BlockTypes: string[];
  }>;
  projectCount: number;
  projectLimit: number;
}

export interface ProjectResponse {
  ID: string;
  Title: string;
  Data: unknown;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface RunResponse {
  workflow_id: string;
  execution_id: string;
  run_id: string;
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
  data: Record<string, unknown> | null;
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
  executions: ExecutionResponse[];
  total: number;
  limit: number;
  offset: number;
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

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
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
    return this.request("GET", `/api/v1/projects/${id}`);
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
