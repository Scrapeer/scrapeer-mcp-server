import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ScrapeerClient } from "../../src/client.js";
import { createHandlers } from "../../src/tools/handlers.js";

const BASE_URL = "https://api.test.scrapeer.com";
const API_KEY = "sk_test123456789";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// No-op sleep for tests — prevents real 5s waits during polling
const noopSleep = () => Promise.resolve();

function makeClient() {
  return new ScrapeerClient(API_KEY, BASE_URL);
}

function makeHandlers() {
  return createHandlers(makeClient(), noopSleep);
}

function parseContent(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

// Minimal fixture factories
function makeProject(overrides: Record<string, unknown> = {}) {
  return {
    ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    Title: "My Scraper",
    CreatedAt: "2026-01-01T00:00:00Z",
    UpdatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function makeProjectList(projects = [makeProject()]) {
  return {
    projects,
    projectCount: projects.length,
    projectLimit: 20,
  };
}

function makeExecution(overrides: Record<string, unknown> = {}) {
  return {
    id: "exec-1111-2222-3333-444444444444",
    projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    projectTitle: "My Scraper",
    status: "completed",
    mode: "cloud",
    trigger: "manual",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:01:00Z",
    finishedAt: "2026-01-01T00:01:00Z",
    durationMs: 60000,
    creditsUsed: 5,
    error: null,
    data: { rows: [{ name: "Alice" }] },
    ...overrides,
  };
}

function makeSteps() {
  return {
    steps: [
      {
        id: "step-1",
        blockId: "block-1",
        blockType: "navigate",
        label: "Go to URL",
        status: "completed",
        startedAt: "2026-01-01T00:00:00Z",
        endedAt: "2026-01-01T00:00:05Z",
        stepIndex: 0,
        error: null,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// listFlows
// ---------------------------------------------------------------------------

describe("listFlows", () => {
  it("transforms gateway response to MCP format (projects→flows, projectCount→total, computes has_more)", async () => {
    const projectA = makeProject({ ID: "flow-aaa", Title: "Flow A" });
    const projectB = makeProject({ ID: "flow-bbb", Title: "Flow B" });

    server.use(
      http.get(`${BASE_URL}/api/v1/projects`, () =>
        HttpResponse.json({
          projects: [projectA, projectB],
          projectCount: 50,
          projectLimit: 20,
        }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.listFlows({ limit: 20, offset: 0 });
    const data = parseContent(result) as {
      flows: Array<{ id: string; title: string }>;
      total: number;
      has_more: boolean;
    };

    expect(data.flows).toHaveLength(2);
    expect(data.flows[0].id).toBe("flow-aaa");
    expect(data.total).toBe(50);
    // offset(0) + limit(20) = 20 < 50 → has_more true
    expect(data.has_more).toBe(true);
  });

  it("has_more is false when all items are returned", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects`, () =>
        HttpResponse.json(makeProjectList()),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.listFlows({ limit: 20, offset: 0 });
    const data = parseContent(result) as { has_more: boolean; total: number };

    expect(data.has_more).toBe(false);
  });

  it("uses default limit 20 when no args provided", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE_URL}/api/v1/projects`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json(makeProjectList());
      }),
    );

    const handlers = makeHandlers();
    await handlers.listFlows({});

    expect(capturedUrl).toContain("limit=20");
    expect(capturedUrl).toContain("offset=0");
  });
});

// ---------------------------------------------------------------------------
// getFlow
// ---------------------------------------------------------------------------

describe("getFlow", () => {
  it("extracts block summary from ReactFlow JSON", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects/:id`, () =>
        HttpResponse.json({
          ...makeProject(),
          Data: JSON.stringify({
            nodes: [
              { type: "navigate" },
              { type: "click" },
              { type: "navigate" }, // duplicate type — should deduplicate
            ],
          }),
        }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.getFlow({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    const data = parseContent(result) as {
      block_count: number;
      block_types: string[];
    };

    expect(data.block_count).toBe(3);
    expect(data.block_types).toContain("navigate");
    expect(data.block_types).toContain("click");
    // Deduplicated — should appear once
    expect(
      data.block_types.filter((t) => t === "navigate"),
    ).toHaveLength(1);
  });

  it("handles missing data.nodes gracefully", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects/:id`, () =>
        HttpResponse.json({ ...makeProject(), Data: JSON.stringify({}) }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.getFlow({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    const data = parseContent(result) as {
      block_count: number;
      block_types: string[];
    };

    expect(data.block_count).toBe(0);
    expect(data.block_types).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// runFlow
// ---------------------------------------------------------------------------

describe("runFlow", () => {
  it("returns execution_id and status active", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/cloud/run`, () =>
        HttpResponse.json({
          workflow_id: "wf-1",
          execution_id: "exec-aaaa-bbbb-cccc-dddddddddddd",
          run_id: "run-1",
        }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.runFlow({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    const data = parseContent(result) as {
      execution_id: string;
      status: string;
    };

    expect(data.execution_id).toBe("exec-aaaa-bbbb-cccc-dddddddddddd");
    expect(data.status).toBe("active");
    expect("isError" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runFlowAndWait
// ---------------------------------------------------------------------------

describe("runFlowAndWait", () => {
  it("polls until completion and returns results with anti-injection wrapper", async () => {
    let pollCount = 0;

    server.use(
      http.post(`${BASE_URL}/api/v1/cloud/run`, () =>
        HttpResponse.json({
          workflow_id: "wf-1",
          execution_id: "exec-aaaa-bbbb-cccc-dddddddddddd",
          run_id: "run-1",
        }),
      ),
      http.get(`${BASE_URL}/api/v1/executions/:id`, () => {
        pollCount++;
        // First poll returns "started" (still running), second returns "completed"
        if (pollCount < 2) {
          return HttpResponse.json(makeExecution({ status: "started" }));
        }
        return HttpResponse.json(makeExecution({ status: "completed" }));
      }),
      http.get(`${BASE_URL}/api/v1/executions/:id/steps`, () =>
        HttpResponse.json(makeSteps()),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.runFlowAndWait({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timeout_seconds: 60,
    });

    expect(pollCount).toBeGreaterThanOrEqual(2);
    const text = result.content[0].text;
    const data = JSON.parse(text) as {
      execution_id: string;
      status: string;
      data: string;
    };
    expect(data.status).toBe("completed");
    expect(data.execution_id).toBe("exec-aaaa-bbbb-cccc-dddddddddddd");
    // Anti-injection wrapper applied to data field
    expect(typeof data.data).toBe("string");
    expect(data.data).toContain("<untrusted-scraped-data-");
  });

  it("returns timeout message (not error) when exceeding timeout", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/cloud/run`, () =>
        HttpResponse.json({
          workflow_id: "wf-1",
          execution_id: "exec-aaaa-bbbb-cccc-dddddddddddd",
          run_id: "run-1",
        }),
      ),
      http.get(`${BASE_URL}/api/v1/executions/:id`, () =>
        // Always return "started" — never completes
        HttpResponse.json(makeExecution({ status: "started" })),
      ),
    );

    // Use a sleep function that sleeps past the deadline so the timeout fires after one poll.
    // timeout_seconds=1 → deadline is now+1000ms; sleep 1100ms to push past it.
    const timeoutSleep = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 1100)));

    const handlers = createHandlers(makeClient(), timeoutSleep);
    const result = await handlers.runFlowAndWait({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timeout_seconds: 1,
    });

    // Should NOT be an error (isError absent or false)
    expect((result as { isError?: boolean }).isError).toBeUndefined();

    const data = parseContent(result) as {
      status: string;
      message: string;
      execution_id: string;
    };
    expect(data.status).toBe("active");
    expect(data.message).toContain("scrapeer_get_run_status");
    expect(data.execution_id).toBe("exec-aaaa-bbbb-cccc-dddddddddddd");
  });

  it("returns immediately when timeout_seconds is 0", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/cloud/run`, () =>
        HttpResponse.json({
          workflow_id: "wf-1",
          execution_id: "exec-aaaa-bbbb-cccc-dddddddddddd",
          run_id: "run-1",
        }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.runFlowAndWait({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timeout_seconds: 0,
    });

    const data = parseContent(result) as { status: string; message: string };
    expect(data.status).toBe("active");
    expect(data.message).toContain("scrapeer_get_run_status");
  });

  it("returns error response on failed run", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/cloud/run`, () =>
        HttpResponse.json({
          workflow_id: "wf-1",
          execution_id: "exec-aaaa-bbbb-cccc-dddddddddddd",
          run_id: "run-1",
        }),
      ),
      http.get(`${BASE_URL}/api/v1/executions/:id`, () =>
        HttpResponse.json(
          makeExecution({
            status: "failed",
            error: { code: "BLOCK_ERROR", message: "Navigate failed" },
          }),
        ),
      ),
      http.get(`${BASE_URL}/api/v1/executions/:id/steps`, () =>
        HttpResponse.json(makeSteps()),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.runFlowAndWait({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      timeout_seconds: 60,
    });

    const data = parseContent(result) as { status: string };
    expect(data.status).toBe("failed");
    // Failed run is a normal (non-isError) response so the agent can inspect the error
    expect((result as { isError?: boolean }).isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getRunStatus
// ---------------------------------------------------------------------------

describe("getRunStatus", () => {
  it("normalizes started → active in status", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/executions/:id`, () =>
        HttpResponse.json(makeExecution({ status: "started" })),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.getRunStatus({
      execution_id: "exec-1111-2222-3333-444444444444",
    });
    const data = parseContent(result) as { status: string };
    expect(data.status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// getRunResults
// ---------------------------------------------------------------------------

describe("getRunResults", () => {
  it("wraps data in anti-injection wrapper", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/executions/:id`, () =>
        HttpResponse.json(makeExecution()),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.getRunResults({
      execution_id: "exec-1111-2222-3333-444444444444",
    });

    const text = result.content[0].text;
    const data = JSON.parse(text) as { data: string; status: string };
    expect(data.status).toBe("completed");
    expect(typeof data.data).toBe("string");
    expect(data.data).toContain("<untrusted-scraped-data-");
  });
});

// ---------------------------------------------------------------------------
// getRunSteps
// ---------------------------------------------------------------------------

describe("getRunSteps", () => {
  it("maps camelCase gateway fields to snake_case MCP fields", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/executions/:id/steps`, () =>
        HttpResponse.json(makeSteps()),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.getRunSteps({
      execution_id: "exec-1111-2222-3333-444444444444",
    });
    const data = parseContent(result) as {
      steps: Array<{ block_id: string; block_type: string; duration_ms: number }>;
    };

    expect(data.steps).toHaveLength(1);
    expect(data.steps[0].block_id).toBe("block-1");
    expect(data.steps[0].block_type).toBe("navigate");
    expect(data.steps[0].duration_ms).toBe(5000); // 5s between startedAt and endedAt
  });
});

// ---------------------------------------------------------------------------
// listRuns
// ---------------------------------------------------------------------------

describe("listRuns", () => {
  it("maps projectId→flow_id, projectTitle→flow_title, creditsUsed→credits_used", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/executions`, () =>
        HttpResponse.json({
          executions: [makeExecution()],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.listRuns({});
    const data = parseContent(result) as {
      executions: Array<{
        flow_id: string;
        flow_title: string;
        credits_used: number;
        status: string;
      }>;
      total: number;
      has_more: boolean;
    };

    expect(data.executions[0].flow_id).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    expect(data.executions[0].flow_title).toBe("My Scraper");
    expect(data.executions[0].credits_used).toBe(5);
    expect(data.executions[0].status).toBe("completed");
    expect(data.total).toBe(1);
    expect(data.has_more).toBe(false);
  });

  it("maps MCP active filter → gateway started filter", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE_URL}/api/v1/executions`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          executions: [],
          total: 0,
          limit: 20,
          offset: 0,
        });
      }),
    );

    const handlers = makeHandlers();
    await handlers.listRuns({ status: "active" });

    expect(capturedUrl).toContain("status=started");
  });

  it("passes flow_id as projectId query param", async () => {
    let capturedUrl = "";
    server.use(
      http.get(`${BASE_URL}/api/v1/executions`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({
          executions: [],
          total: 0,
          limit: 20,
          offset: 0,
        });
      }),
    );

    const handlers = makeHandlers();
    await handlers.listRuns({ flow_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });

    expect(capturedUrl).toContain(
      "projectId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });

  it("normalizes started → active in execution list output", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/executions`, () =>
        HttpResponse.json({
          executions: [makeExecution({ status: "started" })],
          total: 1,
          limit: 20,
          offset: 0,
        }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.listRuns({});
    const data = parseContent(result) as {
      executions: Array<{ status: string }>;
    };
    expect(data.executions[0].status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// cancelRun
// ---------------------------------------------------------------------------

describe("cancelRun", () => {
  it("looks up workflow_id from execution and cancels", async () => {
    let cancelCalled = false;
    server.use(
      http.get(`${BASE_URL}/api/v1/executions/:id`, () =>
        HttpResponse.json({
          ...makeExecution({ status: "started" }),
          workflowId: "wf-cancel-test",
        }),
      ),
      http.post(
        `${BASE_URL}/api/v1/cloud/run/:workflowId/cancel`,
        ({ params }) => {
          if (params.workflowId === "wf-cancel-test") cancelCalled = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.cancelRun({
      execution_id: "exec-1111-2222-3333-444444444444",
    });
    const data = parseContent(result) as { status: string };

    expect(cancelCalled).toBe(true);
    expect(data.status).toBe("cancelled");
  });

  it("returns error when workflow_id is not available", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/executions/:id`, () =>
        // No workflowId field, no workflow_id in data
        HttpResponse.json(makeExecution({ data: {} })),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.cancelRun({
      execution_id: "exec-1111-2222-3333-444444444444",
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(result.content[0].text).toContain("workflow ID not found");
  });
});

// ---------------------------------------------------------------------------
// Error handling (withErrorHandling wrapper)
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("returns isError: true with actionable message on 401", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects`, () =>
        HttpResponse.json({ error: "unauthorized" }, { status: 401 }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.listFlows({});

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(result.content[0].text).toContain("API key");
    expect(result.content[0].text).toContain("scrapeer.com");
  });

  it("returns isError: true on 404", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects/:id`, () =>
        HttpResponse.json({ error: "not found" }, { status: 404 }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.getFlow({
      flow: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(result.content[0].text).toContain("scrapeer_list_flows");
  });

  it("returns isError: true on 429", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects`, () =>
        HttpResponse.json({ error: "rate limited" }, { status: 429 }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.listFlows({});

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(result.content[0].text).toContain("Rate limited");
  });

  it("returns isError: true on 5xx", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects`, () =>
        HttpResponse.json({ error: "internal" }, { status: 500 }),
      ),
    );

    const handlers = makeHandlers();
    const result = await handlers.listFlows({});

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(result.content[0].text).toContain("unavailable");
  });
});
