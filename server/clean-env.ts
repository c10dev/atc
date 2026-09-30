import { dirname } from "node:path";
import { config } from "./config.ts";

// claude CLI를 부를 때 쓰는 깨끗한 환경. 세션에 atc의 비밀(.env.local)을 물려주지 않는다.
// configDir(ATC-147): 그 ACCOUNT의 Claude Code 설정 폴더. ~/.claude(기본 폴더)면 아무것도 더하지 않는다(등록부가 없을 때와 같은 환경).
// 더하는 것은 CLAUDE_CONFIG_DIR 하나뿐이다
export const cleanPath = () => [dirname(config.claudeBin), dirname(process.execPath), "/usr/local/bin", "/usr/bin", "/bin"];
export function cleanEnv(configDir?: string | null): NodeJS.ProcessEnv {
  const keep = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL", "TERM", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "DBUS_SESSION_BUS_ADDRESS"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  env.PATH = cleanPath().join(":");
  if (configDir && configDir !== config.claudeDir) env.CLAUDE_CONFIG_DIR = configDir;
  return env;
}
