import { realpathSync } from "node:fs";

// 폴더 경로 정규화: 심볼릭 링크를 풀고, 없는 경로는 끝의 /만 뗀다
export const realDir = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p.length > 1 ? p.replace(/\/$/, "") : p;
  }
};
