import assert from "node:assert/strict";
import { test } from "node:test";
import { workTargets } from "./shell.mjs";

const W = "/home/c10/projects/worktrees/vocado-voc-187";

const cases = [
  // 잡아야 하는 것
  [`cd ${W} && npm test`, [W]],
  [`cd "${W}"; ls`, [W]],
  [`cd -- ${W}`, [W]],
  [`npm test && (cd ${W} && ls)`, [W]],
  [`x=$(cd ${W} && pwd)`, [W]],
  [`if cd ${W}; then ls; fi`, [W]],
  [`FOO=1 git -C ${W} status`, [W]],
  [`git -C '${W}' status`, [W]],
  [`git --no-pager -c core.pager=cat -C ${W} log -1`, [W]],
  [`cd ../worktrees/x`, ["../worktrees/x"]],
  [`cd ~/projects/worktrees/x`, ["~/projects/worktrees/x"]],
  [`bash -c "cd ${W} && make"`, [W]],
  [`cat <<'EOF' > f\ncd /nope\nEOF\ncd ${W} && ls`, [W]],
  [`cat <<-EOF\n\tcd /nope\n\tEOF\ngit -C ${W} status`, [W]],
  // 건너뛰어야 하는 것
  [`echo "cd ${W}"`, []],
  [`echo cd ${W}`, []],
  [`printf 'git -C %s status\\n' ${W}`, []],
  [`jq -nc --arg c "git -C '${W}' status" '{c:$c}'`, []],
  [`cat <<'EOF'\ncd ${W}\ngit -C ${W} log\nEOF`, []],
  [`python3 - <<EOF\nimport os; os.system("cd ${W}")\nEOF`, []],
  [`cat <<< "cd ${W}"`, []],
  [`ls ${W} && cat ${W}/package.json`, []],
  [`git commit -C HEAD --amend`, []],
  [`# cd ${W}\nls`, []],
  [`cd -`, []],
];

for (const [command, expected] of cases) {
  test(JSON.stringify(command).slice(0, 70), () => assert.deepEqual(workTargets(command), expected));
}
