### 추가
- SUPERVISOR 알림(ATC-87, [docs/guide/alerts.md](docs/guide/alerts.md)): 열린 atc 탭이 SUPERVISOR가 볼 일이 생기면 백그라운드에서도 브라우저 알림 하나와, 따로 소리를 낸다. 둘 다 이 브라우저에서 켜야 한다(설정 → 알림, 기본 꺼짐).
  - 서버: key가 처음 생기거나 사라질 때 `alert` SSE 이벤트(`server/supervisor-alerts.ts`, key는 ALERT·FLIGHT FOLLOWING·health PENDING·판정할 DISPATCH 제안·HUMAN CHECK·CLEARED TO LAND PR·RTS 결과에서). `GET /api/supervisor-alerts`. 새로 찾아내는 것은 없다. ALERT 등급(ATC-110)은 `server/alert-level.ts`로 옮겼다.
  - 화면: key마다 한 번, 탭이 여럿이어도 한 번(Web Locks). 다시 연결되면(RTS 재시작) 새로 생긴 것만 알린다. 깜빡이는 key는 10분 기다린다. 알림이 꺼졌거나 거부되면 BELL 목록과 탭 제목 숫자로 알린다.
  - 소리: Web Audio로 합성한 넷(파일 없음) — WARNING은 ACK할 때까지 되풀이, CAUTION은 한 번, CALL은 SUPERVISOR를 기다리는 새 항목, DONE은 RTS 성공(기본 꺼짐). 한 번에 하나, 함께 오면 가장 높은 등급 하나, 조용한 시간, 음량.
