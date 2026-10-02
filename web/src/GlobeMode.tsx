import { X } from "lucide-react";
import { useRef } from "react";
import { useDialog } from "./useDialog.ts";
import { IconButton } from "./Icon.tsx";
import { lazyTab } from "./lazyTab.tsx";
import "./GlobeMode.css";

// GLOBE는 탭이 아니라 보기 모드다(ATC-381, docs/layout.md Y6): 헤더 버튼이나 #globe(#globe/<AIRPORT>)가 현재 화면 위에 꽉 찬 창으로 연다.
// 닫으면(Esc, 닫기 버튼) 열기 전 화면으로 돌아간다. 지구본 자체(views/Globe.tsx)는 그대로다.
const Globe = lazyTab<{ refreshKey: string }>(() => import("./views/Globe.tsx"), "Globe");

export function GlobeMode({ refreshKey, onClose }: { refreshKey: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  return (
    <div className="gm-overlay" role="dialog" aria-modal="true" aria-label="GLOBE" tabIndex={-1} ref={ref}>
      <header className="gm-head">
        <span className="gm-title mono">GLOBE</span>
        <IconButton className="gm-close" onClick={onClose} label="GLOBE 닫기" icon={X} size={16} />
      </header>
      <div className="gm-body">
        <Globe refreshKey={refreshKey} />
      </div>
    </div>
  );
}
