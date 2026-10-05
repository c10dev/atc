import { type BigIntStats, closeSync, openSync, readSync, statSync } from "node:fs";

// 덧붙이기만 하는 JSONL을 tick마다 처음부터 읽고 파싱하지 않게 하는 캐시(ATC-537).
// 열쇠는 파일의 정체(inode, 크기, mtime 나노초)다. 바뀌지 않았으면 읽지 않고, 자라기만 했으면 지난번 끝 위치부터 새 바이트만 읽는다.
// 줄어들었거나 inode가 바뀌었거나(교체) 같은 크기에서 mtime이 바뀌었거나, 지난번 끝 바로 앞 바이트가 달라졌으면(제자리 다시 쓰기) 처음부터 다시 읽는다.
// 줄바꿈으로 끝나지 않은 마지막 조각은 캐시하지 않는다: 줄바꿈이 올 때까지 위치를 앞으로 옮기지 않고, 그 조각이 파싱되면 이번 결과에만 넣는다(통째로 읽었을 때와 같은 결과).
// 돌려주는 배열은 읽기 전용으로 쓴다(바뀔 때마다 새 배열이고 같은 상태면 같은 배열이다). 바뀌었는지는 `gen`으로 안다.

const ANCHOR = 32; // 지난번 끝 바로 앞에서 비교할 바이트 수
const MAX_FILES = 64;

interface Entry<T> {
  ino: bigint;
  size: number;
  mtimeNs: bigint;
  offset: number; // 마지막 완결 줄 바로 다음 바이트
  anchor: Buffer; // offset 바로 앞 최대 ANCHOR 바이트
  done: T[]; // 완결 줄 결과
  view: T[]; // done + (파싱되는 미완결 조각)
  gen: number;
}

let generation = 0;

export class JsonlCache<T> {
  private entries = new Map<string, Entry<T>>();
  private readonly parse: (raw: unknown) => T | undefined;
  constructor(parse: (raw: unknown) => T | undefined = (raw) => raw as T) {
    this.parse = parse;
  }

  private parseLine(line: string): T | undefined {
    if (!line) return undefined;
    try {
      return this.parse(JSON.parse(line));
    } catch {
      return undefined;
    }
  }

  // 파일이 없으면 빈 배열과 gen 0. gen이 같으면 내용이 같다
  read(file: string): { lines: readonly T[]; gen: number } {
    let st: BigIntStats;
    try {
      st = statSync(file, { bigint: true });
    } catch {
      this.entries.delete(file);
      return { lines: EMPTY as readonly T[], gen: 0 };
    }
    const size = Number(st.size);
    const hit = this.entries.get(file);
    if (hit && hit.ino === st.ino && hit.size === size && hit.mtimeNs === st.mtimeNs) return { lines: hit.view, gen: hit.gen };
    const fd = openSync(file, "r");
    try {
      let base: Entry<T> | null = hit && hit.ino === st.ino && size > hit.size ? hit : null; // 같은 크기에서 mtime만 바뀐 것은 다시 쓴 것으로 본다
      if (base) {
        // 자라기만 했는지 지난번 끝 바로 앞 바이트로 확인한다
        const from = base.offset - base.anchor.length;
        const head = Buffer.alloc(base.anchor.length);
        const n = head.length ? readSync(fd, head, 0, head.length, from) : 0;
        if (n !== head.length || !head.equals(base.anchor)) base = null;
      }
      const start = base ? base.offset : 0;
      const buf = Buffer.alloc(Math.max(0, size - start));
      let got = 0;
      while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, start + got);
        if (n === 0) break;
        got += n;
      }
      const data = got === buf.length ? buf : buf.subarray(0, got);
      const cut = data.lastIndexOf(0x0a) + 1; // 완결 줄의 끝(없으면 0)
      const added: T[] = [];
      if (cut > 0) {
        for (const l of data.toString("utf8", 0, cut).split("\n")) {
          const v = this.parseLine(l);
          if (v !== undefined) added.push(v);
        }
      }
      const done = base ? (added.length ? base.done.concat(added) : base.done) : added;
      const tail = cut < data.length ? this.parseLine(data.toString("utf8", cut)) : undefined;
      const offset = start + cut;
      const anchor = Buffer.alloc(Math.min(ANCHOR, offset));
      if (anchor.length) readSync(fd, anchor, 0, anchor.length, offset - anchor.length);
      const entry: Entry<T> = { ino: st.ino, size, mtimeNs: st.mtimeNs, offset, anchor, done, view: tail === undefined ? done : [...done, tail], gen: ++generation };
      this.entries.delete(file);
      this.entries.set(file, entry);
      while (this.entries.size > MAX_FILES) this.entries.delete(this.entries.keys().next().value!);
      return { lines: entry.view, gen: entry.gen };
    } finally {
      closeSync(fd);
    }
  }

  clear() {
    this.entries.clear();
  }
}

const EMPTY: never[] = [];
