// DUTY 글의 언어 검사(ATC-510, ATC-150). 순수. SUPERVISOR에게 가는 글은 한국어 또는 영어만이다.
// 가나나 한자(CJK 표의문자)가 있는데 한글이 없는 줄을 센다. 경고일 뿐이다: 글은 막지 않고 그대로 간다.
// 코드 블록·인라인 코드·URL·경로·파일 이름과 `BEGIN DATA … END DATA`(밖에서 온 글) 안은 보지 않는다.

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/; // 히라가나·가타카나·반각 가타카나
const HAN = /[㐀-䶿一-鿿豈-﫿]/; // CJK 표의문자
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

export interface LanguageCheck {
  checked: number; // 볼 만한 줄(코드·데이터 등을 덜어 내고 글자가 남은 줄)
  flagged: number; // 그중 가나·한자만 있고 한글이 없는 줄
}

// 줄 하나가 플래그인가. 앞서 덜어 낸 줄이어야 한다(stripLine의 결과)
export function flaggedLine(line: string): boolean {
  if (!line.trim()) return false;
  if (HANGUL.test(line)) return false; // 한글이 있으면 한자어 표기로 본다
  return KANA.test(line) || HAN.test(line);
}

// 인라인으로 덜어 내는 것: `코드`, URL, 경로(/가 든 토큰), 확장자가 붙은 파일 이름
function stripLine(line: string): string {
  return line
    .replace(/`[^`]*`/g, " ")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
    .replace(/[^\s"'“”‘’「」]*\/[^\s"'“”‘’「」]*/g, " ")
    .replace(/[^\s"'“”‘’「」]+\.[A-Za-z0-9]{1,6}(?![A-Za-z0-9])/g, " ");
}

export function checkDutyText(text: string): LanguageCheck {
  let checked = 0;
  let flagged = 0;
  let fence: string | null = null; // 열린 코드 울타리(``` 또는 ~~~)
  let data = false; // BEGIN DATA 안
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const t = raw.trim();
    const f = /^(```|~~~)/.exec(t);
    if (fence) {
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    if (data) {
      if (/\bEND DATA\b/.test(t)) data = false;
      continue;
    }
    if (/\bBEGIN DATA\b/.test(t)) {
      data = !/\bEND DATA\b/.test(t.slice(t.indexOf("BEGIN DATA")));
      continue;
    }
    const s = stripLine(raw);
    if (!/[\p{L}\p{N}]/u.test(s)) continue;
    checked++;
    if (flaggedLine(s)) flagged++;
  }
  return { checked, flagged };
}
