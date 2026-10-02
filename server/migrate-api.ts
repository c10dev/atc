// 마이그레이션 리허설 기록 읽기(ATC-368). 읽기만 한다: 스위치는 설정 창의 PUT /api/settings(fromThisApp)로만 바꾸고, 이 길에는 쓰기가 없다.
import type { Hono } from "hono";
import { loadMigrate } from "./migrate-config.ts";
import { readMigrateRecords } from "./migrate-run.ts";

export function mountMigrate(app: Hono) {
  app.get("/api/migrate", (c) => c.json({ switches: loadMigrate().airports, records: readMigrateRecords(100) }));
}
