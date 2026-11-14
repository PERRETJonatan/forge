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
 * Unlike Ollama, some OpenAI-compatible servers treat `json_schema` as best effort: they
 * prompt for it and at most check the reply parses, so the model can still answer in another
 * shape (a bare workout instead of {reply, workout}) or not in JSON at all -- most often a few
 * turns into a conversation, once its earlier replies in the history are plain text. Each
 * answer is checked against the schema's top-level required keys and retried a few times.
 */
const ATTEMPTS = 3;

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

function hasRequiredKeys(raw: string, schema: object): boolean {
  const required = (schema as { required?: unknown }).required;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return !Array.isArray(required) || required.every((key) => typeof key === "string" && key in parsed);
  } catch {
    return false;
  }
}

/** The server's own "the model didn't return valid JSON" -- worth another try, not an outage. */
async function isStructuredOutputFailure(res: Response): Promise<boolean> {
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as { error?: { code?: string; type?: string } } | null;
  return body?.error?.code === "structured_output_failed" || body?.error?.type === "structured_output_failed";
}

async function complete(messages: ChatTurn[], schema: object, signal: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${env.coachLlmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: env.coachLlmModel,
        messages,
        temperature: 0.4,
        // Structured output: the server constrains (or at least asks for) this JSON schema.
        response_format: { type: "json_schema", json_schema: { name: "coach_reply", schema } },
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
      let content = "";
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const res = await complete(messages, schema, signal);
        if (!res.ok) {
          if (attempt < ATTEMPTS && (await isStructuredOutputFailure(res))) continue;
          throw await errorFrom(res);
        }
        const body = (await res.json()) as ChatCompletionResponse;
        content = body.choices?.[0]?.message?.content ?? "";
        if (hasRequiredKeys(content, schema)) return content;
      }
      // Still off-shape after every attempt: hand it back and let the coach service report it.
      return content;
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
