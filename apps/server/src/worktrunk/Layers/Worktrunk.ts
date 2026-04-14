/**
 * Worktrunk - Layer implementation that wraps the `wt` CLI binary.
 *
 * Spawns `wt` as a subprocess with `--yes --format=json` flags for
 * structured, non-interactive output. Follows the same spawn pattern
 * used by provider binary detection (spawnAndCollect).
 *
 * @module WorktrunkLayer
 */
import { Effect, Layer, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { WorktrunkError, WorktrunkListEntry, WorktrunkNotInstalledError } from "@t3tools/contracts";
import {
  collectStreamAsString,
  isCommandMissingCause,
  parseGenericCliVersion,
  type CommandResult,
} from "../../provider/providerSnapshot.ts";
import { isWindowsCommandNotFound } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { Worktrunk, type WorktrunkShape } from "../Services/Worktrunk.ts";

const WORKTRUNK_TIMEOUT_MS = 30_000;

const makeWorktrunk = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const getBinaryPath = (operation: string): Effect.Effect<string, WorktrunkError> =>
    settingsService.getSettings.pipe(
      Effect.flatMap((settings) => {
        if (!settings.providers.worktrunk.enabled) {
          return Effect.fail(
            new WorktrunkError({
              operation,
              command: "settings",
              detail: "Worktrunk is disabled in server settings.",
            }),
          );
        }
        return Effect.succeed(settings.providers.worktrunk.binaryPath);
      }),
      Effect.mapError((error) =>
        Schema.is(WorktrunkError)(error)
          ? error
          : new WorktrunkError({
              operation,
              command: "settings",
              detail: `Failed to read settings: ${error.message}`,
            }),
      ),
    );

  const runWt = (
    operation: string,
    args: readonly string[],
    options?: { readonly cwd?: string },
  ): Effect.Effect<CommandResult, WorktrunkError> =>
    Effect.gen(function* () {
      const binaryPath = yield* getBinaryPath(operation);
      const command = ChildProcess.make(binaryPath, [...args], {
        cwd: options?.cwd,
        env: { ...process.env },
      });
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(command);
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [
              collectStreamAsString(child.stdout),
              collectStreamAsString(child.stderr),
              child.exitCode.pipe(Effect.map(Number)),
            ],
            { concurrency: "unbounded" },
          );
          const cmdResult: CommandResult = { stdout, stderr, code: exitCode };
          if (isWindowsCommandNotFound(exitCode, stderr)) {
            return yield* Effect.fail(new Error(`spawn ${binaryPath} ENOENT`));
          }
          return cmdResult;
        }),
      ).pipe(
        Effect.timeout(WORKTRUNK_TIMEOUT_MS),
        Effect.catch((error) => {
          if (isCommandMissingCause(error)) {
            return Effect.fail(
              new WorktrunkError({
                operation,
                command: `${binaryPath} ${args.join(" ")}`,
                detail: `Worktrunk binary not found at "${binaryPath}". Install it with: brew install worktrunk`,
              }),
            );
          }
          return Effect.fail(
            new WorktrunkError({
              operation,
              command: `${binaryPath} ${args.join(" ")}`,
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
        }),
      );

      if (result.code !== 0) {
        return yield* new WorktrunkError({
          operation,
          command: `${binaryPath} ${args.join(" ")}`,
          detail: result.stderr.trim() || result.stdout.trim() || `Exit code ${result.code}`,
        });
      }

      return result;
    });

  const parseJsonOutput = <A>(
    operation: string,
    stdout: string,
    schema: Schema.Codec<A>,
  ): Effect.Effect<A, WorktrunkError> =>
    Effect.try({
      try: () => JSON.parse(stdout) as unknown,
      catch: () =>
        new WorktrunkError({
          operation,
          command: "parse",
          detail: `Failed to parse JSON output: ${stdout.slice(0, 200)}`,
        }),
    }).pipe(
      Effect.flatMap((parsed) =>
        Schema.decodeUnknownEffect(schema)(parsed).pipe(
          Effect.mapError(
            (decodeError) =>
              new WorktrunkError({
                operation,
                command: "parse",
                detail: `Failed to decode output: ${String(decodeError)}`,
              }),
          ),
        ),
      ),
    );

  const resolveSwitchResultFromList = (input: {
    cwd: string;
    branch: string;
    operation: string;
  }): Effect.Effect<{ path: string; branch: string }, WorktrunkError> =>
    list(input.cwd).pipe(
      Effect.flatMap((entries) => {
        const entry = entries.find(
          (candidate) => candidate.branch === input.branch && candidate.path,
        );
        if (!entry?.path) {
          return Effect.fail(
            new WorktrunkError({
              operation: input.operation,
              command: "wt list --format=json",
              detail: `Could not resolve worktree path for branch "${input.branch}".`,
            }),
          );
        }
        return Effect.succeed({ path: entry.path, branch: entry.branch });
      }),
    );

  const checkInstalled: WorktrunkShape["checkInstalled"] = () =>
    Effect.gen(function* () {
      const binaryPath = yield* getBinaryPath("checkInstalled").pipe(
        Effect.mapError(
          (error) =>
            new WorktrunkNotInstalledError({
              binaryPath:
                error.command === "settings" ? "wt" : (error.command.split(" ", 1)[0] ?? "wt"),
            }),
        ),
      );
      const result = yield* runWt("checkInstalled", ["--version"]).pipe(
        Effect.mapError(() => new WorktrunkNotInstalledError({ binaryPath })),
      );

      const version = parseGenericCliVersion(result.stdout) ?? result.stdout.trim();
      return { installed: true as const, version };
    });

  const list: WorktrunkShape["list"] = (cwd) =>
    Effect.gen(function* () {
      const result = yield* runWt("list", ["list", "--format=json"], { cwd });
      return yield* parseJsonOutput("list", result.stdout, Schema.Array(WorktrunkListEntry));
    });

  const switchTo: WorktrunkShape["switchTo"] = (input) =>
    Effect.gen(function* () {
      const result = yield* runWt("switchTo", ["switch", input.branch, "--yes", "--format=json"], {
        cwd: input.cwd,
      });
      return yield* parseJsonOutput(
        "switchTo",
        result.stdout,
        Schema.Struct({
          branch: Schema.String,
          path: Schema.String,
        }),
      ).pipe(
        Effect.map(({ path, branch }) => ({ path, branch })),
        Effect.catch(() =>
          resolveSwitchResultFromList({
            cwd: input.cwd,
            branch: input.branch,
            operation: "switchTo",
          }),
        ),
      );
    });

  const switchCreate: WorktrunkShape["switchCreate"] = (input) =>
    Effect.gen(function* () {
      const args = ["switch", "--create", input.branch, "--yes", "--format=json"];
      if (input.base) {
        args.push("--base", input.base);
      }
      const result = yield* runWt("switchCreate", args, { cwd: input.cwd });

      return yield* parseJsonOutput(
        "switchCreate",
        result.stdout,
        Schema.Struct({
          branch: Schema.String,
          path: Schema.String,
        }),
      ).pipe(
        Effect.map(({ path, branch }) => ({ path, branch })),
        Effect.catch(() =>
          resolveSwitchResultFromList({
            cwd: input.cwd,
            branch: input.branch,
            operation: "switchCreate",
          }),
        ),
      );
    });

  const switchPR: WorktrunkShape["switchPR"] = (input) =>
    Effect.gen(function* () {
      const result = yield* runWt(
        "switchPR",
        ["switch", `pr:${input.prNumber}`, "--yes", "--format=json"],
        { cwd: input.cwd },
      );

      return yield* parseJsonOutput(
        "switchPR",
        result.stdout,
        Schema.Struct({
          branch: Schema.String,
          path: Schema.String,
        }),
      ).pipe(
        Effect.map(({ path, branch }) => ({ path, branch })),
        Effect.mapError(
          (error) =>
            new WorktrunkError({
              operation: "switchPR",
              command: `wt switch pr:${input.prNumber} --yes --format=json`,
              detail: `Failed to decode switch result: ${error.message}`,
            }),
        ),
      );
    });

  const remove: WorktrunkShape["remove"] = (input) =>
    Effect.gen(function* () {
      const args = ["remove", input.branch, "--yes"];
      if (input.force) {
        args.push("-D");
      }
      yield* runWt("remove", args, { cwd: input.cwd });
    });

  return {
    checkInstalled,
    list,
    switchTo,
    switchCreate,
    switchPR,
    remove,
  } satisfies WorktrunkShape;
});

export const WorktrunkLive = Layer.effect(Worktrunk, makeWorktrunk);
