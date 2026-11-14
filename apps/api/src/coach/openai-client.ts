import { env } from "../env.js";
import { CoachLlmError, type ChatTurn, type CoachLlm } from "./ollama-client.js";

/**
 * The coach's model behind an OpenAI-compatible server (vLLM, llama.cpp's llama-server...),
 * selected with COACH_LLM_API=openai. Same contract as the Ollama client: a JSON reply
 * constrained to the given schema.
 */

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[];
}

interface ModelsResponse {
  data?: { id: string }[];
}

/**
 * Unlike Ollama, some OpenAI-compatible servers (strata among them) treat `json_schema` as
 * best effort: they prompt for it and at most check the reply parses. With the coach's
 * prompt -- which describes a workout in detail -- the model then often answers with a bare
 * workout instead of {reply, workout}, or in plain text, which such a server may reject as
 * "structured_output_failed" and throw away. Seen live: 1 answer in 4 had the right shape,
 * while the same request without `response_format` got a sound plain-text answer every time.
 *
 * So: ask for the schema up to STRUCTURED_ATTEMPTS times, salvaging a bare workout; then ask
 * once more without `response_format` and, for schemas with a "reply", take plain text as it.
 */
const STRUCTURED_ATTEMPTS = 2;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (env.coachLlmApiKey) h.Authorization = `Bearer ${env.coachLlmApiKey}`;
  return h;
}

function unreachable(): CoachLlmError {
  return new CoachLlmError(`The coach is offline: can't reach the model server at ${env.coachLlmUrl}.`, 503);
}

async function errorFrom(res: Response): Promise<CoachLlmError> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
  const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
  if (res.status === 404) {
    return new CoachLlmError(`The coach's model "${env.coachLlmModel}" isn't served at ${env.coachLlmUrl}.`, 503);
  }
  return new CoachLlmError(`The coach's model failed to answer: ${detail ?? `HTTP ${res.status}`}`, 502);
}

interface CoachSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

/**
 * Brings an answer into the schema's top-level shape, or returns null if it can't. `allowText`
 * accepts a plain-text answer as the "reply" (with every other required key null).
 */
export function coerceToSchema(raw: string, schema: object, allowText: boolean): string | null {
  const { properties = {}, required = [] } = schema as CoachSchema;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const text = raw.trim();
    if (!allowText || !text || !("reply" in properties)) return null;
    return JSON.stringify(Object.fromEntries(required.map((key) => [key, key === "reply" ? text : null])));
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (required.every((key) => key in parsed)) return raw;
  // The model answered with just the workout: wrap it, leaving the text fields empty.
  if ("workout" in properties && "sets" in parsed) {
    return JSON.stringify(Object.fromEntries(required.map((key) => [key, key === "workout" ? parsed : ""])));
  }
  return null;
}

/** The server's own "the model didn't return valid JSON" -- worth another try, not an outage. */
async function isStructuredOutputFailure(res: Response): Promise<boolean> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string; type?: string } } | null;
  return body?.error?.code === "structured_output_failed" || body?.error?.type === "structured_output_failed";
}

async function complete(messages: ChatTurn[], schema: object | null, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${env.coachLlmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: env.coachLlmModel,
        messages,
        temperature: 0.4,
        // Structured output: the server constrains (or at least asks for) this JSON schema.
        ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "coach_reply", schema } } } : {}),
        // Qwen3-style reasoning models otherwise think at length before every answer;
        // templates without a thinking switch ignore it.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new CoachLlmError("The coach took too long to answer. Try again, or a shorter question.", 504);
    }
    throw unreachable();
  }
}

export function createOpenAiClient(): CoachLlm {
  return {
    async chat(messages, schema) {
      // One deadline for all attempts, so retries never outlast the proxy in front of the API.
      const signal = AbortSignal.timeout(env.ollamaTimeoutMs);
      let lastError: CoachLlmError | null = null;
      for (let attempt = 1; attempt <= STRUCTURED_ATTEMPTS + 1; attempt++) {
        const structured = attempt <= STRUCTURED_ATTEMPTS;
        const res = await complete(messages, structured ? schema : null, signal);
        if (!res.ok) {
          if (!(await isStructuredOutputFailure(res))) throw await errorFrom(res);
          lastError = await errorFrom(res);
          continue;
        }
        const body = (await res.json()) as ChatCompletionResponse;
        const answer = coerceToSchema(body.choices?.[0]?.message?.content ?? "", schema, !structured);
        if (answer) return answer;
      }
      throw lastError ?? new CoachLlmError("The coach's answer came back garbled. Try again.", 502);
    },

    async status() {
      try {
        const res = await fetch(`${env.coachLlmUrl}/v1/models`, { headers: headers(), signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw await errorFrom(res);
        const { data = [] } = (await res.json()) as ModelsResponse;
        if (!data.some((m) => m.id === env.coachLlmModel)) {
          return {
            model: env.coachLlmModel,
            available: false,
            error: `Model "${env.coachLlmModel}" isn't served at ${env.coachLlmUrl} (it serves: ${data.map((m) => m.id).join(", ") || "nothing"}).`,
          };
        }
        return { model: env.coachLlmModel, available: true, error: null };
      } catch (err) {
        const message = err instanceof CoachLlmError ? err.message : unreachable().message;
        return { model: env.coachLlmModel, available: false, error: message };
      }
    },
  };
}
