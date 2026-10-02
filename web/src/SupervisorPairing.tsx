import { useCallback, useEffect, useState } from "react";
import { apiSupervisorVerdict, makeSupervisorSecret, supervisorHash, supervisorSecret } from "./api.ts";

// SUPERVISOR 자격 짝짓기(ATC-373, server/supervisor-auth.ts). 이 화면의 쓰기(승인·MERGE·모드·LAUNCH·설정 …)는 이 기기만 가진 비밀이 있어야 서버가 받는다.
// 비밀은 이 브라우저의 localStorage에만 있다. 서버에는 해시만 간다: 호스트에서 root로 해시를 한 번 등록한다(에이전트는 root가 아니라 이 파일을 쓰지 못한다).
const POLL_MS = 15_000;

export function useSupervisorAuth() {
  const [verdict, setVerdict] = useState<string | null>(null);
  const load = useCallback(async () => setVerdict(await apiSupervisorVerdict()), []);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  return { verdict, reload: load };
}

const commandOf = (hash: string) => `sudo install -d /etc/atc && echo ${hash} | sudo tee -a /etc/atc/supervisor.sha256`;

export function SupervisorPairing({ auth }: { auth: ReturnType<typeof useSupervisorAuth> }) {
  const { verdict, reload } = auth;
  const [command, setCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const pair = useCallback(async () => {
    const secret = supervisorSecret() ?? makeSupervisorSecret();
    setCommand(commandOf(await supervisorHash(secret)));
    setCopied(false);
  }, []);

  // 알림 영역은 늘 두고 안만 바꾼다. 서버에 닿지 못하거나 이미 맞으면 아무것도 보이지 않는다
  const bad = verdict === "unpaired" || verdict === "invalid" || verdict === "missing" || verdict === "insecure";
  const text =
    verdict === "insecure"
      ? "SUPERVISOR 자격 파일을 믿을 수 없음 — root 소유가 아니거나 쓰기 권한이 넓음. 이 화면의 쓰기가 거절됩니다"
      : verdict === "unpaired"
        ? "SUPERVISOR 자격이 등록되지 않음 — 이 화면의 쓰기가 거절됩니다"
        : "이 기기의 SUPERVISOR 자격이 서버에 없음 — 쓰기가 거절됩니다";

  return (
    <div className="update-wrap" role="status">
      {bad && (
        <div className="update-bar" data-kind="failed">
          <div className="update-row">
            <span className="update-text">
              <i aria-hidden />
              {text}
            </span>
            {verdict !== "insecure" && (
              <button className="update-go" onClick={() => void pair()}>
                {command ? "다시 만들기" : "자격 만들기"}
              </button>
            )}
            {command && (
              <button className="update-go" onClick={() => void reload()}>
                등록했음, 확인
              </button>
            )}
          </div>
          {command && (
            <div>
              <p className="update-why">호스트에서 한 번 실행한다(해시만 담긴다. 비밀은 이 브라우저에 남는다):</p>
              <code className="update-cmd">{command}</code>
              <button
                className="update-pr"
                onClick={() => {
                  void navigator.clipboard?.writeText(command).then(() => setCopied(true), () => undefined);
                }}
              >
                {copied ? "복사됨" : "명령 복사"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
