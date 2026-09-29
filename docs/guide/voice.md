# 음성 콜아웃

WARNING과 CALL 알림은 톤에 이어 **짧은 영어 콜아웃**을 한 번 읽습니다. 무전기 소리처럼 들리게 브라우저가 키 클릭, 스켈치, 대역 필터를 씌웁니다.

> 예: 키 클릭 → 스켈치 → *"Supervisor, GOLF, standing by for approval."* → 스켈치 꼬리

목소리는 **이 컴퓨터의 엔진(Piper)** 이 만들고, 문구도 소리도 밖으로 나가지 않습니다. 엔진이 없으면 톤만 나고 설정에 `TTS 엔진 없음`이 보입니다. 기본은 꺼져 있습니다.

## 무엇을 읽나

문구는 알림 종류마다 정해진 틀입니다. 알림의 한국어 글은 읽지 않고, 콜사인(GOLF, KILO)과 FLIGHT 번호(`ATC-120` → "ATC one two zero", 9는 "niner")만 채웁니다.

| 종류 | 소리 | 읽는 문구 |
|---|---|---|
| 같은 STAND를 두 팀이 점유(충돌) | WARNING | Supervisor, GOLF and KILO, traffic conflict on ATC one two zero, request instructions. |
| 머지가 기본 브랜치에 닿지 않음(STRANDED) | WARNING | Supervisor, ATC one two one stranded, merge not on main, request instructions. |
| RTS가 ROLLBACK · 실패 | WARNING | Supervisor, return to service rolled back, request instructions. |
| 도구 승인을 기다리는 AIRCRAFT(PENDING) | CALL | Supervisor, GOLF, standing by for approval. |
| 판정을 기다리는 DISPATCH 제안 | CALL | Supervisor, dispatch proposal waiting on ATC one four zero, request decision. |
| HUMAN CHECK 대기 | CALL | Supervisor, human check waiting on ATC five, request decision. |

CAUTION(예: AIRCRAFT health, FLIGHT FOLLOWING 문제), ADVISORY, DONE에는 음성이 없습니다(CAUTION은 하루 30번쯤 울립니다). 톤 다음에 **한 번만** 읽고, WARNING 톤이 되풀이돼도 음성은 되풀이하지 않습니다. 확인(ACK)하면 톤과 음성이 함께 멈춥니다. 여러 알림이 한꺼번에 오면 가장 높은 등급 하나만 읽습니다. 소리가 켜진 탭 하나, 조용한 시간, 10분 재울림 방지는 톤과 같습니다.

## 켜기

1. 설정 창(로고) → **알림** 탭 → SOUND를 **켜기**(브라우저의 소리 잠금을 푸는 클릭입니다).
2. 같은 탭의 **VOICE 음성 콜아웃**을 **켜기**.
3. **목소리**를 고르고 **미리 듣기**를 눌러 들어 봅니다. 고정 예시 문구가 무전 효과와 함께 나옵니다.
4. **무전 효과**로 조절합니다. 0%는 깨끗한 음성, 100%는 완전한 무전(클릭, 스켈치, 300–3000 Hz 대역, 가벼운 왜곡과 압축, 낮은 치익 소리)입니다.

VOICE 켜기와 무전 효과는 이 브라우저에만 저장됩니다. 엔진과 고른 목소리는 서버 설정(`.env.local`)이라 어느 브라우저에서 바꿔도 같습니다.

## 엔진 설치 (SUPERVISOR가 한 번)

팀 세션은 엔진을 설치하지 않습니다. 시스템 패키지 없이 `~/.local` 아래에만 넣습니다.

```sh
# 1) Piper(파이썬 패키지 piper-tts)를 전용 가상환경에
python3 -m venv ~/.local/share/piper/venv
~/.local/share/piper/venv/bin/pip install piper-tts

# 2) atc가 부르는 실행 파일(기본 경로 ~/.local/bin/piper)
mkdir -p ~/.local/bin
printf '#!/bin/sh\nexec "$HOME/.local/share/piper/venv/bin/python" -m piper "$@"\n' > ~/.local/bin/piper
chmod +x ~/.local/bin/piper

# 3) 목소리 하나(기본 폴더 ~/.local/share/piper/voices)
mkdir -p ~/.local/share/piper/voices
~/.local/share/piper/venv/bin/python -m piper.download_voices en_US-lessac-medium --data-dir ~/.local/share/piper/voices

# 4) 한 번 시험(WAV가 나오면 된다)
echo 'Supervisor, GOLF, radio check.' | ~/.local/bin/piper -m ~/.local/share/piper/voices/en_US-lessac-medium.onnx -f /tmp/radio-check.wav
```

