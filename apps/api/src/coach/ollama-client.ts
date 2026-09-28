import type { CoachStatus } from "@forge/shared";
import { env } from "../env.js";

export class CoachLlmError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * The language model behind the virtual coach, injectable so the coach's context building,
 * draft validation and persistence can be tested against a fake instead of a live Ollama
 * server (see tests/coach.test.ts) -- same pattern as StravaClient.
 */
export interface CoachLlm {
  /** Sends the conversation and returns the model's reply: a JSON string matching `schema`. */
  chat(messages: ChatTurn[], schema: object): Promise<string>;
  status(): Promise<CoachStatus>;
}

// The system prompt carries the athlete's context (a few weeks of workouts), plus the recent
// history -- more than Ollama's small default context window holds.
const CONTEXT_WINDOW_TOKENS = 16_384;

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OllamaTagsResponse {
  models?: { name: string }[];
}

/** Ollama lists "llama3.1" as "llama3.1:latest". */
function sameModel(listed: string, configured: string): boolean {
  const withTag = (name: string) => (name.includes(":") ? name : `${name}:latest`);
  return withTag(listed) === withTag(configured);
}

function unreachable(): CoachLlmError {
  return new CoachLlmError(`The coach is offline: can't reach the Ollama server at ${env.ollamaUrl}.`, 503);
}

async function errorFrom(res: Response): Promise<CoachLlmError> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 404) {
    return new CoachLlmError(
      `The coach's model "${env.ollamaModel}" isn't installed on the Ollama server (ollama pull ${env.ollamaModel}).`,
      503,
    );
  }
  return new CoachLlmError(`The coach's model failed to answer: ${body?.error ?? `HTTP ${res.status}`}`, 502);
}

export function createOllamaClient(): CoachLlm {
  return {
    async chat(messages, schema) {
      let res: Response;
      try {
        res = await fetch(`${env.ollamaUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: env.ollamaModel,
            messages,
            stream: false,
            // Structured output: Ollama constrains generation to this JSON schema.
            format: schema,
            // Reasoning models (qwen3, deepseek-r1...) otherwise think at length before every
            // answer -- minutes on a local machine. Models without a thinking mode ignore it.
            think: false,
            options: { temperature: 0.4, num_ctx: CONTEXT_WINDOW_TOKENS },
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
      const body = (await res.json()) as OllamaChatResponse;
      return body.message?.content ?? "";
    },

    async status() {
      try {
        const res = await fetch(`${env.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw await errorFrom(res);
        const { models = [] } = (await res.json()) as OllamaTagsResponse;
        if (!models.some((m) => sameModel(m.name, env.ollamaModel))) {
          return {
            model: env.ollamaModel,
            available: false,
            error: `Model "${env.ollamaModel}" isn't installed on the Ollama server (ollama pull ${env.ollamaModel}).`,
          };
        }
        return { model: env.ollamaModel, available: true, error: null };
      } catch (err) {
        const message = err instanceof CoachLlmError ? err.message : unreachable().message;
        return { model: env.ollamaModel, available: false, error: message };
      }
    },
  };
}
