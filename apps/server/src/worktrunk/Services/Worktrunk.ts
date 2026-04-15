/**
 * Worktrunk - Effect service contract for Worktrunk CLI operations.
 *
 * Wraps the `wt` binary for worktree lifecycle management.
 * Follows the same service/layer pattern as GitCore.
 *
 * @module Worktrunk
 */
import { Context } from "effect";
import type { Effect } from "effect";
import type {
  WorktrunkListEntry,
  WorktrunkError,
  WorktrunkNotInstalledError,
} from "@t3tools/contracts";

export interface WorktrunkCheckResult {
  readonly installed: true;
  readonly version: string;
}

export interface WorktrunkSwitchInput {
  readonly cwd: string;
  readonly branch: string;
}

export interface WorktrunkSwitchCreateInput {
  readonly cwd: string;
  readonly branch: string;
  readonly base?: string;
}

export interface WorktrunkSwitchPRInput {
  readonly cwd: string;
  readonly prNumber: number;
}

export interface WorktrunkRemoveInput {
  readonly cwd: string;
  readonly branch: string;
  readonly force?: boolean;
}

export interface WorktrunkSwitchResult {
  readonly path: string;
  readonly branch: string;
}

/**
 * WorktrunkShape - Service API for Worktrunk CLI operations.
 */
export interface WorktrunkShape {
  /**
   * Check if Worktrunk is installed and return version info.
   */
  readonly checkInstalled: () => Effect.Effect<WorktrunkCheckResult, WorktrunkNotInstalledError>;

  /**
   * List all worktrees for a repository.
   */
  readonly list: (cwd: string) => Effect.Effect<readonly WorktrunkListEntry[], WorktrunkError>;

  /**
   * Switch to an existing branch worktree (creates worktree if needed).
   */
  readonly switchTo: (
    input: WorktrunkSwitchInput,
  ) => Effect.Effect<WorktrunkSwitchResult, WorktrunkError>;

  /**
   * Create a new branch from a base and switch to its worktree.
   */
  readonly switchCreate: (
    input: WorktrunkSwitchCreateInput,
  ) => Effect.Effect<WorktrunkSwitchResult, WorktrunkError>;

  /**
   * Switch to a pull request's branch worktree.
   */
  readonly switchPR: (
    input: WorktrunkSwitchPRInput,
  ) => Effect.Effect<WorktrunkSwitchResult, WorktrunkError>;

  /**
   * Remove a worktree by branch name.
   */
  readonly remove: (input: WorktrunkRemoveInput) => Effect.Effect<void, WorktrunkError>;
}

/**
 * Worktrunk - Service tag for Worktrunk CLI operations.
 */
export class Worktrunk extends Context.Service<Worktrunk, WorktrunkShape>()(
  "t3/worktrunk/Services/Worktrunk",
) {}
