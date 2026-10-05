import { sameReg } from "./registration.ts";

// 이 세션이 그 관제 세션인가(ATC-545, 순수): 이름이 같거나(`Team G`도 TEAM_G, ATC-67) 그 폴더에서 열었다. dir은 realDir한 경로(없으면 이름으로만),
// norm은 세션 cwd를 같은 꼴로 만드는 함수(realDir). FLEET CONTROL SESSIONS·CONTROL 띠(controlRowsOf)와 control|down 알림이 이 하나를 읽는다.
// 화면 쪽 묶음이 supervisor-alerts.ts를 가져오므로 Node 내장 모듈을 import하지 않는다(realDir은 control-realdir.ts)
export function ofControlSession(specName: string, row: { name?: string | null; cwd?: string | null }, dir: string | null, norm: (p: string) => string): boolean {
  return sameReg(row.name, specName) || (dir !== null && Boolean(row.cwd) && norm(row.cwd!) === dir);
}
