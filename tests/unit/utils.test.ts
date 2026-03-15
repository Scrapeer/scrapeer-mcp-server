import { describe, it, expect } from "vitest";
import { wrapUntrustedData, formatToolResponse, formatErrorResponse } from "../../src/utils.js";

describe("wrapUntrustedData", () => {
  it("wraps data with boundary tags", () => {
    const result = wrapUntrustedData({ title: "Test" });
    expect(result).toMatch(/^<untrusted-scraped-data-[a-f0-9-]+>/);
    expect(result).toMatch(/<\/untrusted-scraped-data-[a-f0-9-]+>$/);
    expect(result).toContain('"title": "Test"');
  });

  it("produces unique boundaries per call", () => {
    const r1 = wrapUntrustedData("a");
    const r2 = wrapUntrustedData("a");
    const id1 = r1.match(/untrusted-scraped-data-([a-f0-9-]+)/)?.[1];
    const id2 = r2.match(/untrusted-scraped-data-([a-f0-9-]+)/)?.[1];
    expect(id1).not.toBe(id2);
  });

  it("handles null, arrays, nested objects", () => {
    expect(() => wrapUntrustedData(null)).not.toThrow();
    expect(() => wrapUntrustedData([1, 2, 3])).not.toThrow();
    expect(() => wrapUntrustedData({ a: { b: "c" } })).not.toThrow();
  });
});

describe("formatToolResponse", () => {
  it("returns content array with text type", () => {
    const result = formatToolResponse({ status: "ok" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ status: "ok" });
  });
});

describe("formatErrorResponse", () => {
  it("returns isError true with message", () => {
    const result = formatErrorResponse("something went wrong");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("something went wrong");
  });
});
