export class ScrapeerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AuthenticationError extends ScrapeerError {
  constructor() {
    super(
      "Invalid API key. Check your SCRAPEER_API_KEY or generate a new one at https://app.scrapeer.com/settings",
      401,
    );
  }
}

export class ForbiddenError extends ScrapeerError {
  constructor() {
    super("You don't have permission to access this resource.", 403);
  }
}

export class FlowNotFoundError extends ScrapeerError {
  constructor() {
    super(
      "Flow not found. Use scrapeer_list_flows to see your available flows.",
      404,
    );
  }
}

export class RateLimitedError extends ScrapeerError {
  constructor() {
    super("Rate limited. Wait a moment and try again.", 429);
  }
}

export class QuotaExceededError extends ScrapeerError {
  constructor() {
    super(
      "Insufficient credits to run this flow. Top up at https://app.scrapeer.com/billing",
      402,
    );
  }
}

export class GatewayError extends ScrapeerError {
  constructor(message?: string) {
    super(
      message || "Scrapeer service is temporarily unavailable. Try again shortly.",
      502,
    );
  }
}

export class ValidationError extends ScrapeerError {
  constructor(message?: string) {
    super(message || "Request failed validation.", 400);
  }
}

/**
 * 409 Conflict - the flow was modified between the caller's last
 * `get_flow` and this save/patch attempt. Carries the server's current
 * event_id so the caller can refetch and retry. The MCP layer uses this
 * to invalidate its event_id cache and surface a structured retry hint
 * to the model.
 */
export class FlowConflictError extends ScrapeerError {
  readonly currentProjectEventID: string | null;

  constructor(currentProjectEventID: string | null) {
    super(
      "The flow was modified by another caller (another tab, an MCP tool, or a scheduled run). " +
        "Re-fetch the flow with scrapeer_get_flow to see the current version, then retry the patch or update.",
      409,
    );
    this.currentProjectEventID = currentProjectEventID;
  }
}

/**
 * Parse the API error envelope from the response body.
 * Envelope format: {"error": {"code": "unauthorized", "message": "...", ...}}
 */
function parseAPIError(body: string): { code: string; message?: string } | null {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error?.code && typeof parsed.error.code === "string") {
      return {
        code: parsed.error.code,
        message: typeof parsed.error.message === "string" ? parsed.error.message : undefined,
      };
    }
  } catch {
    // Not JSON - fall through to status-based classification
  }
  return null;
}

function parseValidationMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body);

    if (typeof parsed?.error === "string") {
      if (typeof parsed.detail === "string" && parsed.detail.trim()) {
        return `${parsed.error}: ${parsed.detail}`;
      }
      if (typeof parsed.description === "string" && parsed.description.trim()) {
        return `${parsed.error}: ${parsed.description}`;
      }
      return parsed.error;
    }

    if (typeof parsed?.error?.message === "string") {
      return parsed.error.message;
    }

    if (typeof parsed?.message === "string") {
      return parsed.message;
    }
  } catch {
    const trimmed = body.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

export function classifyHttpError(status: number, body: string): ScrapeerError {
  const apiError = parseAPIError(body);

  // Match on API error code when available (new envelope format)
  if (apiError) {
    switch (apiError.code) {
      case "unauthorized":
        return new AuthenticationError();
      case "forbidden":
        // Check for entitlement/credits context in details
        if (body.includes("credits") || body.includes("ENTITLEMENT_DENIED")) {
          return new QuotaExceededError();
        }
        return new ForbiddenError();
      case "not_found":
        return new FlowNotFoundError();
      case "rate_limit_exceeded":
        return new RateLimitedError();
      case "validation_error":
      case "runnable_validation_failed":
        return new ValidationError(apiError.message);
      case "capacity_unavailable":
        return new GatewayError(
          "Scrapeer cloud capacity is temporarily unavailable. Try again shortly.",
        );
      default:
        break;
    }
  }

  // Fall back to HTTP status code classification (legacy format or unknown codes)
  switch (status) {
    case 401:
      return new AuthenticationError();
    case 402:
      return new QuotaExceededError();
    case 403:
      if (body.includes("ENTITLEMENT_DENIED") || body.includes("credits")) {
        return new QuotaExceededError();
      }
      return new ForbiddenError();
    case 400:
    case 422:
      return new ValidationError(parseValidationMessage(body) ?? undefined);
    case 404:
      return new FlowNotFoundError();
    case 409: {
      // Optimistic concurrency conflict on flow save/patch. Pull the
      // current event_id out of the body so the caller can refetch.
      let currentEventID: string | null = null;
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed?.currentProjectEventID === "string") {
          currentEventID = parsed.currentProjectEventID;
        }
      } catch {
        // Body wasn't JSON - leave currentEventID null; the caller
        // still gets the structured error and message.
      }
      return new FlowConflictError(currentEventID);
    }
    case 413:
      return new ScrapeerError(
        "Flow payload is too large for the gateway. Reduce the flow size or break the change into smaller patches.",
        413,
      );
    case 429:
      return new RateLimitedError();
    default:
      return new GatewayError();
  }
}
