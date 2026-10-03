// styles.css의 theme-gen 표식 사이를 web/src/theme-gen.ts의 입력으로 다시 쓴다: `node web/gen-themes.ts`
import { readFileSync, writeFileSync } from "node:fs";
import { applyGenerated } from "./src/theme-gen.ts";

const file = new URL("./src/styles.css", import.meta.url);
const before = readFileSync(file, "utf8");
const after = applyGenerated(before);
if (after === before) console.log("styles.css는 이미 입력과 같다");
else {
  writeFileSync(file, after);
  console.log("styles.css의 테마 블록을 다시 썼다");
}
