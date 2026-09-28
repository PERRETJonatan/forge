import type { CoachDraftResponse, CoachMessage, CoachStatus, CoachWorkoutDraft, Discipline, SendCoachMessageResponse } from "@forge/shared";
import { Prisma, type CoachMessage as CoachMessageRow } from "@prisma/client";
import { prisma } from "../db.js";
import { buildCoachContext } from "./coach-context.js";
import { normalizeDraft, WORKOUT_FORMAT_INSTRUCTIONS, workoutJsonSchema } from "./coach-draft.js";
import { CoachLlmError, createOllamaClient, type ChatTurn, type CoachLlm } from "./ollama-client.js";

const defaultLlm = createOllamaClient();
let activeLlm: CoachLlm = defaultLlm;

/** Test-only seam: swap in a fake model so route tests run without an Ollama server. Pass
 * null to restore the real client. */
export function setCoachLlmForTesting(llm: CoachLlm | null): void {
  activeLlm = llm ?? defaultLlm;
}

export class CoachError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Earlier turns sent back to the model with each message -- enough to follow a thread,
 * bounded so a long history doesn't crowd the athlete's data out of the context window. */
const HISTORY_TURNS = 20;
const HISTORY_PAGE = 200;

const COACH_PERSONA = `You are Forge's virtual coach: an experienced triathlon and Ironman coach talking with one athlete about their own training.

Ground every answer in the athlete's data below -- quote their actual CTL, ATL, TSB, TSS, workouts and thresholds rather than generic advice, and never invent workouts, numbers or dates that aren't there. If the data can't answer something (no workouts yet, a threshold not set), say so and say what would help.
Rules of thumb you can rely on: TSB below about -30 means deep fatigue and injury risk; -10 to -30 is normal productive training; around +5 to +25 is fresh, where you want to be on race day. CTL rising more than about 5-8 per week is an aggressive ramp. Tapers usually run 1-3 weeks depending on race distance.
Be direct, warm and concise: a few short paragraphs or a short list, plain text (no markdown headings, tables, bold or links). Never make up URLs. Answer in the athlete's language.
You don't diagnose injuries or illness: for pain, injury or health concerns, advise rest and seeing a medical professional.
You can't change the athlete's calendar or plan yourself.`;

const CHAT_INSTRUCTIONS = `Respond with JSON: {"reply": your message to the athlete, "workout": a proposed workout or null}.
Only fill "workout" when the athlete asks you to create, suggest or adjust a specific workout; otherwise it must be null. When you do propose one, describe it briefly in "reply" and tell the athlete they can open it in the builder (the app shows a button under your reply) to review, edit and save it -- nothing is added to their calendar until they do.
${WORKOUT_FORMAT_INSTRUCTIONS}`;

const DRAFT_INSTRUCTIONS = `The athlete is in the workout builder and asks you to draft one structured workout. Fit it to their thresholds, current form and what's already planned around it.
Respond with JSON: {"note": one or two sentences on what the workout is for and how it fits this week, "workout": the workout}.
${WORKOUT_FORMAT_INSTRUCTIONS}`;

const chatJsonSchema = {
  type: "object",
  properties: { reply: { type: "string" }, workout: { anyOf: [{ type: "null" }, workoutJsonSchema] } },
  required: ["reply", "workout"],
};

const draftJsonSchema = {
  type: "object",
  properties: { note: { type: "string" }, workout: workoutJsonSchema },
  required: ["note", "workout"],
};

function toDto(row: CoachMessageRow): CoachMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    draft: (row.draft as CoachWorkoutDraft | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function historyTurn(row: CoachMessageRow): ChatTurn {
  if (row.role === "USER") return { role: "user", content: row.content };
  const draft = row.draft as CoachWorkoutDraft | null;
  // The model only sees its earlier replies as text; note the workout so "make it shorter"
  // has something to refer to.
  const note = draft ? `\n\n(Proposed workout: "${draft.title}", ${draft.discipline}, ${Math.round(draft.durationSec / 60)} min)` : "";
  return { role: "assistant", content: row.content + note };
}

async function ask(messages: ChatTurn[], schema: object): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await activeLlm.chat(messages, schema);
  } catch (err) {
    if (err instanceof CoachLlmError) throw new CoachError(err.message, err.status);
    throw err;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new CoachError("The coach's answer came back garbled. Try again.", 502);
}

export async function getStatus(): Promise<CoachStatus> {
  return activeLlm.status();
}

export async function listMessages(athleteId: string): Promise<CoachMessage[]> {
  const rows = await prisma.coachMessage.findMany({
    where: { athleteId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_PAGE,
  });
  return rows.reverse().map(toDto);
}

/**
 * Sends the athlete's message with fresh context and recent history, and stores both sides
 * of the exchange -- only once the model has answered, so a failed call (Ollama down, a
 * timeout) leaves no orphaned question in the history and the athlete can simply resend.
 */
export async function sendMessage(athleteId: string, content: string, today: string): Promise<SendCoachMessageResponse> {
  const [context, recent] = await Promise.all([
    buildCoachContext(athleteId, today),
    prisma.coachMessage.findMany({
      where: { athleteId },
      orderBy: { createdAt: "desc" },
      take: HISTORY_TURNS,
    }),
  ]);

  const answer = await ask(
    [
      { role: "system", content: `${COACH_PERSONA}\n\n${CHAT_INSTRUCTIONS}\n\n# Athlete data\n${context.text}` },
      ...recent.reverse().map(historyTurn),
      { role: "user", content },
    ],
    chatJsonSchema,
  );

  const reply = typeof answer.reply === "string" ? answer.reply.trim() : "";
  const draft = answer.workout ? normalizeDraft(answer.workout, context.thresholds, today) : null;
  if (!reply && !draft) {
    throw new CoachError("The coach didn't come up with an answer. Try rephrasing.", 502);
  }

  const askedAt = new Date();
  const [message, replyRow] = await prisma.$transaction([
    prisma.coachMessage.create({ data: { athleteId, role: "USER", content, createdAt: askedAt } }),
    prisma.coachMessage.create({
      data: {
        athleteId,
        role: "ASSISTANT",
        content: reply || "Here's a workout for you -- open it in the builder to review it.",
        draft: draft ? (draft as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        // Same instant as the question would tie; one ms later keeps the pair in order.
        createdAt: new Date(askedAt.getTime() + 1),
      },
    }),
  ]);
  return { message: toDto(message), reply: toDto(replyRow) };
}

/** Builder-side drafting: one workout from a plain-language request, not stored in the chat. */
export async function draftWorkout(
  athleteId: string,
  request: string,
  discipline: Discipline | undefined,
  today: string,
): Promise<CoachDraftResponse> {
  const context = await buildCoachContext(athleteId, today);
  const hint = discipline ? `\n\n(The builder is set to ${discipline}; use it unless the request clearly says otherwise.)` : "";
  const answer = await ask(
    [
      { role: "system", content: `${COACH_PERSONA}\n\n${DRAFT_INSTRUCTIONS}\n\n# Athlete data\n${context.text}` },
      { role: "user", content: request + hint },
    ],
    draftJsonSchema,
  );

  const draft = normalizeDraft(answer.workout, context.thresholds, today);
  if (!draft) {
    throw new CoachError("The coach couldn't turn that into a workout. Try describing its length and effort.", 502);
  }
  return { note: typeof answer.note === "string" ? answer.note.trim() : "", draft };
}

export async function clearMessages(athleteId: string): Promise<void> {
  await prisma.coachMessage.deleteMany({ where: { athleteId } });
}
