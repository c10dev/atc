import { Component, type ComponentType, type ReactNode, lazy } from "react";
import { isChunkLoadError } from "../../server/version.ts";

// 탭 view를 따로 불러온다(React.lazy). view는 이름 있는 export라 default로 감싼다.
// 첫 화면(RADAR)과 공용 부분(머리글, 새 버전 알림, SSE)은 메인 번들에 있다.
export function lazyTab<P extends object>(load: () => Promise<Record<string, unknown>>, name: string) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType<P> }));
}

// 탭을 불러오는 동안의 자리 표시(테마 토큰을 쓰는 .empty)
export const TabLoading = () => (
  <p className="empty tab-loading" role="status">
    화면 불러오는 중…
  </p>
);

interface BoundaryProps {
  children: ReactNode;
  stale: boolean; // 서버가 이 화면과 다른 번들을 내주는 중(새 버전이 배포됨)
}

// 탭 하나의 오류를 그 탭 안에서 보여 준다. 청크를 못 불러온 것이면(대개 배포 뒤 예전 탭) 새로고침을 권한다.
// 입력 중인 내용이 날아가지 않게 저절로 새로고침하지 않는다(NewVersionBar와 같은 원칙).
// 탭을 바꾸면 App이 key로 새로 만든다.
export class TabBoundary extends Component<BoundaryProps, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (error == null) return this.props.children;
    const chunk = isChunkLoadError(error);
    return (
      <div className="tab-error" role="alert">
        <p className="tab-error-head">{chunk ? "이 화면을 불러오지 못함" : "이 화면에서 오류가 남"}</p>
        <p className="tab-error-text">
          {chunk
            ? this.props.stale
              ? "새 버전이 배포되어 이 탭이 쓰던 화면 파일이 없어졌다. 새로고침하면 새 버전으로 열린다."
              : "화면 파일을 받지 못했다 — 새 버전이 배포됐거나 서버에 잠시 닿지 않았다. 새로고침해 본다."
            : String((error as Error)?.message ?? error)}
        </p>
        <button className="new-version-reload" onClick={() => location.reload()}>
          새로고침
        </button>
      </div>
    );
  }
}
