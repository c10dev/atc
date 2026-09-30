// 이 화면이 어느 창에서 열렸나(ATC-178). ANNUNCIATOR(Mac 메뉴 막대 앱, chaehy5665/atc-app)의 atc 창은 user-agent 끝에 `ANNUNCIATOR/<version>`을 붙인다
// (앱의 applicationNameForUserAgent, atc-app N7). 그 창에서는 알림 톤·음성 콜아웃·브라우저 알림을 앱이 낸다(N4·N7a). 보통 브라우저 탭은 늘 "browser"다.
export type Host = "annunciator" | "browser";

export const APP_UA = /(?:^|[\s(])ANNUNCIATOR\/\S+/;

// 순수: user-agent 글 → 창 종류. 없거나 모르면 browser
export function hostOf(userAgent: string | null | undefined): Host {
  return typeof userAgent === "string" && APP_UA.test(userAgent) ? "annunciator" : "browser";
}

export const HOST: Host = hostOf(typeof navigator === "undefined" ? null : navigator.userAgent);
export const inApp: boolean = HOST === "annunciator";
