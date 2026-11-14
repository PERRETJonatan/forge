import { env } from "../env.js";
import { CoachLlmError, type CoachLlm } from "./ollama-client.js";

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

export function createOpenAiClient(): CoachLlm {
  return {
    async chat(messages, schema) {
      let res: Response;
      try {
        res = await fetch(`${env.coachLlmUrl}/v1/chat/completions`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            model: env.coachLlmModel,
            messages,
            temperature: 0.4,
            // Structured output: the server constrains generation to this JSON schema.
            response_format: { type: "json_schema", json_schema: { name: "coach_reply", schema } },
            // Qwen3-style reasoning models otherwise think at length before every answer;
            // templates without a thinking switch ignore it.
            chat_template_kwargs: { enable_thinking: false },
          }),
          signal: AbortSignal.timeout(env.ollamaTimeoutMs),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "TimeoutError") {
          throw new CoachLlmError("The coach took too long to answer. Try again, or a shorter question.", 504);
        }
        throw unreachable();
      }
      if (!res.ok) throw await errorFrom(res);
      const body = (await res.json()) as ChatCompletionResponse;
      return body.choices?.[0]?.message?.content ?? "";
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
