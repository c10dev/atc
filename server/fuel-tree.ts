import { type FSWatcher, statSync, watch } from "node:fs";
import { relative, sep } from "node:path";

// FUEL의 대화 기록 목록(ATC-83, docs/fuel.md 4.1): ~/.claude/projects를 fs.watch(recursive, inotify)로 지켜 바뀐 파일만 표시해 둔다.
// 목록은 알려진 기록 파일의 mtime 표이고, 바뀐 파일만 다시 stat한다. watch가 안 되거나 오류가 나면 매번 전체를 걷는 옛 방식으로 돌아간다.
// 놓친 이벤트가 있어도 FULL_MS마다 전체를 한 번 걸어 맞춘다(주기 점검은 그대로 남는다).

export interface FuelFile {
  path: string;
  session: string;
  crew: boolean;
  agent: string | null;
  mtime: number;
}

// 조각(projects 기준 상대 경로)이 어떤 기록 파일인가. fuelFiles의 걷기와 같은 규칙:
//  <프로젝트>/<세션>.jsonl = CAPTAIN, <프로젝트>/<세션>/subagents/(하위 폴더 3단계까지)/agent-*.jsonl = CREW
export function classifyFuelPath(parts: readonly string[]): Pick<FuelFile, "session" | "crew" | "agent"> | null {
  const name = parts.at(-1) ?? "";
  if (!name.endsWith(".jsonl")) return null;
  if (parts.length === 2) return { session: name.slice(0, -6), crew: false, agent: null };
  if (parts.length >= 4 && parts.length <= 7 && parts[2] === "subagents" && name.startsWith("agent-")) return { session: parts[1], crew: true, agent: name.slice(6, -6) };
  return null;
}

export const FULL_MS = 60_000;

export class FuelTree {
  readonly root: string;
  private files = new Map<string, FuelFile>();
  private dirty = new Set<string>();
  private changed = new Set<string>(); // takeChanged가 넘겨줄 경로(바뀐 기록 파일)
  private needFull = true;
  private lastFull = 0;
  private watcher: FSWatcher | null = null;
  private walk: (since: number, root: string) => FuelFile[];
  seq = 0; // 바뀐 이벤트가 올 때마다 오른다

  constructor(root: string, walk: (since: number, root: string) => FuelFile[]) {
    this.root = root;
    this.walk = walk;
  }

  get watching(): boolean {
    return this.watcher !== null;
  }

  // fs.watch를 시작한다. 안 되면 false(전체 걷기로 돌아간다). onChange는 바뀐 기록 파일이 생길 때마다(같은 틱에 여러 번 올 수 있다)
  start(onChange?: () => void): boolean {
    try {
      const w = watch(this.root, { recursive: true, persistent: false }, (_event, filename) => {
        if (filename == null) {
          this.needFull = true; // 어느 파일인지 모르면 다음에 전체를 본다
        } else {
          const path = `${this.root}${sep}${String(filename)}`;
          if (!path.endsWith(".jsonl")) return; // 폴더·meta 등은 목록에 영향이 없다
          this.dirty.add(path);
          this.changed.add(path);
        }
        this.seq++;
        onChange?.();
      });
      w.on("error", () => this.stop()); // 폴더가 사라지는 등: 전체 걷기로 돌아간다
      this.watcher = w;
      this.needFull = true;
      return true;
    } catch {
      this.watcher = null;
      return false;
    }
  }

  stop() {
    try {
      this.watcher?.close();
    } catch {}
    this.watcher = null;
  }

  private fullWalk(now: number) {
    this.files = new Map(this.walk(0, this.root).map((f) => [f.path, f]));
    this.dirty.clear();
    this.needFull = false;
    this.lastFull = now;
  }

  // 표시된 경로만 다시 stat한다
  private applyDirty() {
    for (const path of this.dirty) {
      const cls = classifyFuelPath(relative(this.root, path).split(sep));
      let mtime: number | null = null;
      try {
        mtime = statSync(path).mtimeMs;
      } catch {}
      if (cls && mtime !== null) this.files.set(path, { path, ...cls, mtime });
      else this.files.delete(path);
    }
    this.dirty.clear();
  }

  // since 뒤에 바뀐 기록 파일(mtime 순). 지켜보는 중이면 걷지 않고 표시된 것만 보고, FULL_MS가 지났거나 watch가 없으면 전체를 걷는다
  list(since: number, now = Date.now()): FuelFile[] {
    if (!this.watcher || this.needFull || now - this.lastFull >= FULL_MS) this.fullWalk(now);
    else this.applyDirty();
    return [...this.files.values()].filter((f) => f.mtime >= since).sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
  }

  // 지난번 이후 바뀐 기록 파일(목록을 갱신한 뒤, 아직 있는 것만)
  takeChanged(now = Date.now()): FuelFile[] {
    if (!this.watcher || this.needFull || now - this.lastFull >= FULL_MS) this.fullWalk(now);
    else this.applyDirty();
    const out = [...this.changed].flatMap((p) => this.files.get(p) ?? []);
    this.changed.clear();
    return out;
  }

  // 전체 목록(mtime 필터 없음). 캐시 정리에 쓴다
  all(): FuelFile[] {
    return [...this.files.values()];
  }
}
