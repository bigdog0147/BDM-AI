import fs from "node:fs";
import path from "node:path";

export const DEV_MONITOR_MAX_EVENTS = 500;
export const DEV_MONITOR_POLL_INTERVAL_MS = 5000;

const PROJECT_ROOT = path.resolve(process.cwd());

const monitoredRoots = ["app", "lib", "tests"].map((segment) => path.resolve(PROJECT_ROOT, segment));

const ignoredSegments = new Set([
  ".git",
  ".next",
  "node_modules",
  "private-audit",
  ".opencode-workflow.md",
  "type-check-test.err",
  "type-check-test.log",
  "dev.err",
  "dev.log"
]);

const secretPatterns = [
  /sk-[A-Za-z0-9_-]{10,}/g,
  /sb_secret_[A-Za-z0-9_-]{8,}/g,
  /(api[_-]?key|secret|token|password)\s*[:=]\s*[^\s]+/gi
];

export interface DevFileEvent {
  id: string;
  type: "create" | "modify" | "delete";
  relativePath: string;
  timestamp: string;
  source: "filesystem_observed" | "user_reported" | "opencode_reported" | "unknown";
}

interface FileWatcherState {
  events: DevFileEvent[];
  active: boolean;
  error: string | null;
  watchCount: number;
  lastStartedAt: string | null;
  lastErrorAt: string | null;
}

const watcherState: FileWatcherState = {
  active: false,
  error: null,
  events: [],
  lastErrorAt: null,
  lastStartedAt: null,
  watchCount: 0
};

let watcherStarted = false;
let watchers: fs.FSWatcher[] = [];

function makeEventId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isAllowedPath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  for (const root of monitoredRoots) {
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      return true;
    }
  }
  return false;
}

export function redactText(value: string): string {
  let result = value;
  for (const pattern of secretPatterns) {
    result = result.replace(pattern, "***redacted***");
  }
  return result;
}

function toRelativePath(filePath: string): string | null {
  const resolved = path.resolve(filePath);
  if (!isAllowedPath(resolved)) return null;
  return path.relative(PROJECT_ROOT, resolved).replace(/\\/g, "/");
}

function ignoredSegmentsSeen(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => ignoredSegments.has(segment) || segment.endsWith(".env") || segment.endsWith(".bak") || segment.endsWith(".log"));
}

export function recordFileEvent(event: Partial<DevFileEvent> & { type: DevFileEvent["type"]; relativePath: string }): DevFileEvent {
  const devEvent: DevFileEvent = {
    id: makeEventId(),
    relativePath: sanitizeRelativePath(event.relativePath),
    source: event.source ?? "filesystem_observed",
    timestamp: event.timestamp ?? new Date().toISOString(),
    type: event.type
  };
  watcherState.events = [devEvent, ...watcherState.events].slice(0, DEV_MONITOR_MAX_EVENTS);
  return devEvent;
}

function sanitizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.?\//, "").slice(0, 250);
}

function handleWatchEvent(parentRoot: string, eventType: string, filename: string | Buffer | null): void {
  if (typeof filename !== "string" || !filename) return;
  const relativePath = path.relative(PROJECT_ROOT, path.resolve(parentRoot, filename)).replace(/\\/g, "/");
  if (ignoredSegmentsSeen(relativePath)) return;
  const resolved = path.resolve(PROJECT_ROOT, relativePath);
  if (!isAllowedPath(resolved)) return;
  if (relativePath.includes(path.sep + ".." + path.sep)) return;

  const stat = safeExists(resolved);
  const type: DevFileEvent["type"] =
    eventType === "rename" ? (stat ? "create" : "delete") : (stat ? "modify" : "delete");

  recordFileEvent({
    relativePath,
    source: "filesystem_observed",
    type
  });
}

function safeExists(filePath: string): boolean {
  try {
    fs.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function startFileWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;

  let initialized = false;
  watchers = [];
  for (const root of monitoredRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const watcher = fs.watch(root, { persistent: false, recursive: true }, (eventType, filename) => {
        if (typeof filename !== "string") return;
        handleWatchEvent(root, eventType, filename);
      });
      watcher.on("error", (error) => {
        watcherState.active = false;
        watcherState.error = redactText(error instanceof Error ? error.message : String(error));
        watcherState.lastErrorAt = new Date().toISOString();
      });
      watchers.push(watcher);
      initialized = true;
    } catch (error) {
      watcherState.lastErrorAt = new Date().toISOString();
      watcherState.error = redactText(error instanceof Error ? error.message : String(error));
      return;
    }
  }

  watcherState.active = initialized;
  watcherState.error = initialized ? null : "File watcher could not be initialized";
  watcherState.watchCount = watchers.length;
  watcherState.lastStartedAt = new Date().toISOString();
}

