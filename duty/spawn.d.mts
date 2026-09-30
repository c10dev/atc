export const DUTY_DIR: string;
export const DUTY_TOOLS: string;
export interface DutyArgvConfig {
  claudeBin?: string;
  sessionId?: string;
  resume?: boolean;
  dir?: string;
}
export interface DutyArgv {
  command: string;
  args: string[];
  cwd: string;
  sessionId: string;
}
export function dutyArgvOf(cfg?: DutyArgvConfig): DutyArgv;
