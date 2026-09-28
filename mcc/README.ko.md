# mcc/ — atc 자신의 착륙 세션(MCC)

[English](README.md) · **한국어**

atc 저장소 자신의 PR을 INSPECTION하고, `auto`·`flagged` PR을 착륙시키고, 머지된 코드로 7700 서비스를 되돌려 놓는 관제 세션이다. **Claude**로 돈다. 규정은 [`CLAUDE.md`](CLAUDE.md)(한국어 원본, [English](CLAUDE.en.md))와 [`/tick`](.claude/skills/tick/SKILL.md). 설계: [`docs/mcc.md`](../docs/mcc.md).

| 파일 | 역할 |
|---|---|
| `CLAUDE.md`, `.claude/skills/tick/SKILL.md` | 규정과 한 바퀴(한국어 원본, `*.en.md`는 번역) |
| `.claude/settings.json` | 모델 `opus`, fail-closed hook: Bash → `../controller/guard.mjs --mcc --gh-read`, MCP → `../occ/mcp-guard.mjs --read-only`, Read/Glob/Grep → `read-guard.mjs`, Edit/Write/SendMessage/Agent/Artifact 막음 |
| `read-guard.mjs` | atc 저장소만 읽는다: `.env*`와 저장소 맨 위 Grep은 막고, 밖은 이 세션의 도구 출력만 |
| `settings.test.mjs` | 설정, guard 모드, 모델 규칙(서버와 같음), 읽기 규칙 테스트 |

## 띄우기

tmux에서 `atc-mcc` 세션으로:

```bash
tmux new-session -d -s atc-mcc -c /home/c10/projects/atc/mcc 'claude --strict-mcp-config'
tmux send-keys -t atc-mcc '/loop 5m /tick' Enter
```

- `--strict-mcp-config`는 MCP 서버를 싣지 않는다. 필요한 것은 모두 `atcctl mcc`에서 온다.
- 쓰기(`mcc inspect|escalate|land|rts`)마다 guard가 기록의 실제 모델을 확인한다. Claude 이름만 통과한다(`claude-opus-…`, `claude-sonnet-…`, `claude-fable-…`, `claude-haiku-…`). 서버도 그 모델이 없는 쓰기를 거절한다. `ocx`로 다른 모델에 돌린 세션은 막힌다.
- 또는 설정 창 AGENTS 탭 CONTROL 블록의 MCC 줄에서 LAUNCH: atc가 같은 폴더·옵션·첫 메시지로 백그라운드에 띄운다([docs/fleet.ko.md](../docs/fleet.ko.md) 8.5.1).
- Claude Desktop에서는 `mcc` 폴더를 열고 세션 이름을 MCC로, 모델은 Claude로 두고 `/loop 5m /tick`.

## 할 수 있는 것

`node ../controller/atcctl.mjs manual check|ack`와 `mcc queue|packet|inspect|escalate|land|rts`, 파이프 뒤의 `jq`, 읽기 전용 `gh pr view|diff|checks|list`. 그 밖은 없다: `git`, `systemctl`, `gh pr merge`·`gh api`, 다른 atc 명령. 착륙과 RTS를 할지는 서버가 정하고(조건 L2–L8, `mcc.json` 스위치), 머지·PR 댓글·RTS 시작도 서버가 한다.
