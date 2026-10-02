// C2(ATC-324): docs/design-language.md 3.5 규칙 2 — 한글 문장은 mono가 아니라 sans. `.mono` 요소가 여는 태그 바로 뒤에 한글 글을 직접 담으면 걸린다.
// 정규식으로 보는 얕은 검사라 `{…}`·자식 태그 뒤의 글은 못 본다: 거짓 경보를 피하려는 선택이다.
const HANGUL = /[가-힣]/;
const OPEN = /<(\w+)\b(?:[^<>]|=>)*?className=(?:"([^"]*)"|\{`([^`]*)`\})(?:[^<>]|=>)*?(?<!=)>([^<{]*)/g;

export function monoHangul(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(OPEN)) {
    const cls = (m[2] ?? m[3] ?? "").split(/\s+/);
    if (cls.includes("mono") && HANGUL.test(m[4])) out.push(m[4].trim().replace(/\s+/g, " ").slice(0, 60));
  }
  return out;
}
