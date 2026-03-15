import { randomUUID } from "node:crypto";

export function wrapUntrustedData(data: unknown): string {
  const boundary = randomUUID();
  return `<untrusted-scraped-data-${boundary}>\n${JSON.stringify(data, null, 2)}\n</untrusted-scraped-data-${boundary}>`;
}

export function formatToolResponse(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
  };
}

export function formatToolResponseWithUntrustedData(
  metadata: Record<string, unknown>,
  untrustedData: unknown,
) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...metadata,
          data: wrapUntrustedData(untrustedData),
        }),
      },
    ],
  };
}

export function formatErrorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}
