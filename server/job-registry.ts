import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JobContext, JobDecl } from "./job-def.ts";
import { timed } from "./job-timing.ts";
import type { Snapshot } from "./model.ts";
import { loadDeclarations } from "./declarations.ts";

// JOB REGISTRY(ATC-393): server/jobs/ 폴더의 파일마다 일 하나(default export = defineJob). 폴더를 읽어 목록을 만들고 돌린다.
export const BUILTIN_JOBS_DIR = join(dirname(fileURLToPath(import.meta.url)), "jobs");

const isJobDecl = (x: unknown): x is JobDecl => {
  const d = x as Partial<JobDecl> | null;
  return Boolean(d && typeof d.name === "string" && typeof d.run === "function" && [d.every !== undefined, d.tick !== undefined, d.start === true].filter(Boolean).length === 1);
};

export async function loadJobs(dirs: readonly string[] = [BUILTIN_JOBS_DIR]): Promise<JobDecl[]> {
  const out: JobDecl[] = [];
  for (const dir of dirs) out.push(...(await loadDeclarations(dir, isJobDecl, "일(every·tick·start 중 하나)")));
  const names = new Set<string>();
  for (const j of out) {
    if (names.has(j.name)) throw new Error(`일 이름이 겹침: ${j.name}`);
    names.add(j.name);
  }
  return out;
}

// 서비스(index.ts가 만든 것): 이름으로 넣고 이름으로 꺼낸다. 일 파일은 import로 닿지 못하는 것(mount가 돌려준 객체 등)만 여기서 받는다
const services = new Map<string, unknown>();
export const provideService = (name: string, value: unknown) => void services.set(name, value);
export const serviceOf = <T>(name: string): T => {
  if (!services.has(name)) throw new Error(`서비스가 없음: ${name}`);
  return services.get(name) as T;
};

export interface JobRunner {
  // 스냅샷을 새로 만든 뒤 한 번 부른다. warm이 아니면 아무것도 하지 않는다. 일은 order 순서로 돌고, 던지면 그대로 던진다(옛 tick과 같다)
  tick(snapshot: Snapshot, warm: boolean): void;
  // every 일의 타이머와 start 일을 시작한다. 타이머는 unref
  startTimers(): void;
}

type Timers = { setInterval: (fn: () => void, ms: number) => { unref(): unknown } };

export function createJobRunner(jobs: readonly JobDecl[], ctx: JobContext, timers: Timers = { setInterval: (fn, ms) => setInterval(fn, ms) }): JobRunner {
  const tickJobs = jobs.filter((j) => j.tick).sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.name.localeCompare(b.name));
  const last = new Map<string, number>();
  const failed = (j: JobDecl) => (e: unknown) => console.error(`[atc] job ${j.name} failed:`, e);
  return {
    tick(snapshot, warm) {
      if (!warm) return;
      for (const j of tickJobs) {
        const every = j.tick!.everyMs;
        if (every !== undefined) {
          const t = ctx.now();
          if (t - (last.get(j.name) ?? 0) < every) continue;
          last.set(j.name, t);
        }
        void timed(`job:${j.name}`, () => j.run(ctx, snapshot)); // 시간만 잰다(ATC-525): 던지면 옛날처럼 그대로 던진다
      }
    },
    startTimers() {
      for (const j of jobs) {
        if (j.start) void Promise.resolve(timed(`job:${j.name}`, () => j.run(ctx, null))).catch(failed(j));
        if (j.every !== undefined) {
          timers
            .setInterval(() => {
              try {
                void Promise.resolve(timed(`job:${j.name}`, () => j.run(ctx, ctx.current()))).catch(failed(j));
              } catch (e) {
                failed(j)(e);
              }
            }, j.every)
            .unref();
        }
      }
    },
  };
}

// 서버가 쓰는 일 목록(내장 폴더만)
export const jobs: readonly JobDecl[] = await loadJobs();
