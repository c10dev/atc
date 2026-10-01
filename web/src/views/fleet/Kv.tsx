import type { ReactNode } from "react";

// 카드의 라벨·값 한 줄(ATC-287): 라벨은 sans, 값은 mono 숫자(.tn), 목표는 값 옆의 흐린 캡션. 라벨 칸은 한 줄로 맞춘다
export function Kv({ label, target, tone, title, children }: { label: string; target?: ReactNode; tone?: "short" | "bad"; title?: string; children: ReactNode }) {
  return (
    <div className="fl-kv" title={title}>
      <span className="fl-kv-k">{label}</span>
      <span className={`fl-kv-v tn mono${tone === "short" ? " fl-short" : tone === "bad" ? " fl-bad" : ""}`}>{children}</span>
      {target != null && <span className="fl-kv-t tn">{target}</span>}
    </div>
  );
}
