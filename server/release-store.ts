// 발권 기록 파일(ATC-362): `releases.jsonl`(상태 폴더, 추가만). 읽기와 한 줄 붙이기만. 판정은 release.ts(순수).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "./config.ts";
import { foldReleases, type ReleaseLine, type ReleaseView } from "./release.ts";

export const RELEASES_FILE = () => join(config.stateDir, "releases.jsonl");

export function readReleaseLines(file = RELEASES_FILE()): ReleaseLine[] {
  if (!existsSync(file)) return [];
  const out: ReleaseLine[] = [];
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try {
      const j = JSON.parse(raw) as ReleaseLine;
      if (j && (j.op === "release" || j.op === "arm")) out.push(j);
    } catch {} // 깨진 줄은 건너뛴다
  }
  return out;
}

export const readReleaseView = (file = RELEASES_FILE()): ReleaseView => foldReleases(readReleaseLines(file));

export function appendReleaseLines(lines: readonly ReleaseLine[], file = RELEASES_FILE()) {
  if (!lines.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
}
