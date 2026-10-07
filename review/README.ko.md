# review/ — 착륙 리뷰 세션(REVIEW)

[English](README.md) · **한국어**

Codex를 쓸 수 없을 때 vocado PR을 리뷰하는 관제 세션이다(ATC-7, ATC-27). **Claude Sonnet**으로 돈다(2026-09-29부터. 전에는 ocx로 돌린 DeepSeek V4.1 Flash). 팀 CAPTAIN(Opus)과도, CROSSCHECK(Opus)와도 다른 모델이다. 규정은 [`CLAUDE.md`](CLAUDE.md)(한국어 원본, [English](CLAUDE.en.md))와 [`/tick`](.claude/skills/tick/SKILL.md). 설계: [`docs/occ.ko.md`](../docs/occ.ko.md) 9.2.

| 파일 | 역할 |
|---|---|
| `CLAUDE.md`, `.claude/skills/tick/SKILL.md` | 규정과 한 바퀴(한국어 원본, `*.en.md`는 번역) |
| `.claude/settings.json` | 모델 `claude-sonnet-5-5`, fail-closed hook: Bash → `../controller/guard.mjs --review`, MCP → `../occ/mcp-guard.mjs --read-only`, Read·Glob·Grep → `read-guard.mjs`, Edit·Write·SendMessage·Agent·Artifact 막음 |
| `read-guard.mjs` | CROSSCHECK의 읽기 규칙을 이 폴더 기준으로: `review/`, `../docs/`, 이 세션의 도구 출력 |
| `settings.test.mjs` | 설정, guard 모드, 읽기 규칙 테스트 |

## 여는 법

설정 창 CONTROL 블록의 REVIEW 줄에서 **LAUNCH**를 누르거나([docs/fleet.ko.md](../docs/fleet.ko.md) 8.5.1), 같은 것을 이 폴더에서 손으로 연다:

```bash
claude --bg -n REVIEW --permission-mode auto --strict-mcp-config "/loop 10m /tick"
```

- `-n REVIEW`가 세션 이름을 정하고 마지막 인자가 첫 메시지다. 모델은 `.claude/settings.json`이 정한다.
- 위는 `/loop` 모드다. 깨움 모드(CONTROL WAKE REVIEW `wake`, ATC-557 d부터 기본)에서는 LAUNCH가 대신 `[ATC WAKE BOOT] REVIEW`를 보내고, 리뷰를 기다리는 PR head가 생기면 서버가 세션을 깨운다([docs/control-recycle.ko.md](../docs/control-recycle.ko.md) "REVIEW 깨움과 하루 한 번 점검 턴").
- `--strict-mcp-config`는 MCP 서버를 싣지 않는다. 자료는 `atcctl landing review`로 받으니 MCP가 필요 없다.
- 기록할 때마다 guard가 세션 기록에서 실제 모델을 확인한다. `claude-sonnet-…` 이름만 통과한다. 서버도 다른 모델의 리뷰를 받지 않는다. main 병합 뒤 리뷰를 이어받을 때(ATC-31)는 옛 DeepSeek 기록도 인정한다.
- tmux와 `ocx claude`로 띄우던 길(ATC-66)은 2026-09-29에 없앴다.

## 할 수 있는 것

`node ../controller/atcctl.mjs manual check|ack`, `landing queue`, `landing review <repo>#<PR>`(자료), `landing review <repo>#<PR> --head <sha> --verdict pass|findings -- '<리뷰>'`(기록), 파이프 뒤의 `jq`. 그 밖은 없다: `gh`, 다른 atc 명령, `review/`·`docs/` 밖 파일 읽기 모두 막힌다.
