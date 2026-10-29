// approve-all baseline (PLAN §6): approves every change with no findings. Its HIT is 0 by construction and its
// false rejection is 0; it anchors the bottom of every table. Pure.
import { finishBaseline, type BaselineResult } from "./common.ts";
import type { HeadFileBounds } from "../contract.ts";

export function approveAll(headFiles: readonly HeadFileBounds[]): BaselineResult {
  return finishBaseline("approve-all", [], headFiles);
}
