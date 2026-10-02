// 세션을 띄울 때의 상수. session-control.ts에서 옮겼다(ATC-338): fleet-plan.ts가 이것만 필요해서 session-control.ts를 통째로 가져오면 fresh-start.ts와 순환이었다.

// bypassPermissions는 두지 않는다: 띄운 세션이 권한 확인 없이 도는 길을 atc가 열지 않는다
export const PERMISSION_MODES = ["auto", "acceptEdits", "default"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const DEFAULT_PERMISSION_MODE: PermissionMode = "auto";

// 동시에 살아 있는 atc가 띄운 세션 수 상한(비용). ATC_MAX_LAUNCHED로 바꾼다
export const MAX_LAUNCHED = Number(process.env.ATC_MAX_LAUNCHED) || 6;
