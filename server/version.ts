// 배포 판별. 빌드 정체(build)는 web/dist/index.html이 부르는 진입 스크립트 경로(/assets/index-<hash>.js)다.
// 화면도 import해서 쓰므로 node 모듈을 부르지 않는 순수 함수만 둔다.

// 운영 빌드의 진입 스크립트는 여기 아래에 있다. 개발 서버(/src/main.tsx)는 해당하지 않는다.
const BUNDLE_PREFIX = "/assets/";

// index.html에서 첫 <script type="module" src>의 경로. 없으면 null.
// 속성 순서·따옴표·대소문자가 달라도, 주석 안의 태그는 빼고, 주소는 경로만 남긴다.
export function entryScript(html: string): string | null {
  const text = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const [, attrs] of text.matchAll(/<script\b([^>]*)>/gi)) {
    const type = attr(attrs, "type");
    const src = attr(attrs, "src");
    if (type?.toLowerCase() !== "module" || !src) continue;
    try {
      return new URL(src, "http://localhost/").pathname;
    } catch {
      return null;
    }
  }
  return null;
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : null;
}

// 새 버전 알림을 띄울지. own은 이 화면이 돌리는 번들, server는 서버가 지금 내주는 번들,
// dismissed는 닫기를 누른 번들. 개발 화면이거나 서버가 빌드를 모르면 띄우지 않는다.
export function showNewVersion(own: string, server: string | null | undefined, dismissed: string | null): boolean {
  if (!own.startsWith(BUNDLE_PREFIX) || !server) return false;
  return server !== own && server !== dismissed;
}
