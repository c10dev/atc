import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { type UsageRead, usageReadOf } from "./account-usage.ts";
import { cleanEnv } from "./clean-env.ts";
import { config } from "./config.ts";

// REFRESH(ATC-348): ACCOUNT 폴더에서 `claude -p "/usage"`를 돌려 한도 %를 읽는다(docs/research/claude-usage-accounts.md 8절 2안).
// 모델 호출이 없다(측정 2.1.287: 0 turns, 0 USD, 약 4초·400 MB). MCP 서버와 hook은 끈다 — hook이 atc 상태에 가짜 세션을 남기지 않게.
// 한 번에 하나만 돌리고, 같은 폴더는 MIN_GAP_MS 안에 다시 읽지 않는다. 값은 메모리에만 둔다(창과 이유뿐, 출력 원문은 버린다).

export const MIN_GAP_MS = 5 * 60_000;
const RETRY_GAP_MS = 30_000; // 실패한 값은 곧 다시 읽어도 된다
const TIMEOUT_MS = 30_000;
const ARGS = ["-p", "/usage", "--no-session-persistence", "--output-format", "json", "--strict-mcp-config", "--settings", JSON.stringify({ disableAllHooks: true })];

type Runner = (dir: string) => Promise<string>;
// TZ=UTC: reset 글이 "(UTC)"로 나와야 account-usage.ts가 읽는다. cwd는 /tmp 하나(Claude Code가 cwd마다 빈 memory 폴더를 만든다)
const runUsage: Runner = (dir) =>
  new Promise((resolve) =>
    execFile(config.claudeBin, ARGS, { env: { ...cleanEnv(dir), TZ: "UTC" }, cwd: tmpdir(), timeout: TIMEOUT_MS, maxBuffer: 1 << 20 }, (_err, stdout) => resolve(String(stdout ?? ""))),
  );

const reads = new Map<string, UsageRead>(); // 폴더 → 마지막 값
const inflight = new Map<string, Promise<UsageRead>>();
let chain: Promise<unknown> = Promise.resolve();

export const lastUsageRead = (dir: string): UsageRead | undefined => reads.get(dir);
export const forgetUsageReads = () => reads.clear();

// 폴더 하나를 읽는다. 최근에 읽었으면 그 값(cached), 같은 폴더를 읽는 중이면 그 결과를 같이 기다린다
export async function refreshUsage(dir: string, now = Date.now(), run: Runner = runUsage): Promise<{ read: UsageRead; cached: boolean }> {
  const last = reads.get(dir);
  if (last && now - Date.parse(last.at) < (last.windows.length ? MIN_GAP_MS : RETRY_GAP_MS)) return { read: last, cached: true };
  const running = inflight.get(dir);
  if (running) return { read: await running, cached: false };
  const p = chain.then(async () => {
    const read = usageReadOf(await run(dir), Date.now());
    reads.set(dir, read);
    return read;
  });
  chain = p.catch(() => {});
  inflight.set(dir, p);
  try {
    return { read: await p, cached: false };
  } finally {
    inflight.delete(dir);
  }
}
