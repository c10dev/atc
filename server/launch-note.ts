// FLEET 행·카드의 "next LAUNCH" 표시(ATC-257). 순수, import 없음(화면도 쓴다).
// launch = 브리프의 LAUNCH ACCOUNT(AIRCRAFT용, 등록부에 있는 라벨만 옴. effectiveLaunchAccount 결과 그대로), home = AIRCRAFT 프로필 account(없으면 기본).
// LAUNCH ACCOUNT가 없거나 home과 같으면 null — 바뀌는 게 없으니 home만 보인다. 규칙은 launch-account.ts 것을 다시 만들지 않는다.
export function nextLaunchNote(launch: string | null | undefined, home: string | null | undefined): string | null {
  if (!launch || launch === home) return null;
  return `next LAUNCH ${launch} (home ${home ?? "default"})`;
}
