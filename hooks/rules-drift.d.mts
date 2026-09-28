export interface RulesRecord {
  v: 1;
  sessionId: string;
  root: string;
  ref: string | null;
  files: string[];
  startedAt: string;
  checkedAt: string;
  changedAt?: string;
  acked: Record<string, string | null>;
}
export const DEFAULT_FILES: string[];
export function readSource(root: string, ref: string | null, file: string): string | null;
export function statusOf(rec: RulesRecord, read?: (root: string, ref: string | null, file: string) => string | null): { current: boolean; behind: string[] };
export function readRecords(dir?: string): RulesRecord[];