atc는 `piper -m <목소리>.onnx -f <파일>`로 부르고 문구는 표준 입력으로 넘깁니다(셸 없이, 5초 제한, 한 번에 하나). 위 시험이 되면 설정 창의 목소리 목록에 `en_US-lessac-medium`이 보입니다. 경로를 바꾸려면 `.env.local`에 적습니다.

```
ATC_TTS_ENGINE=piper
ATC_TTS_PIPER=/home/you/.local/bin/piper
ATC_TTS_VOICES=/home/you/.local/share/piper/voices
```

서버를 다시 띄우면 적용됩니다(설정 창은 엔진과 목소리만 바로 바꿉니다).

## 목소리 더하기·바꾸기

- 목소리는 `<이름>.onnx`와 `<이름>.onnx.json` 한 쌍입니다. 둘 다 있어야 목록에 나옵니다. 다른 목소리를 받아 같은 폴더에 두면(`python -m piper.download_voices <이름> --data-dir …`) 설정의 목록에 생깁니다.
- 목록에서 고르고 **미리 듣기**로 확인합니다. 마음에 안 들면 다른 목소리를 고르거나, 무전 효과를 줄입니다. 코드를 고칠 일은 없습니다.
- 다른 엔진(Kokoro, espeak-ng 등)은 `server/tts.ts`에 어댑터 하나를 더하면 되고 화면은 바뀌지 않습니다. 설정의 엔진 값은 지금 `piper`, `none`, `stub`(시험용)입니다.

## 끄기

- 이 브라우저만: 설정 → 알림 → VOICE **끄기**.
- 엔진 자체: `.env.local`에 `ATC_TTS_ENGINE=none`(또는 그 줄을 지우고 Piper를 지웁니다: `rm -r ~/.local/share/piper ~/.local/bin/piper`).
- 만들어 둔 음성 캐시는 `~/.local/state/atc/voice-cache/`(200개·20 MB까지, 오래된 것부터 지움)입니다. 지워도 다시 만들 뿐입니다.

## 라이선스 (2026-09-29에 확인)

atc는 엔진과 목소리를 **따로 도는 프로그램과 파일**로 쓸 뿐 저장소에 싣지 않고, 음성 파일도 저장소에 넣지 않습니다. 그래도 설치하는 것의 조건은 직접 확인하세요.

- **Piper.** 위에서 설치하는 `piper-tts`는 OHF-Voice 프로젝트(`OHF-Voice/piper1-gpl`)이고 **GPL-3.0**입니다. 예전 `rhasspy/piper`는 이 프로젝트로 옮겨 갔습니다.
- **목소리 모델은 각각 라이선스가 다릅니다.** 목소리마다 모델 카드에 적혀 있습니다.
  - `en_US-ryan-high`(Ryan Speech)와 `en_US-hfc_male-medium`(Hi-Fi Captain)은 **CC BY-NC-SA 4.0**(비영리, 같은 조건으로 공유)입니다.
  - `en_US-lessac-medium`은 Lessac Blizzard 2013 데이터셋의 조건(Edinburgh CSTR가 적어 둔 라이선스)을 따르고, 상업 사용이 되는지는 모델 카드만으로 확인하지 못했습니다.
  - 개인 도구로 쓰더라도 고른 목소리의 카드를 읽고 조건에 맞게 쓰세요. 회사에서 쓰려면 특히 확인하세요.

## 문제 해결

| 설정 창의 표시 | 뜻 | 할 일 |
|---|---|---|
| `TTS 엔진 없음 — piper 실행 파일 없음` | `ATC_TTS_PIPER` 경로(기본 `~/.local/bin/piper`)에 실행 파일이 없음 | 위 설치 2)를 하거나 경로를 고칩니다 |
| `TTS 엔진 없음 — 목소리 없음` | 목소리 폴더에 `.onnx`와 `.onnx.json` 한 쌍이 없음 | 위 설치 3)을 하거나 `ATC_TTS_VOICES`를 고칩니다 |
| `미리 듣기 실패: 5초 안에 끝나지 않음` | 엔진이 5초 안에 못 끝냄(첫 실행의 모델 읽기가 느릴 때) | 한 번 더 누릅니다. 계속되면 더 작은 목소리(`low`·`medium`)를 씁니다 |
| `미리 듣기 실패: 소리가 꺼져 있음` | 브라우저가 소리를 막음 | SOUND를 켜는 클릭을 다시 합니다 |
| 톤만 나고 음성이 없음 | CAUTION·DONE이거나, VOICE가 꺼짐, 그 알림에 문구 틀이 없음 | 위 표를 봅니다 |
