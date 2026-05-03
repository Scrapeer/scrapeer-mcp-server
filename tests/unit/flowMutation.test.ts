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

const noopSleep = () => Promise.resolve();
function makeClient() {
  return new ScrapeerClient(API_KEY, BASE_URL);
}
function makeHandlers(client?: ScrapeerClient) {
  return { client: client ?? makeClient(), get handlers() { return createHandlers(this.client, noopSleep); } };
}
function parseContent(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// scrapeer_get_block_catalog
// ---------------------------------------------------------------------------

describe("getBlockCatalog", () => {
  it("returns the catalog with block_count and blocks array", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/blocks/catalog`, () =>
        HttpResponse.json({
          version: "1",
          blocks: [
            {
              type: "start",
              displayName: "Start",
              category: "navigation",
              hasErrorHandle: false,
              customFields: [],
            },
            {
              type: "clickElement",
              displayName: "Click Element",
              category: "web-interaction",
              hasErrorHandle: true,
              customFields: [
                { name: "selector", type: "string", required: true },
              ],
            },
          ],
        }),
      ),
    );

    const { handlers } = makeHandlers();
    const result = await handlers.getBlockCatalog({});
    const parsed = parseContent(result) as {
      version: string;
      block_count: number;
      blocks: Array<{ type: string }>;
    };
    expect(parsed.version).toBe("1");
    expect(parsed.block_count).toBe(2);
    expect(parsed.blocks.map((b) => b.type)).toEqual(["start", "clickElement"]);
  });
});

// ---------------------------------------------------------------------------
// scrapeer_validate_flow
// ---------------------------------------------------------------------------

describe("validateFlow", () => {
  it("returns ok=true with no errors for a valid flow", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/flows/validate`, () =>
        HttpResponse.json({ ok: true, errors: [], warnings: [] }),
      ),
    );

    const { handlers } = makeHandlers();
    const result = await handlers.validateFlow({
      flow: {
        nodes: [{ id: "s1", type: "start" }],
        edges: [],
      },
    });
    const parsed = parseContent(result) as { ok: boolean; errors: unknown[]; warnings: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("surfaces structural errors verbatim", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/flows/validate`, () =>
        HttpResponse.json({
          ok: false,
          errors: [{ code: "structural", message: "flow has no nodes" }],
        }),
      ),
    );

    const { handlers } = makeHandlers();
    const result = await handlers.validateFlow({
      flow: { nodes: [], edges: [] },
    });
    const parsed = parseContent(result) as { ok: boolean; errors: Array<{ code: string }> };
    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0].code).toBe("structural");
  });
});

// ---------------------------------------------------------------------------
// scrapeer_create_flow
// ---------------------------------------------------------------------------

describe("createFlow", () => {
  it("returns the new flow ID", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/projects`, () =>
        HttpResponse.json({
          id: "PROJECT_CREATE_SUCCESS",
          message: "Created",
          projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          projectEventID: "11111111-2222-3333-4444-555555555555",
        }),
      ),
    );

    const { handlers } = makeHandlers();
    const result = await handlers.createFlow({ title: "New Scraper" });
    const parsed = parseContent(result) as { flow_id: string; title: string };
    expect(parsed.flow_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(parsed.title).toBe("New Scraper");
  });

  it("caches the new event_id so patch_flow works without get_flow", async () => {
    const newId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    let capturedPatchBody: Record<string, unknown> | null = null;

    server.use(
      http.post(`${BASE_URL}/api/v1/projects`, () =>
        HttpResponse.json({
          id: "PROJECT_CREATE_SUCCESS",
          message: "Created",
          projectId: newId,
          projectEventID: "11111111-2222-3333-4444-555555555555",
        }),
      ),
      http.post(`${BASE_URL}/api/v1/projects/${newId}/patch`, async ({ request }) => {
        capturedPatchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: "PROJECT_UPDATE_SUCCESS",
          message: "Patched",
          projectEventID: "22222222-3333-4444-5555-666666666666",
          operationSummaries: [],
          flow: { nodes: [], edges: [] },
        });
      }),
    );

    const ctx = makeHandlers();
    await ctx.handlers.createFlow({ title: "fresh" });

    // No get_flow in between — the cache must already have the EventID
    // from create.
    await ctx.handlers.patchFlow({
      flow: newId,
      operations: [{ op: "remove_block", blockId: "x" }],
    });

    expect(capturedPatchBody?.baseProjectEventID).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
  });
});

// ---------------------------------------------------------------------------
// scrapeer_update_flow — auto-attaches cached event_id
// ---------------------------------------------------------------------------

