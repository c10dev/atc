# review/ — 착륙 리뷰 세션(REVIEW)

[English](README.md) · **한국어**

Codex를 쓸 수 없을 때 vocado PR을 리뷰하는 관제 세션이다(ATC-7, ATC-27). opencodex를 거쳐 **DeepSeek V4.1 Flash**로 돌고, CROSSCHECK(Muse)와 따로 두어 계열별 수치가 섞이지 않게 한다. 규정은 [`CLAUDE.md`](CLAUDE.md)(한국어 원본, [English](CLAUDE.en.md))와 [`/tick`](.claude/skills/tick/SKILL.md). 설계: [`docs/occ.ko.md`](../docs/occ.ko.md) 9.2.

| 파일 | 역할 |
|---|---|
| `CLAUDE.md`, `.claude/skills/tick/SKILL.md` | 규정과 한 바퀴(한국어 원본, `*.en.md`는 번역) |
| `.claude/settings.json` | 모델 `claude-ocx-opencode-go--deepseek-v4.1-flash`, fail-closed hook: Bash → `../controller/guard.mjs --review`, MCP → `../occ/mcp-guard.mjs --read-only`, Read·Glob·Grep → `read-guard.mjs`, Edit·Write·SendMessage·Agent·Artifact 막음 |
| `read-guard.mjs` | CROSSCHECK의 읽기 규칙을 이 폴더 기준으로: `review/`, `../docs/`, 이 세션의 도구 출력 |
| `settings.test.mjs` | 설정, guard 모드, 읽기 규칙 테스트 |

## 여는 법

설정 창 CONTROL 블록의 REVIEW 줄에서 **LAUNCH**를 누르거나(ATC-66, [docs/fleet.ko.md](../docs/fleet.ko.md) 8.5.1), 같은 것을 손으로 연다. tmux의 `atc-review` 세션이다:

```bash
tmux new-session -d -s atc-review -c /home/c10/projects/atc/review "env -u ANTHROPIC_BASE_URL NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost ocx claude --strict-mcp-config -n REVIEW '/loop 10m /tick'"
```

- `-n REVIEW`가 세션 이름을 정하고 마지막 인자가 첫 메시지다.

- `ocx claude`가 settings의 모델을 opencodex 프록시로 보낸다. 평범한 `claude`로 열면 "selected model" 오류로 멈추므로 Claude로 몰래 돌지 않는다. `env -u ANTHROPIC_BASE_URL`과 `NO_PROXY`는 CROSSCHECK와 같은 이유다([docs/occ.ko.md](../docs/occ.ko.md) "CROSSCHECK").
- `--strict-mcp-config`는 MCP 서버를 싣지 않는다. 자료는 `atcctl landing review`로 받으니 MCP가 필요 없다.
- 기록할 때마다 guard가 세션 기록에서 실제 모델을 확인한다. `deepseek-v4.1-flash` 이름만 통과한다(ocx면 `claude-ocx-opencode-go--deepseek-v4.1-flash`, ClaudeRipple·Desktop이면 `deepseek-v4.1-flash`). 서버도 다른 모델의 리뷰를 받지 않는다.
- Claude Desktop에서: `review` 폴더로 세션을 열고 이름을 REVIEW로 붙인 뒤, 앱의 모델 메뉴에서 `deepseek-v4.1-flash`를 고르고(Desktop은 settings의 모델을 따르지 않는다) `/loop 10m /tick`.

## 할 수 있는 것

`node ../controller/atcctl.mjs manual check|ack`, `landing queue`, `landing review <repo>#<PR>`(자료), `landing review <repo>#<PR> --head <sha> --verdict pass|findings -- '<리뷰>'`(기록), 파이프 뒤의 `jq`. 그 밖은 없다: `gh`, 다른 atc 명령, `review/`·`docs/` 밖 파일 읽기 모두 막힌다.
