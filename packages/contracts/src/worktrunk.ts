/**
 * Worktrunk - Schema types for Worktrunk CLI JSON output.
 *
 * Defines typed schemas for the structured JSON output produced by the
 * `wt` CLI tool when invoked with `--format=json`.
 *
 * @module Worktrunk
 */
import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

// ── wt list --format=json entry ──────────────────────────────────

const WorktrunkCommitInfo = Schema.Struct({
  sha: Schema.String,
  short_sha: Schema.String,
  message: Schema.String,
  timestamp: Schema.String,
});

const WorktrunkWorkingTreeStatus = Schema.Struct({
  staged: Schema.Number,
  modified: Schema.Number,
  untracked: Schema.Number,
});

const WorktrunkMainState = Schema.Struct({
  ahead: Schema.Number,
  behind: Schema.Number,
});

const WorktrunkRemoteState = Schema.Struct({
  name: Schema.String,
  branch: Schema.String,
  ahead: Schema.Number,
  behind: Schema.Number,
});

export const WorktrunkListEntry = Schema.Struct({
  branch: Schema.String,
  path: Schema.NullOr(Schema.String),
  commit: Schema.optional(WorktrunkCommitInfo),
  working_tree: Schema.optional(WorktrunkWorkingTreeStatus),
  main_state: Schema.optional(WorktrunkMainState),
  remote: Schema.optional(Schema.NullOr(WorktrunkRemoteState)),
  is_main: Schema.optional(Schema.Boolean),
  is_current: Schema.optional(Schema.Boolean),
});
export type WorktrunkListEntry = typeof WorktrunkListEntry.Type;

// ── wt switch result ─────────────────────────────────────────────

export const WorktrunkSwitchResult = Schema.Struct({
  branch: Schema.String,
  path: Schema.String,
});
export type WorktrunkSwitchResult = typeof WorktrunkSwitchResult.Type;

// ── Errors ───────────────────────────────────────────────────────

export class WorktrunkError extends Schema.TaggedErrorClass<WorktrunkError>()("WorktrunkError", {
  operation: Schema.String,
  command: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {
  override get message(): string {
    return `Worktrunk command failed in ${this.operation}: ${this.command} - ${this.detail}`;
  }
}

export class WorktrunkNotInstalledError extends Schema.TaggedErrorClass<WorktrunkNotInstalledError>()(
  "WorktrunkNotInstalledError",
  {
    binaryPath: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `Worktrunk is not installed or not found at "${this.binaryPath}". Install it with: brew install worktrunk`;
  }
}
