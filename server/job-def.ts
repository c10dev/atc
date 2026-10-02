import type { Snapshot } from "./model.ts";

// JOB REGISTRY(ATC-393): 주기로 도는 서버 일 하나는 server/jobs/ 폴더의 파일 하나로 선언한다. server/index.ts에 줄을 더하지 않는다.
// 때는 셋 중 하나: every(setInterval, 스냅샷과 상관없이), tick(스냅샷을 새로 만든 뒤 따뜻할 때, everyMs가 있으면 그 간격으로만), start(서버가 뜰 때 한 번).
// 이 파일은 순수 타입만 둔다.

export interface JobContext {
  current(): Snapshot | null; // 마지막 스냅샷(tick 일은 이번 스냅샷)
  now(): number;
  service<T>(name: string): T; // index.ts가 만든 것을 이름으로 받는다(update, applyNow, recycleDeps, eventLog …)
}

export interface JobDecl {
  name: string;
  every?: number; // ms. setInterval(unref)
  tick?: { everyMs?: number }; // 스냅샷 주기(isWarm)에 얹는다. everyMs가 있으면 그만큼 지났을 때만
  start?: boolean; // 서버가 뜰 때 한 번
  order?: number; // tick 일의 순서(기본 1000). 같으면 이름 순
  // tick 일은 던지면 그 주기의 나머지 일이 멈춘다(옛 index.ts와 같다): 던질 일은 안에서 잡는다. every 일은 던지면 로그만 남는다
  run(ctx: JobContext, snapshot: Snapshot | null): void | Promise<unknown>;
}

export const defineJob = (d: JobDecl): JobDecl => d;
