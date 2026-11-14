import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachLlmError } from "../src/coach/ollama-client.js";
import { createOpenAiClient } from "../src/coach/openai-client.js";
import { env } from "../src/env.js";

const schema = {
  type: "object",
  properties: { reply: { type: "string" }, workout: { type: ["object", "null"] } },
  required: ["reply", "workout"],
};
const messages = [{ role: "user" as const, content: "Plan me a long ride." }];

function completion(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), { status: 200 });
}

function structuredOutputFailed(): Response {
  return new Response(
    JSON.stringify({ error: { type: "structured_output_failed", code: "structured_output_failed", message: "model did not return valid JSON" } }),
    { status: 502 },
  );
}

describe("OpenAI-compatible coach client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    env.coachLlmUrl = "http://llm.test";
    env.coachLlmModel = "test-model";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the schema as json_schema structured output and returns the reply", async () => {
    fetchMock.mockResolvedValueOnce(completion('{"reply":"Easy week.","workout":null}'));

    await expect(createOpenAiClient().chat(messages, schema)).resolves.toBe('{"reply":"Easy week.","workout":null}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://llm.test/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("test-model");
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "coach_reply", schema } });
  });

  it("retries an answer in the wrong shape, e.g. a bare workout", async () => {
    fetchMock
      .mockResolvedValueOnce(completion('{"title":"Long ride","discipline":"BIKE","sets":[]}'))
      .mockResolvedValueOnce(completion('{"reply":"Here it is.","workout":{"title":"Long ride"}}'));

    await expect(createOpenAiClient().chat(messages, schema)).resolves.toBe('{"reply":"Here it is.","workout":{"title":"Long ride"}}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when the server reports the model's output wasn't valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(structuredOutputFailed()).mockResolvedValueOnce(completion('{"reply":"Ok.","workout":null}'));

    await expect(createOpenAiClient().chat(messages, schema)).resolves.toBe('{"reply":"Ok.","workout":null}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts", async () => {
    fetchMock.mockImplementation(async () => completion("not json"));
    await expect(createOpenAiClient().chat(messages, schema)).resolves.toBe("not json");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => structuredOutputFailed());
    await expect(createOpenAiClient().chat(messages, schema)).rejects.toBeInstanceOf(CoachLlmError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("doesn't retry other server errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }));

    await expect(createOpenAiClient().chat(messages, schema)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
