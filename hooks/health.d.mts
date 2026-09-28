export interface PushRecord {
  t: string;
  event: string;
  code?: "LIMIT" | "THROTTLE" | "NETWORK" | "MODEL" | "CONTEXT" | "PROVIDER" | "PENDING" | "UNANSWERED" | "HUNG" | "DENIED" | "UNKNOWN";
  error?: string;
  line?: string;
}
export const CLEAR_EVENTS: Set<string>;
export const PENDING_TYPES: Set<string>;
export function sessionFile(dir: string, sessionId: string): string;
export function recordOf(input: Record<string, unknown> | null | undefined, now?: number): PushRecord | null;
export function lastPushRecord(text: string): PushRecord | null;
export function run(input: Record<string, unknown> | null | undefined, opts?: { dir?: string; now?: number }): PushRecord | null;
