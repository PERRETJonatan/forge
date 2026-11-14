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

  it("wraps a bare workout answer as the schema's workout", async () => {
    fetchMock.mockResolvedValueOnce(completion('{"title":"Long ride","discipline":"BIKE","sets":[]}'));

    const answer = JSON.parse(await createOpenAiClient().chat(messages, schema));
    expect(answer).toEqual({ reply: "", workout: { title: "Long ride", discipline: "BIKE", sets: [] } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries when the server reports the model's output wasn't valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(structuredOutputFailed()).mockResolvedValueOnce(completion('{"reply":"Ok.","workout":null}'));

    await expect(createOpenAiClient().chat(messages, schema)).resolves.toBe('{"reply":"Ok.","workout":null}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a plain request and takes its text as the reply", async () => {
    fetchMock
      .mockResolvedValueOnce(structuredOutputFailed())
      .mockResolvedValueOnce(completion('{"something":"else"}'))
      .mockResolvedValueOnce(completion("Keep Saturday's ride easy, you're carrying fatigue."));

    const answer = JSON.parse(await createOpenAiClient().chat(messages, schema));
    expect(answer).toEqual({ reply: "Keep Saturday's ride easy, you're carrying fatigue.", workout: null });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const lastBody = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(lastBody.response_format).toBeUndefined();
  });

  it("doesn't take plain text for a schema without a reply", async () => {
    const draftSchema = { type: "object", properties: { note: { type: "string" }, workout: { type: "object" } }, required: ["note", "workout"] };
    fetchMock.mockImplementation(async () => completion("Here is a nice ride."));

    await expect(createOpenAiClient().chat(messages, draftSchema)).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports the server's error once every attempt failed", async () => {
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
