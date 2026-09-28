export type FuelWindowName = "five_hour" | "seven_day" | "spend_limit";
export interface FuelLimit {
  used_percentage: number;
  resets_at: number;
}
export type RateLimits = Partial<Record<FuelWindowName, FuelLimit>>;
export interface FuelStatusRecord {
  t: string;
  sessionId: string;
  rate_limits: RateLimits;
}
export const WINDOWS: FuelWindowName[];
export function fuelFile(dir: string, sessionId: string): string;
export function limitsOf(raw: unknown): RateLimits | null;
export function recordOf(input: Record<string, unknown> | null | undefined, now?: number): FuelStatusRecord | null;
export function parseRecord(line: string): FuelStatusRecord | null;
export function lastRecord(text: string): FuelStatusRecord | null;
export function sameLimits(a: RateLimits, b: RateLimits): boolean;
export function lineOf(rec: FuelStatusRecord): string;
export function readTail(path: string, bytes?: number): string;
export function run(input: Record<string, unknown> | null | undefined, opts?: { dir?: string; now?: number }): { line: string; written: boolean };
