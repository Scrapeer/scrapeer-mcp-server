import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ScrapeerClient } from "../../src/client.js";
import { AuthenticationError, FlowNotFoundError, RateLimitedError, GatewayError } from "../../src/errors.js";

const BASE_URL = "https://api.test.scrapeer.com";
const API_KEY = "sk_test123456789";

const server = setupServer();

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ScrapeerClient", () => {
  const client = new ScrapeerClient(API_KEY, BASE_URL);

  describe("listProjects", () => {
    it("sends correct auth header and query params", async () => {
      let capturedHeaders: Headers | undefined;
      let capturedUrl: string | undefined;

      server.use(
        http.get(`${BASE_URL}/api/v1/projects`, ({ request }) => {
          capturedHeaders = request.headers;
          capturedUrl = request.url;
          return HttpResponse.json({
            projects: [{ id: "abc", title: "Test", created_at: "2026-01-01", updated_at: "2026-01-01" }],
            projectCount: 1,
            projectLimit: 20,
          });
        }),
      );

      const result = await client.listProjects(10, 5);
      expect(capturedHeaders?.get("authorization")).toBe(`Bearer ${API_KEY}`);
      expect(capturedUrl).toContain("limit=10");
      expect(capturedUrl).toContain("offset=5");
      expect(result.projects).toHaveLength(1);
    });
  });

  describe("getProject", () => {
    it("fetches project by ID", async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/projects/:id`, ({ params }) => {
          return HttpResponse.json({
            id: params.id,
            title: "My Flow",
            data: { nodes: [] },
            created_at: "2026-01-01",
            updated_at: "2026-01-01",
          });
        }),
      );

      const result = await client.getProject("flow-123");
      expect(result.id).toBe("flow-123");
      expect(result.title).toBe("My Flow");
    });
  });

  describe("triggerCloudRun", () => {
    it("sends project_id in body", async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${BASE_URL}/api/v1/cloud/run`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({
            workflow_id: "wf_1",
            execution_id: "ex_1",
            run_id: "run_1",
          });
        }),
      );

      const result = await client.triggerCloudRun("proj-123", 100);
      expect((capturedBody as Record<string, unknown>).project_id).toBe("proj-123");
      expect((capturedBody as Record<string, unknown>).max_total_credits).toBe(100);
      expect(result.execution_id).toBe("ex_1");
    });
  });

  describe("error handling", () => {
    it("throws AuthenticationError on 401", async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/projects`, () => {
          return HttpResponse.json({ error: "unauthorized" }, { status: 401 });
        }),
      );
      await expect(client.listProjects()).rejects.toThrow(AuthenticationError);
    });

    it("throws FlowNotFoundError on 404", async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/projects/:id`, () => {
          return HttpResponse.json({ error: "not found" }, { status: 404 });
        }),
      );
      await expect(client.getProject("nonexistent")).rejects.toThrow(FlowNotFoundError);
    });

    it("throws RateLimitedError on 429", async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/projects`, () => {
          return HttpResponse.json({ error: "rate limited" }, { status: 429 });
        }),
      );
      await expect(client.listProjects()).rejects.toThrow(RateLimitedError);
    });

    it("throws GatewayError on 500", async () => {
      server.use(
        http.get(`${BASE_URL}/api/v1/projects`, () => {
          return HttpResponse.json({ error: "internal" }, { status: 500 });
        }),
      );
      await expect(client.listProjects()).rejects.toThrow(GatewayError);
    });
  });

  describe("cancelRun", () => {
    it("sends POST to cancel endpoint", async () => {
      let called = false;
      server.use(
        http.post(`${BASE_URL}/api/v1/cloud/run/:workflowId/cancel`, () => {
          called = true;
          return new HttpResponse(null, { status: 204 });
        }),
      );
      await client.cancelRun("wf-123");
      expect(called).toBe(true);
    });
  });
});
