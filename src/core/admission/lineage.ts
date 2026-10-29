// Builder lineage (protocol/builder-lineage.json, PLAN M2 acceptance 6). Matching is by the 4-character AgentNamer id
// prefix, so a builder cannot escape the list by re-labelling the rest of its callsign. Pure.
//
// Registry scope and its limitation (DEFERRED-VALIDATION DV-17): member ids are AgentNamer ids issued by the Bolt.New
// WORKSPACE registry (`Bolt.New\.agent-registry`), which is the registry S41 uses (the app shell has none). A member may
// carry an optional `registry` label naming the registry that issued its id (absent = the workspace registry). A 4-char
// id is unique only within ONE registry, and matching deliberately ignores `registry`, so:
// - an unrelated session whose id (from another registry or machine) collides with a listed id is treated as builder
//   and refused (fail closed: a collision can block an independent signer, never admit a builder);
// - a builder session that also holds an id in another registry is matched only if that id is listed too, so S41-INT
//   must list every id any builder session holds, each with its `registry` label. This is a procedural control,
//   not proof (PLAN K23: "procedural, not proven").
import { z } from "zod";
import { Callsign } from "../defectcorpus/schema.ts";

export const CallsignId = z.string().regex(/^[0-9A-Z]{2}[0-9]{2}$/, "expected a 4-character AgentNamer id");

/** The registry assumed when a member has no `registry` label. */
export const DEFAULT_LINEAGE_REGISTRY = "Bolt.New/.agent-registry";

export const LineageMember = z
  .strictObject({
    id: CallsignId,
    callsign: Callsign,
    role: z.string().min(1),
    /** Optional label of the AgentNamer registry that issued `id`; absent = DEFAULT_LINEAGE_REGISTRY. Not used for matching. */
    registry: z.string().min(1).optional(),
  })
  .refine((m) => m.callsign.slice(0, 4) === m.id, { message: "id must be the callsign's 4-character prefix" });

export const BuilderLineageSchema = z
  .strictObject({
    schema: z.literal("builder-lineage/v1"),
    project: z.string().min(1),
    match: z.literal("callsign_id_prefix_4"),
    note: z.string().min(1),
    root: Callsign,
    members: z.array(LineageMember).min(1),
  })
  .superRefine((l, ctx) => {
    // The same id may be listed once per registry (it is the same match either way, since matching ignores registry).
    const keys = l.members.map((m) => `${m.registry ?? DEFAULT_LINEAGE_REGISTRY}\u0000${m.id}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["members"], message: "duplicate member id in one registry" });
    if (!l.members.some((m) => m.callsign === l.root)) ctx.addIssue({ code: "custom", path: ["root"], message: "root must be a member" });
  });
export type BuilderLineage = z.infer<typeof BuilderLineageSchema>;

/** The 4-character id of a callsign, or null if it is not a callsign. */
export function callsignId(callsign: string): string | null {
  return Callsign.safeParse(callsign).success ? callsign.slice(0, 4) : null;
}

/**
 * True if the callsign's id prefix belongs to the builder lineage, in ANY listed registry (registry labels are ignored,
 * so a cross-registry id collision fails closed). A non-callsign string is treated as builder (fail closed).
 */
export function isBuilderLineage(callsign: string, lineage: BuilderLineage): boolean {
  const id = callsignId(callsign);
  if (id === null) return true;
  return lineage.members.some((m) => m.id === id);
}
