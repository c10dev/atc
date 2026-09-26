// Bash 명령에서 "실제로 들어가는" 디렉터리만 뽑는다: 명령 위치의 `cd <dir>`와 `git -C <dir>`.
// echo·printf·jq 등의 인자 문자열과 heredoc 본문은 명령 위치가 아니므로 건너뛴다.
// 완전한 셸 파서가 아니라 점유 판정용 근사다. 의존성 없음.

// heredoc 본문(<<EOF … EOF, <<'EOF', <<-EOF)을 지운다. <<< (here-string)은 건드리지 않는다.
function stripHeredocs(src) {
  const out = [];
  const pending = [];
  for (const line of src.split("\n")) {
    if (pending.length) {
      const { tag, dash } = pending[0];
      if ((dash ? line.replace(/^\t+/, "") : line) === tag) pending.shift();
      continue;
    }
    out.push(line);
    for (const m of line.matchAll(/(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_][\w-]*)\2/g)) {
      pending.push({ dash: m[1] === "-", tag: m[3] });
    }
  }
  return out.join("\n");
}

// 따옴표를 푼 단어 배열의 목록. ; & | 줄바꿈 ( ) ` $( 에서 명령을 나눈다.
export function simpleCommands(src) {
  const text = stripHeredocs(src);
  const commands = [];
  let words = [];
  let word = "";
  let inWord = false;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      if (text[i + 1] !== "\n") (word += text[i + 1] ?? ""), (inWord = true);
      i++;
    } else if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end < 0 ? text.length : end;
      word += text.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) j++;
        word += text[j++];
      }
      inWord = true;
      i = j;
    } else if (ch === "#" && !inWord) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl - 1;
    } else if (ch === " " || ch === "\t") {
      endWord();
    } else if (ch === "$" && text[i + 1] === "(") {
      endCommand();
      i++;
    } else if ("\n;&|()`".includes(ch)) {
      endCommand();
    } else {
      word += ch;
      inWord = true;
    }
  }
  endCommand();
  return commands;
}

// 명령 앞에 올 수 있어서 건너뛰는 단어
const PREFIX = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{", "}", "time", "command", "exec"]);
const SHELLS = new Set(["bash", "sh", "zsh"]);

export function workTargets(command, depth = 0) {
  const out = [];
  for (const words of simpleCommands(command)) {
    let i = 0;
    while (i < words.length && (PREFIX.has(words[i]) || /^[A-Za-z_]\w*=/.test(words[i]))) i++;
    const [cmd, ...args] = words.slice(i);
    if (cmd === "cd") {
      const target = args.find((a) => a !== "--" && !/^-[LPe@]+$/.test(a));
      if (target && target !== "-") out.push(target);
    } else if (cmd === "git") {
      // 서브커맨드 앞의 전역 옵션만 본다 (git commit -C <commit> 제외)
      for (let j = 0; j < args.length; j++) {
        if (args[j] === "-C") {
          if (args[j + 1]) out.push(args[j + 1]);
          j++;
        } else if (args[j] === "-c") j++;
        else if (!args[j].startsWith("-")) break;
      }
    } else if (SHELLS.has(cmd) && depth < 2) {
      const k = args.indexOf("-c");
      if (k >= 0 && args[k + 1]) out.push(...workTargets(args[k + 1], depth + 1));
    }
  }
  return out;
}
