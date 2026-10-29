// Roy's written R3 appointment grant, as read by `admit` (PLAN M2 acceptance 5, K6/K7/K21). The builder never writes
// this file; it only reads it, records its path and sha256, and copies `developer_overlap_disclosed` (G2 amendment).
import { z } from "zod";
import { Callsign, IsoDateTime } from "../defectcorpus/schema.ts";

export const RoyGrantFileSchema = z
  .strictObject({
    schema: z.literal("roy-grant/v1"),
    item: z.literal("R3"),
    granted_by: z.literal("Roy"),
    /** The appointed independent corpus steward (writes spec, hidden suite, labels). */
    steward: Callsign,
    /** The appointed blind validator (diagnoses, reconciles, runs held-out corpus-verify, K19). */
    validator: Callsign,
    /** True when Roy selects the Claude/Codex developer fallback (K7): G2 then passes with disclosure (K21). */
    developer_overlap_disclosed: z.boolean(),
    granted_at: IsoDateTime,
    /** Roy's statement, verbatim. */
    statement: z.string().min(1),
  })
  .refine((g) => g.steward.slice(0, 4) !== g.validator.slice(0, 4), { message: "steward and validator must be distinct sessions" });
export type RoyGrantFile = z.infer<typeof RoyGrantFileSchema>;
