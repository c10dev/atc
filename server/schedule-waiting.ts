import type { ScheduleMode, ScheduleOp } from "./schedule.ts";

// "SCHEDULE 작업이 SUPERVISOR를 기다린다"의 정의 하나(ATC-450). SUPERVISOR QUEUE의 SCHEDULE 줄(supervisor-queue.ts)과 알림 4b `pending|schedule|`(supervisor-alerts.ts)이
// 이것을 같이 읽어, 알림 목록·`GET /api/status`의 "기다림"·SUMMARY의 `pending.schedule`·QUEUE가 어긋나지 않는다(waiting-person.ts와 같은 방식). 순수 함수.
// approval 모드의 draft만 기다린다: draft는 SUPERVISOR가 승인·거절할 것이다. shadow 모드의 agreed·disagreed는 게이트 판정이 끝난 기록이라 SUPERVISOR가 정할 일이 아니다.
export const scheduleWaitsOnSupervisor = (mode: ScheduleMode | undefined, op: Pick<ScheduleOp, "status">): boolean => mode === "approval" && op.status === "draft";
