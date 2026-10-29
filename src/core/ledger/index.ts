import type { ReviewEnvelope, Usage } from "../providers/port.ts";

export type Cap = "stratum_a" | "stratum_b" | "preparation";
export interface Budget { enabled: boolean; approved_usd: number; sub_caps: Record<Cap, { approved_usd: number }> }
export interface Price { input_usd_per_mtok: number; output_usd_per_mtok: number; cached_input_usd_per_mtok?: number; cache_write_usd_per_mtok?: number }
export interface Attempt { id: string; slot_id: string; cap: Cap; reserved_usd: number; actual_usd: number | null; state: "reserved" | "settled" | "released" | "unknown" }
const validMoney = (n: number) => Number.isFinite(n) && n >= 0;
export function worstCase(price: Price, input: number, output: number): number {
  if (![price.input_usd_per_mtok, price.output_usd_per_mtok, input, output].every(validMoney)) throw new Error("invalid reservation inputs");
  // A cache write can cost more than ordinary input. Never reserve a discounted cache rate.
  const inputRate = Math.max(price.input_usd_per_mtok, price.cached_input_usd_per_mtok ?? 0, price.cache_write_usd_per_mtok ?? 0);
  return (input * inputRate + output * price.output_usd_per_mtok) / 1e6;
}
export function liability(a: Attempt): number {
  if (!validMoney(a.reserved_usd) || (a.actual_usd !== null && !validMoney(a.actual_usd)) || (a.state === "settled" && a.actual_usd === null) || (a.state === "released" && a.actual_usd !== 0)) throw new Error("invalid ledger liability");
  return a.state === "released" ? 0 : a.state === "settled" ? a.actual_usd! : Math.max(a.reserved_usd, a.actual_usd ?? 0);
}
export function reserve(budget: Budget, ledger: readonly Attempt[], next: Omit<Attempt, "state" | "actual_usd">): Attempt[] {
  if (!budget.enabled || !validMoney(budget.approved_usd) || budget.approved_usd <= 0) throw new Error("budget disabled or unapproved");
  if (!validMoney(next.reserved_usd) || next.reserved_usd <= 0 || ledger.some((a) => a.id === next.id)) throw new Error("invalid or duplicate reservation");
  if (ledger.some((a) => a.state === "unknown")) throw new Error("unknown billing stops the run");
  const total = ledger.reduce((s, a) => s + liability(a), 0);
  const capTotal = ledger.filter((a) => a.cap === next.cap).reduce((s, a) => s + liability(a), 0);
  const cap = budget.sub_caps[next.cap].approved_usd;
  if (!validMoney(cap) || total + next.reserved_usd > budget.approved_usd || capTotal + next.reserved_usd > cap) throw new Error("next reservation exceeds cap");
  return [...ledger, { ...next, state: "reserved", actual_usd: null }];
}
export function usageCost(u: Usage, p: Price): number | null {
  if (u.cachedInputTokens !== null && u.cachedInputTokens > 0 && p.cached_input_usd_per_mtok === undefined) return null;
  if (u.cacheWriteInputTokens !== null && u.cacheWriteInputTokens > 0 && p.cache_write_usd_per_mtok === undefined) return null;
  const cost = (u.inputTokens * p.input_usd_per_mtok + u.outputTokens * p.output_usd_per_mtok + (u.cachedInputTokens ?? 0) * (p.cached_input_usd_per_mtok ?? 0) + (u.cacheWriteInputTokens ?? 0) * (p.cache_write_usd_per_mtok ?? 0)) / 1e6;
  return validMoney(cost) ? cost : null;
}
export function settle(attempt: Attempt, envelope: ReviewEnvelope, price: Price): Attempt {
  if (attempt.state !== "reserved" || attempt.slot_id !== envelope.slotId) throw new Error("settlement does not match reservation");
  if (envelope.billing === "not_sent" && !envelope.preSendFailure) throw new Error("release requires proof of no send");
  if (envelope.billing === "not_sent" || envelope.billing === "rejected_unbilled") return { ...attempt, state: "released", actual_usd: 0 };
  const cost = envelope.billing === "reported" && envelope.usage !== null ? usageCost(envelope.usage, price) : null;
  // A provider exceeding the reserved token ceiling is a stop, never quietly under-accounted.
  return cost === null || cost > attempt.reserved_usd ? { ...attempt, state: "unknown", actual_usd: cost } : { ...attempt, state: "settled", actual_usd: cost };
}
