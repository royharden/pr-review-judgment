import type { ReviewEnvelope } from "../providers/port.ts";

export type SlotState = "planned" | "reserved" | "sent" | "settled" | "unknown" | "failed_pre_send" | "released" | "cancelled";
export interface Slot { id: string; state: SlotState; attempts: number; pre_send_retries: number; rate_limit_backoffs: number; envelope: ReviewEnvelope | null }
export const newSlot = (id: string): Slot => ({ id, state: "planned", attempts: 0, pre_send_retries: 0, rate_limit_backoffs: 0, envelope: null });
const edges: Record<SlotState, readonly SlotState[]> = { planned: ["reserved", "cancelled"], reserved: ["sent", "failed_pre_send", "unknown"], sent: ["settled", "unknown", "failed_pre_send"], failed_pre_send: ["released", "cancelled"], released: ["planned", "cancelled"], settled: ["planned"], unknown: [], cancelled: [] };
export function transition(slot: Slot, state: SlotState): Slot {
  if (!edges[slot.state].includes(state)) throw new Error(`illegal slot transition ${slot.state} -> ${state}`);
  if (state === "planned" && slot.state === "settled" && !(slot.envelope?.rateLimited && slot.envelope.billing === "rejected_unbilled" && slot.rate_limit_backoffs === 1)) throw new Error("settled slots are never rerun");
  return { ...slot, state, attempts: slot.attempts + (state === "reserved" ? 1 : 0) };
}
/** A restart cannot know whether reserved/sent bytes reached a provider. Explicit no-send evidence is required. */
export function recover(slot: Slot, proofNoSend = false): Slot {
  if (slot.state !== "reserved" && slot.state !== "sent") return slot;
  return { ...slot, state: proofNoSend ? "failed_pre_send" : "unknown" };
}
export function retryDecision(slot: Slot, e: ReviewEnvelope): "pre_send" | "backoff" | "stop" | "done" {
  if (e.billing === "unknown") return "stop";
  if (e.preSendFailure && e.billing === "not_sent") return slot.pre_send_retries === 0 ? "pre_send" : "stop";
  if (e.rateLimited) return e.billing === "rejected_unbilled" && slot.rate_limit_backoffs === 0 ? "backoff" : "stop";
  if (e.outcome === "completed" && e.identity !== "match") return "stop";
  return "done";
}
