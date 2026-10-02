// 백그라운드 job의 detail은 Claude Code가 마지막으로 적은 한 줄이다(ATC-369). 지금 하는 일이 아니라 "마지막으로 안 것"이라
// 카드는 나이와 함께 보인다: "last known, 17 h ago". 순수 함수(화면도 쓴다).

const MIN = 60_000;

type Written = { writtenAt?: string | null; since?: string | null };

// 마지막으로 적은 때(writtenAt, 없으면 since)부터 now까지: `just now` · `5 min ago` · `17 h ago` · `3 d ago`. 시각을 모르면 null
export function jobAgeText(job: Written, now: number): string | null {
  const t = Date.parse(job.writtenAt ?? job.since ?? "");
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.floor((now - t) / MIN));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}

// "last known, 17 h ago". 시각을 모르면 "last known"
export function jobKnownText(job: Written, now: number): string {
  const age = jobAgeText(job, now);
  return age ? `last known, ${age}` : "last known";
}
