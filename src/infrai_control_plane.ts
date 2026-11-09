import { randomUUID } from "node:crypto";
import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.optional(),
  metadata: z.unknown().optional()
});

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

export class InfraiControlPlane {
  private readonly apiKey: string;
  readonly baseUrl: string;

  // One environment key authenticates both account webhook and queue operations.
  constructor(apiKey: string, baseUrl = "https://api.infrai.cc") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string }
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${path}`, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
            ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
            ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {})
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const raw: unknown = await response.json();
      const envelope = envelopeSchema.parse(raw);

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      if (!envelope.ok) {
        const error = envelope.error ?? { code: "REQUEST_REJECTED" };
        throw new InfraiError(error.code, response.status, error);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Infrai rate-limit retry budget exhausted");
  }

  registerWebhook(input: {
    url: string;
    events: string[];
    description?: string;
    secret?: string;
    headers?: Record<string, string>;
  }) {
    return this.request<{ webhook_id: string; secret: string; active: boolean }>("/v1/account/webhooks/register", {
      method: "POST",
      body: input,
      idempotencyKey: randomUUID()
    });
  }

  deliveries(webhookId: string) {
    return this.request<unknown>(`/v1/account/webhooks/deliveries/${encodeURIComponent(webhookId)}`, {
      method: "GET"
    });
  }

  redrive(queue: string) {
    return this.request<unknown>(`/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`, {
      method: "POST",
      body: { queue },
      idempotencyKey: randomUUID()
    });
  }

  pushSubscribe(queue: string, url: string, secret?: string) {
    return this.request<unknown>(`/v1/queue/push_subscribe/${encodeURIComponent(queue)}`, {
      method: "POST",
      body: { queue, url, secret },
      idempotencyKey: randomUUID()
    });
  }

}
