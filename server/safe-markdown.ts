// 이슈 본문·PR 본문·댓글을 화면에 그릴 때 쓰는 안전한 Markdown(DUTY G1).
// 원시 HTML은 글자 그대로 보이고(태그로 살아나지 않는다), 이미지는 링크로만 남기고, 링크는 http(s)만 새 탭에서 rel="noreferrer"로 연다.
import { marked, type Tokens } from "marked";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const isHttp = (u: string) => /^https?:\/\/[^\s<>"']+$/i.test(u);

const renderer = new marked.Renderer();
renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => esc(text);
renderer.link = function ({ href, tokens }: Tokens.Link) {
  const inner = this.parser.parseInline(tokens);
  return isHttp(href) ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${inner}</a>` : inner;
};
renderer.image = ({ href, text }: Tokens.Image) => (isHttp(href) ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(text || href)}</a>` : esc(text));

export function renderSafeMarkdown(src: string): string {
  return marked.parse(src, { renderer, async: false, gfm: true, breaks: false }) as string;
}
