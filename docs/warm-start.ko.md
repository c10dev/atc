# WARM START (ATC-539)

[English](warm-start.md) · **한국어**

재시작(예: RETURN TO SERVICE) 뒤 서버는 Linear, GitHub, 모든 workspace를 읽어 스냅샷이 따뜻해질 때까지(`isWarm`, `server/events.ts`) 약 90초가 걸린다. 그동안 화면에 PR이 빠져 보인다. WARM START는 마지막 따뜻한 스냅샷을 디스크에 두었다가 바로 보여 준다. **표시 전용**이다.

## 동작

- **저장.** 살아 있는 스냅샷이 따뜻하면 서버가 `<상태 폴더>/warm-snapshot.json`(`{ savedAt, snapshot }`, 권한 0600)에 쓴다. 원자적으로(임시 파일에 쓰고 바꿔치기) 쓰고, 최대 1분에 한 번이다. 콜드 스냅샷은 저장하지 않는다.
- **복원.** 부팅 때 파일이 있고, 읽히고, `maxAgeMin`(기본 10, `warm-start.json`)보다 젊으면 서버가 그것을 *복원본*으로 들고 있는다. `GET /api/snapshot`과 SSE `snapshot` 이벤트가 `restored: { savedAt, ageSec }`를 달아 내준다. 화면은 바뀔 때까지 한 줄("재시작 직후라 마지막 상태를 보여 주는 중입니다 …")을 보인다.
- **교체.** 첫 살아 있는 스냅샷이 따뜻해지면, 또는 복원본이 `maxAgeMin`보다 오래되면(살아 있는 것이 끝내 따뜻해지지 않을 때, 예: Linear 장애) 복원본을 버리고 살아 있는 것을 보낸다.
- **지워도 안전.** 없거나, 깨졌거나, 못 읽거나, 미래 시각이거나, 너무 오래된 파일은 보통의 콜드 스타트다. `warm-snapshot.json`은 언제 지워도 안전하다. 새 파일이고 기존 상태 형식은 바뀌지 않았다.

## 쓰지 않는 곳

복원본은 `WarmStart`(`server/warm-start.ts`) 안에만 있다. 살아 있는 `current` 스냅샷에는 절대 넣지 않는다. 그래서 `isWarm`, `diffSnapshots`(`alert.raised`·`alert.cleared`·LANDING 이벤트도, FLIGHT RECORDER 줄도 없다), 잡(DISPATCH, AUTOLAND, MCC, ATFM …), SUPERVISOR 알림, 요약은 모두 살아 있는 데이터만 읽는다. 다른 `/api/*` 길(HOME 흐름판, DISPATCH …)도 살아 있는 데이터를 읽으므로, 살아 있는 스냅샷이 따뜻해질 때까지 전과 같다.

## 스위치

설정 → OPERATIONS → **WARM START**(`warm-start.json`, 기본 `on`, SUPERVISOR 전용, `atcctl` 명령 없음). `off`면 캐시 파일을 쓰지도 읽지도 않는다. `maxAgeMin`(1–120, 기본 10)은 `warm-start.json`에서 고친다. 오발 카운터는 없다: 이 데이터로 움직이는 것이 없고 보이기만 한다.
