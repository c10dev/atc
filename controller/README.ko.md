# controller/ — TOWER 세션과 공용 관제 CLI

[English](README.md) · **한국어**

TOWER 세션(CONTROLLER)의 폴더이자, 모든 관제 세션(TOWER, OCC, CROSSCHECK, REVIEW, MCC)이 함께 쓰는 스크립트가 있는 곳이다. TOWER의 규정은 [`CLAUDE.md`](CLAUDE.md)(한국어 원본, [English](CLAUDE.en.md))와 [`/tick`](.claude/skills/tick/SKILL.md).

| 파일 | 역할 |
|---|---|
| `atcctl.mjs` | 관제 세션이 쓰는 atc CLI(`node atcctl.mjs …`, 기본 주소는 `ATC_URL`, 없으면 `http://127.0.0.1:7700`). 인자 없이 부르면 모든 명령을 보여 준다 |
| `guard.mjs` | 모든 관제 세션의 Bash guard. fail-closed(`… \|\| exit 2`). `--crosscheck`, `--review`, `--mcc`는 쓸 수 있는 `atcctl` 명령을 좁힌다 |
| `squelch.mjs` | SQUELCH hook: atc가 QUIET이라고 할 때만 평범한 `/tick`을 버리는 `UserPromptSubmit` 명령(아래). fail-open이고 guard가 아니다 |
| `*.test.mjs` | 위 파일들의 테스트 |

## `atcctl squelch <role>`과 SQUELCH hook

[docs/squelch.md](../docs/squelch.md)("S2 as built"). `<role>`은 `tower`, `mcc`, `occ`, `crosscheck`, `review`.

```bash
node atcctl.mjs squelch tower     # OPEN shadow:quiet   |   QUIET since 03:03 (4)
```

- `POST /api/squelch/<role>`을 불러, hook이 따를 결과를 그대로 출력한다: `OPEN <reason>` 또는 `QUIET since HH:MM (n)`(UTC, `n`은 그 뒤 버린 tick 수). 서버 오류면 `OPEN fail-open (<메시지>)`를 찍고 0으로 끝난다. 디버깅용이고, 세션이 `/tick` 안에서 쓸 일은 없다.
- `squelch.mjs <role>`이 hook이다. hook JSON을 stdin으로 읽고, 정확히 `/tick`인 프롬프트만 본다(앞뒤 공백은 봐 준다). `/tick now`, `/loop …`, 팀 메시지를 포함한 나머지는 출력 없이 0으로 끝난다. `/tick`이면 같은 API를 3초 제한으로 부르고, 답이 명시적인 `open: false`일 때만 `{"decision":"block","reason":"SQUELCH QUIET since 03:03Z (4)"}`를 찍는다. 다른 답이나 오류는 출력 없이 0으로 끝나므로 tick이 돈다.
- 절대 2로 끝나지 않는다. guard는 fail-closed이고 SQUELCH는 fail-open이다. `… || exit 2`로 걸지 않는다. 다섯 폴더의 `.claude/settings.json`이 모두 부르고(S3), ATC-553부터 모든 역할이 기본으로 `on`·지문 `v2`라 조용한 평범한 `/tick`은 버려진다. SUPERVISOR의 스위치(설정 창)가 역할 하나 또는 모든 역할을 `shadow`·`v1`로 되돌린다.