describe("updateFlow", () => {
  const flowId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("attaches cached event_id from prior get_flow as baseProjectEventID", async () => {
    let receivedBody: Record<string, unknown> | null = null;

    server.use(
      // get_flow → populates the client's eventID cache
      http.get(`${BASE_URL}/api/v1/projects/${flowId}`, () =>
        HttpResponse.json({
          ID: flowId,
          Title: "test",
          Data: btoa(JSON.stringify({ nodes: [], edges: [] })),
          CreatedAt: "2026-01-01T00:00:00Z",
          UpdatedAt: "2026-01-02T00:00:00Z",
          EventID: "11111111-2222-3333-4444-555555555555",
        }),
      ),
      // update → server captures the body so we can assert
      http.put(`${BASE_URL}/api/v1/projects/${flowId}/data`, async ({ request }) => {
        receivedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          id: "PROJECT_UPDATE_SUCCESS",
          message: "Saved",
          projectEventID: "99999999-8888-7777-6666-555555555555",
        });
      }),
    );

    const ctx = makeHandlers();

    // Prime the cache via get_flow.
    await ctx.handlers.getFlow({ flow: flowId });

    const result = await ctx.handlers.updateFlow({
      flow: flowId,
      data: { nodes: [], edges: [] },
    });

    expect(receivedBody?.baseProjectEventID).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    const parsed = parseContent(result) as { new_event_id: string };
    expect(parsed.new_event_id).toBe("99999999-8888-7777-6666-555555555555");
  });

  it("surfaces a 409 conflict with the server's current event_id", async () => {
    server.use(
      http.put(`${BASE_URL}/api/v1/projects/${flowId}/data`, () =>
        HttpResponse.json(
          {
            error: "project was modified since baseProjectEventID was issued",
            currentProjectEventID: "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
          },
          { status: 409 },
        ),
      ),
    );

    const { handlers } = makeHandlers();
    const result = await handlers.updateFlow({
      flow: flowId,
      data: { nodes: [], edges: [] },
      baseProjectEventID: "stale-event-id",
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb");
    expect(text).toMatch(/scrapeer_get_flow/);
  });
});

// ---------------------------------------------------------------------------
// scrapeer_patch_flow
// ---------------------------------------------------------------------------

describe("patchFlow", () => {
  const flowId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("returns operations_applied count and the post-patch flow", async () => {
    server.use(
      http.post(`${BASE_URL}/api/v1/projects/${flowId}/patch`, () =>
        HttpResponse.json({
          id: "PROJECT_UPDATE_SUCCESS",
          message: "Patch applied successfully",
          projectEventID: "99999999-8888-7777-6666-555555555555",
          operationSummaries: [
            { index: 0, op: "add_block", detail: "added block n1" },
          ],
          flow: {
            nodes: [{ id: "n1", type: "start" }],
            edges: [],
          },
        }),
      ),
    );

    const { handlers } = makeHandlers();
    const result = await handlers.patchFlow({
      flow: flowId,
      operations: [
        { op: "add_block", node: { id: "n1", type: "start" } },
      ],
    });
    const parsed = parseContent(result) as {
      operations_applied: number;
      summaries: Array<{ op: string }>;
      flow: { nodes: Array<{ id: string }> };
    };
    expect(parsed.operations_applied).toBe(1);
    expect(parsed.summaries[0].op).toBe("add_block");
    expect(parsed.flow.nodes[0].id).toBe("n1");
  });

  it("invalidates the cached event_id on 409", async () => {
    server.use(
      http.get(`${BASE_URL}/api/v1/projects/${flowId}`, () =>
        HttpResponse.json({
          ID: flowId,
          Title: "test",
          Data: btoa(JSON.stringify({ nodes: [], edges: [] })),
          CreatedAt: "2026-01-01T00:00:00Z",
          UpdatedAt: "2026-01-02T00:00:00Z",
          EventID: "11111111-2222-3333-4444-555555555555",
        }),
      ),
      http.post(`${BASE_URL}/api/v1/projects/${flowId}/patch`, () =>
        HttpResponse.json(
          {
            error: "stale",
            currentProjectEventID: "ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb",
          },
          { status: 409 },
        ),
      ),
    );

    const ctx = makeHandlers();
    await ctx.handlers.getFlow({ flow: flowId });
    expect(ctx.client.getCachedEventID(flowId)).toBe(
      "11111111-2222-3333-4444-555555555555",
    );

    await ctx.handlers.patchFlow({
      flow: flowId,
      operations: [{ op: "remove_block", blockId: "x" }],
    });

    // 409 must clear the stale cache so the next call doesn't reuse it.
    expect(ctx.client.getCachedEventID(flowId)).toBeUndefined();
  });
});