export function stopFileWatcher(): void {
  for (const watcher of watchers) watcher.close();
  watchers = [];
  watcherStarted = false;
  watcherState.active = false;
}

export function getWatcherState(): Readonly<FileWatcherState> {
  return watcherState;
}

export function getRecentFileEvents(limit = 100): DevFileEvent[] {
  return watcherState.events.slice(0, Math.min(limit, watcherState.events.length));
}

export function getBoundedEvents(): DevFileEvent[] {
  return watcherState.events.slice();
}

export type DevMonitorValidationReport = {
  buildCompletedAt?: string;
  eslintErrors?: number;
  eslintWarnings?: number;
  testTotal?: number;
  testPassed?: number;
  testSkipped?: number;
  tscErrors?: number;
};

let latestValidationReport: DevMonitorValidationReport | null = null;

export function validationReportToRedactedSummary(value: DevMonitorValidationReport | null): DevMonitorValidationReport | null {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

export function storeValidationReport(report: DevMonitorValidationReport): void {
  const safe: DevMonitorValidationReport = {
    buildCompletedAt: typeof report.buildCompletedAt === "string" ? report.buildCompletedAt.slice(0, 40) : undefined,
    eslintErrors: finiteInteger(report.eslintErrors),
    eslintWarnings: finiteInteger(report.eslintWarnings),
    testPassed: finiteInteger(report.testPassed),
    testSkipped: finiteInteger(report.testSkipped),
    testTotal: finiteInteger(report.testTotal),
    tscErrors: finiteInteger(report.tscErrors)
  };
  latestValidationReport = safe;
}

export function getLatestValidationReport(): DevMonitorValidationReport | null {
  return validationReportToRedactedSummary(latestValidationReport);
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 100000 ? value : undefined;
}

export function redactErrorMessage(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  const parsed = host.split(",")[0].trim().toLowerCase();
  const hostname = parsed.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function isDevMonitorEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.BDM_DEV_MONITOR_ENABLED === "true";
}

export function sameOriginRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-host");
  const host = forwarded ?? request.headers.get("host");
  if (!host) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

import { spawnSync } from "node:child_process";

export interface GitSummary {
  added: string[];
  branch: string;
  changedTrackedFiles: number;
  deleted: string[];
  headShort: string;
  modified: string[];
  statusError: string | null;
  untrackedFiles: number;
}

export function gitBranchAndHead(): { branch: string; headShort: string } {
  const branchResult = spawnSync("git", ["branch", "--show-current"], { cwd: PROJECT_ROOT, encoding: "utf8" });
  const headResult = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: PROJECT_ROOT, encoding: "utf8" });
  return {
    branch: branchResult.status === 0 ? branchResult.stdout.trim() : "unknown",
    headShort: headResult.status === 0 ? headResult.stdout.trim() : "unknown"
  };
}

export function safeGitSummary(): GitSummary {
  const info = gitBranchAndHead();
  const result = spawnSync("git", ["status", "--porcelain=v1"], { cwd: PROJECT_ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    return { added: [], branch: info.branch, changedTrackedFiles: 0, deleted: [], headShort: info.headShort, modified: [], statusError: redactErrorMessage(result.stderr || result.stdout), untrackedFiles: 0 };
  }

  const modified: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];
  let trackedChanged = 0;
  let untracked = 0;

  for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
    const code = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (code === "??") {
      untracked += 1;
      continue;
    }
    trackedChanged += 1;
    if (code.includes("D")) deleted.push(redactText(file));
    else if (code.includes("A")) added.push(redactText(file));
    else modified.push(redactText(file));
  }

  return {
    added,
    branch: info.branch,
    changedTrackedFiles: trackedChanged,
    deleted,
    headShort: info.headShort,
    modified,
    statusError: null,
    untrackedFiles: untracked
  };
}

export function safeGitDiffStat(): string {
  const result = spawnSync("git", ["diff", "--stat"], { cwd: PROJECT_ROOT, encoding: "utf8" });
  if (result.status !== 0) return "";
  return redactText(result.stdout.slice(0, 4000));
}

export function safeGitDiffNames(): string[] {
  const result = spawnSync("git", ["diff", "--name-only"], { cwd: PROJECT_ROOT, encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => redactText(line))
    .slice(0, 100);
}

