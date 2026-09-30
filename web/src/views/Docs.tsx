import { marked, type Tokens } from "marked";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { foldChangelog } from "../../../server/changelog.ts";
import "./Docs.css";

// DOCS 탭: atc 사용 안내. 원본은 저장소의 docs/guide/*.md(한국어)이고 빌드 때 함께 묶인다.
// 주소는 #docs/<쪽>. 쪽 사이 링크는 Markdown에서 `requesting.md`처럼 쓰면 #docs/requesting으로 바뀐다.

const FILES = import.meta.glob("../../../docs/guide/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const SOURCE = new Map(Object.entries(FILES).map(([path, text]) => [path.split("/").pop()!.replace(/\.md$/, ""), text]));

// 변경 기록 쪽: CHANGELOG.ko.md에 아직 접지 않은 changelog.d/*.ko.md 조각을 [Unreleased]에 넣어 보인다(ATC-64)
const CHANGELOG = Object.values(import.meta.glob("../../../CHANGELOG.ko.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[0] ?? "";
const PENDING = import.meta.glob("../../../changelog.d/*.ko.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export function changelogPage(changelog: string, pending: Record<string, string>): string {
  const fragments = Object.entries(pending).map(([path, text]) => ({ name: path.split("/").pop()!.replace(/\.ko\.md$/, ""), text }));
  if (!fragments.length) return changelog;
  try {
    const { text, folded } = foldChangelog(changelog, "ko", fragments);
    if (!folded.length) return text;
    return text.replace(/^## \[Unreleased\].*$/m, (h) => `${h}\n\n> 아직 CHANGELOG에 접지 않은 조각 ${folded.length}개(\`changelog.d/\`)를 함께 보인다: ${folded.join(", ")}.`);
  } catch {
    return changelog;
  }
}
SOURCE.set("changelog", changelogPage(CHANGELOG, PENDING));
const SOURCE_PATH: Record<string, string> = { changelog: "CHANGELOG.ko.md" };

export const DOC_NAV = [
  { group: "시작하기", pages: [["introduction", "소개"], ["quickstart", "빠른 시작"]] },
  { group: "개념", pages: [["concepts", "개념과 용어"]] },
  { group: "가이드", pages: [["requesting", "일 맡기기"], ["reviewing", "판정하기"], ["fleet", "팀 운영"], ["alerts", "알림 받기"], ["menubar", "Mac 메뉴 막대"],["voice", "음성 콜아웃"], ["radio", "교신 규칙"], ["radio-tab", "RADIO 탭"], ["duty", "DUTY 채팅"], ["deploy", "배포하기"]] },
  { group: "참고", pages: [["screens", "화면 안내"], ["stages", "단계와 로드맵"], ["troubleshooting", "문제 해결"], ["changelog", "변경 기록"]] },
] as const;
const ORDER = DOC_NAV.flatMap((g) => g.pages.map(([slug, title]) => ({ slug, title, group: g.group })));
const REPO = "https://github.com/chaehy5665/atc/blob/main/";

// 제목 → 쪽 안 앵커 id. 한글은 그대로 두고 공백만 -로.
export const anchorOf = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");

// 링크 주소 바꾸기: 다른 쪽(.md)은 #docs/<쪽>, 저장소 파일은 GitHub, 밖은 새 창
export function hrefOf(href: string): { href: string; external: boolean } {
  const page = /^([\w-]+)\.md(?:#.*)?$/.exec(href);
  if (page && SOURCE.has(page[1])) return { href: `#docs/${page[1]}`, external: false };
  if (/^https?:\/\//.test(href)) return { href, external: true };
  if (href.startsWith("#")) return { href, external: false };
  return { href: REPO + href.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "docs/guide/"), external: true };
}

const renderer = new marked.Renderer();
renderer.heading = function ({ tokens, depth, text }: Tokens.Heading) {
  return `<h${depth} id="${anchorOf(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
};
renderer.link = function ({ href, title, tokens }: Tokens.Link) {
  const to = hrefOf(href);
  const t = title ? ` title="${title}"` : "";
  const ext = to.external ? ' target="_blank" rel="noreferrer"' : "";
  return `<a href="${to.href}"${t}${ext}>${this.parser.parseInline(tokens)}</a>`;
};

const pageOfHash = () => {
  const [, slug] = location.hash.slice(1).split("/");
  return slug && SOURCE.has(slug) ? slug : "introduction";
};

export function Docs() {
  const [slug, setSlug] = useState(pageOfHash);
  const rootRef = useRef<HTMLElement>(null);
  // 상단 헤더(두 줄이 될 수 있음) 높이만큼 목차 sticky 위치와 제목 스크롤 여백을 둔다
  const [top, setTop] = useState(64);
  useEffect(() => {
    const head = document.querySelector(".console");
    if (!head) return;
    const measure = () => setTop(Math.ceil(head.getBoundingClientRect().height) + 16);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onHash = () => setSlug(pageOfHash());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    scrollTo({ top: 0 });
  }, [slug]);

  const source = SOURCE.get(slug) ?? "";
  const html = useMemo(() => marked.parse(source, { renderer, async: false }) as string, [source]);
  const toc = useMemo(
    () => marked.lexer(source).filter((t): t is Tokens.Heading => t.type === "heading" && t.depth === 2).map((t) => ({ id: anchorOf(t.text), text: t.text.replace(/\[([^\]]*)\]/g, "$1") })), // 변경 기록의 [Unreleased]는 괄호 없이
    [source],
  );
  const i = ORDER.findIndex((p) => p.slug === slug);
  const prev = ORDER[i - 1];
  const next = ORDER[i + 1];
  // 쪽 안 목차는 주소(#docs/…)를 바꾸지 않고 스크롤만 한다
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <section className="docs" ref={rootRef} style={{ "--docs-top": `${top}px` } as CSSProperties}>
      <nav className="docs-nav" aria-label="안내 목차">
        {DOC_NAV.map((g) => (
          <div key={g.group} className="docs-group">
            <h2 className="docs-group-title">{g.group}</h2>
            <ul>
              {g.pages.map(([s, title]) => (
                <li key={s}>
                  <a href={`#docs/${s}`} className={s === slug ? "is-on" : ""} aria-current={s === slug ? "page" : undefined}>
                    {title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <a className="docs-source" href={REPO + (SOURCE_PATH[slug] ?? `docs/guide/${slug}.md`)} target="_blank" rel="noreferrer">
          이 쪽 원본 보기
        </a>
      </nav>

      <article className="docs-body">
        <p className="docs-crumb">{ORDER[i]?.group}</p>
        <div className="docs-md" dangerouslySetInnerHTML={{ __html: html }} />
        <footer className="docs-pager">
          {prev ? (
            <a href={`#docs/${prev.slug}`} className="docs-page prev">
              <span>이전</span>
              {prev.title}
            </a>
          ) : (
            <span />
          )}
          {next && (
            <a href={`#docs/${next.slug}`} className="docs-page next">
              <span>다음</span>
              {next.title}
            </a>
          )}
        </footer>
      </article>

      {toc.length > 1 && (
        <aside className="docs-toc" aria-label="이 쪽 목차">
          <h2 className="docs-group-title">이 쪽에서</h2>
          <ul>
            {toc.map((t) => (
              <li key={t.id}>
                <button onClick={() => jump(t.id)}>{t.text}</button>
              </li>
            ))}
          </ul>
        </aside>
      )}
    </section>
  );
}
