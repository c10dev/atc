// IDEAS 서랍(DUTY G4, docs/duty.md)의 자료를 화면용으로 다듬는 순수 함수. 읽기 전용, 입출력 없음.
// 읽는 저장소는 atc 하나뿐이다(비공개 아이디어는 다른 저장소에 있고 여기서 읽지 않는다).
import { cut, obj, safeUrl, str } from "./detail.ts";

export const IDEAS_REPO = "chaehy5665/atc";
export const IDEA_LABEL = "idea";
const PREVIEW_MAX = 300;
const BODY_MAX = 20_000;
const COMMENT_MAX = 4_000;
const COMMENTS_MAX = 20;
const TITLE_MAX = 120;

export interface IdeaRow {
  number: number;
  title: string;
  labels: string[];
  updatedAt: string | null;
  comments: number;
  preview: string;
}
export interface IdeaDetail {
  number: number;
  title: string;
  url: string | null;
  labels: string[];
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  body: string;
  bodyTruncated: boolean;
  commentsTotal: number;
  comments: { author: string | null; at: string | null; body: string; truncated: boolean }[];
  // ADOPT로 DUTY에 보낼 고정 문구(서버가 만든다)
  adopt: string;
}

// #ideas/<n> · /api/ideas/<n>
export function ideaNumberOf(s: string): number | null {
  return /^\d{1,7}$/.test(s) && Number(s) >= 1 ? Number(s) : null;
}

const labelsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((l) => str(obj(l).name)).filter((x): x is string => x !== null) : []);
const hasIdeaLabel = (labels: string[]) => labels.some((l) => l.toLowerCase() === IDEA_LABEL);

// 미리보기: 줄바꿈을 접고 앞 300자
const previewOf = (body: unknown): string => {
  const t = (typeof body === "string" ? body : "").replace(/^#{1,6}\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t;
};

// ADOPT 문구에 들어가는 제목: 한 줄, 큰따옴표 없이, 길이 제한(제목은 밖에서 온 글이다)
const titleOf = (t: string): string => t.replace(/\s+/g, " ").replace(/"/g, "'").trim().slice(0, TITLE_MAX);

export function adoptText(n: number, title: string): string {
  return `ADOPT idea #${n} "${titleOf(title)}" — read it (duty idea ${n}) and propose a design outline: problem, current facts to check, principles, steps. Do not write files.`;
}

// gh issue list --json 결과 → 목록. idea 라벨이 없는 것은 뺀다. 마지막 갱신이 늦은 것부터
export function shapeIdeaList(raw: unknown): IdeaRow[] {
  const rows = (Array.isArray(raw) ? raw : []).map(obj).flatMap((v): IdeaRow[] => {
    const labels = labelsOf(v.labels);
    const number = typeof v.number === "number" ? v.number : 0;
    if (!number || !hasIdeaLabel(labels)) return [];
    return [{ number, title: str(v.title) ?? "", labels, updatedAt: str(v.updatedAt), comments: Array.isArray(v.comments) ? v.comments.length : 0, preview: previewOf(v.body) }];
  });
  return rows.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || b.number - a.number);
}

// gh issue view --json 결과 → 상세. 열린 idea 이슈가 아니면 null
export function shapeIdea(raw: unknown): IdeaDetail | null {
  const v = obj(raw);
  const labels = labelsOf(v.labels);
  const number = typeof v.number === "number" ? v.number : 0;
  if (!number || !hasIdeaLabel(labels) || String(v.state ?? "").toUpperCase() !== "OPEN") return null;
  const title = str(v.title) ?? "";
  const body = cut(v.body, BODY_MAX);
  const all = Array.isArray(v.comments) ? v.comments.map(obj) : [];
  return {
    number,
    title,
    url: safeUrl(v.url),
    labels,
    author: str(obj(v.author).login),
    createdAt: str(v.createdAt),
    updatedAt: str(v.updatedAt),
    body: body.text,
    bodyTruncated: body.truncated,
    commentsTotal: all.length,
    comments: all.slice(0, COMMENTS_MAX).map((c) => {
      const b = cut(c.body, COMMENT_MAX);
      return { author: str(obj(c.author).login), at: str(c.createdAt), body: b.text, truncated: b.truncated };
    }),
    adopt: adoptText(number, title),
  };
}
