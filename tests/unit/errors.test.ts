import { describe, it, expect } from "vitest";
import {
  ScrapeerError,
  AuthenticationError,
  ForbiddenError,
  FlowNotFoundError,
  RateLimitedError,
  QuotaExceededError,
  GatewayError,
  classifyHttpError,
} from "../../src/errors.js";

describe("Error classes", () => {
  it("ScrapeerError has statusCode", () => {
    const err = new ScrapeerError("test", 500);
    expect(err.message).toBe("test");
    expect(err.statusCode).toBe(500);
    expect(err).toBeInstanceOf(Error);
  });

  it("AuthenticationError is 401", () => {
    const err = new AuthenticationError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain("API key");
  });

  it("FlowNotFoundError is 404", () => {
    const err = new FlowNotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.message).toContain("scrapeer_list_flows");
  });

  it("QuotaExceededError is 402", () => {
    const err = new QuotaExceededError();
    expect(err.statusCode).toBe(402);
    expect(err.message).toContain("credits");
  });
});

describe("classifyHttpError", () => {
  it("maps 401 to AuthenticationError", () => {
    const err = classifyHttpError(401, "unauthorized");
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("maps 402 to QuotaExceededError", () => {
    const err = classifyHttpError(402, "payment required");
    expect(err).toBeInstanceOf(QuotaExceededError);
  });

  it("maps 403 to ForbiddenError", () => {
    const err = classifyHttpError(403, "forbidden");
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it("maps 403 with entitlement body to QuotaExceededError", () => {
    const err = classifyHttpError(403, '{"error":"ENTITLEMENT_DENIED"}');
    expect(err).toBeInstanceOf(QuotaExceededError);
  });

  it("maps 404 to FlowNotFoundError", () => {
    const err = classifyHttpError(404, "not found");
    expect(err).toBeInstanceOf(FlowNotFoundError);
  });

  it("maps 429 to RateLimitedError", () => {
    const err = classifyHttpError(429, "too many requests");
    expect(err).toBeInstanceOf(RateLimitedError);
  });

  it("maps 5xx to GatewayError", () => {
    const err = classifyHttpError(502, "bad gateway");
    expect(err).toBeInstanceOf(GatewayError);
  });

  it("maps unknown status to GatewayError", () => {
    const err = classifyHttpError(418, "teapot");
    expect(err).toBeInstanceOf(GatewayError);
  });
});
