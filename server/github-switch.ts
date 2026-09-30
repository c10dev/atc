// ATC_GITHUB=off: 서버가 GitHub(gh)를 아예 부르지 않는다(ATC-161). 시험 서버가 SUPERVISOR의 토큰으로 GitHub를 두드리지 않게 한다.
// 기본은 켜짐이다. 순수 함수만 두고, gh를 부르는 곳은 모두 assertGithubOn()을 지난다.
export const GITHUB_OFF_REASON = "GitHub off (ATC_GITHUB=off)";

const OFF = new Set(["off", "0", "false", "no"]);

export function githubSwitchOf(env: Record<string, string | undefined>): { enabled: boolean; reason: string | null } {
  const v = (env.ATC_GITHUB ?? "").trim().toLowerCase();
  return OFF.has(v) ? { enabled: false, reason: GITHUB_OFF_REASON } : { enabled: true, reason: null };
}

export class GithubOffError extends Error {
  constructor() {
    super(GITHUB_OFF_REASON);
    this.name = "GithubOffError";
  }
}

export const githubSwitch = () => githubSwitchOf(process.env);
export const githubOn = () => githubSwitch().enabled;

// 모든 gh 호출 앞에서 부른다. 꺼져 있으면 gh를 실행하지 않고 분명한 오류를 던진다.
export function assertGithubOn(): void {
  if (!githubOn()) throw new GithubOffError();
}

// 시작할 때 한 줄: 운영 상태 폴더가 아닌데 GitHub가 켜져 있으면 시험 서버가 SUPERVISOR의 토큰으로 폴링한다.
export function githubStartupWarning(o: { enabled: boolean; stateDir: string; prodStateDir: string }): string | null {
  const norm = (p: string) => p.replace(/\/+$/, "");
  return o.enabled && norm(o.stateDir) !== norm(o.prodStateDir)
    ? "[atc] test server polling GitHub with the SUPERVISOR's token (ATC_STATE_DIR is not the production state folder; set ATC_GITHUB=off)"
    : null;
}
