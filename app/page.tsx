"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Severity = "ok" | "warning" | "critical_soon" | "critical_active";

type Issue = {
  kind: "before_first" | "between" | "after_last";
  severity: Severity;
  message: string;
  fromTime: string | null;
  toTime: string | null;
  minutesUntilDue: number | null;
};

type StudioStatus = {
  studio: string;
  severity: Severity;
  issues: Issue[];
};

type ApiResponse = {
  generatedAt: string;
  range: { from: string; to: string } | null;
  statuses: StudioStatus[];
};

const POLL_MS = Number(process.env.NEXT_PUBLIC_POLL_INTERVAL_MS ?? "30000");

const SEVERITY_ORDER: Record<Severity, number> = {
  ok: 0,
  warning: 1,
  critical_soon: 2,
  critical_active: 3,
};

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "問題なし",
  warning: "清掃未予定",
  critical_soon: "まもなく開始",
  critical_active: "清掃なしで使用中",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  ok: "#16a34a",
  warning: "#ca8a04",
  critical_soon: "#dc2626",
  critical_active: "#991b1b",
};

function isAlarming(s: Severity) {
  return s === "warning" || s === "critical_soon" || s === "critical_active";
}

// ブラウザを更新しても毎回「音を有効にする」を押さずに済むように、
// 一度有効化したことを覚えておくためのキー
const SOUND_ENABLED_KEY = "swc_sound_enabled";

function formatTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayJstStr(offsetDays = 0) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 86400000);
  return jst.toISOString().slice(0, 10);
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  const rangeActive = Boolean(fromParam && toParam);

  const [fromInput, setFromInput] = useState(fromParam ?? todayJstStr());
  const [toInput, setToInput] = useState(toParam ?? todayJstStr(2));

  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [ackSignature, setAckSignature] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const originalTitle = useRef("スタジオ清掃監視ダッシュボード");

  const fetchStatus = useCallback(async () => {
    try {
      const qs = rangeActive
        ? `?from=${encodeURIComponent(fromParam!)}&to=${encodeURIComponent(toParam!)}`
        : "";
      const res = await fetch(`/api/status${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json: ApiResponse = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [rangeActive, fromParam, toParam]);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // 以前このブラウザで「音を有効にする」を押したことがあれば、
  // ページ読み込み時に自動で再有効化を試みる(ブラウザの自動再生制限により
  // 必ず成功するとは限らないが、成功すればボタンを押し直す必要がなくなる)
  useEffect(() => {
    let storedEnabled = false;
    try {
      storedEnabled = window.localStorage.getItem(SOUND_ENABLED_KEY) === "1";
    } catch {}
    if (!storedEnabled) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        setSoundEnabled(true);
      })
      .catch(() => {
        // ブラウザにブロックされた場合は、ボタンでの手動有効化に任せる
      });
  }, []);

  function applyRange() {
    const params = new URLSearchParams();
    params.set("from", fromInput);
    params.set("to", toInput);
    router.push(`/?${params.toString()}`);
  }

  function clearRange() {
    router.push("/");
  }

  const allIssues = (data?.statuses ?? []).flatMap((s) =>
    s.issues.map((issue) => ({ ...issue, studio: s.studio }))
  );
  const alarmingIssues = allIssues.filter((i) => isAlarming(i.severity));
  const currentSignature = alarmingIssues
    .map((i) => `${i.studio}:${i.kind}:${i.fromTime}:${i.toTime}`)
    .sort()
    .join("|");
  const isAlarmActive = alarmingIssues.length > 0;
  const isAcked = ackSignature !== null && ackSignature === currentSignature;

  useEffect(() => {
    if (currentSignature === "" && ackSignature !== null) {
      setAckSignature(null);
    }
  }, [currentSignature, ackSignature]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isAlarmActive && soundEnabled && !isAcked) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [isAlarmActive, soundEnabled, isAcked]);

  useEffect(() => {
    if (!isAlarmActive) {
      document.title = originalTitle.current;
      return;
    }
    let flip = false;
    const studiosInAlarm = Array.from(new Set(alarmingIssues.map((i) => i.studio)));
    const id = setInterval(() => {
      document.title = flip
        ? originalTitle.current
        : `⚠️ 警報 - ${studiosInAlarm.join(",")}`;
      flip = !flip;
    }, 1000);
    return () => {
      clearInterval(id);
      document.title = originalTitle.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAlarmActive, currentSignature]);

  const sortedStatuses = [...(data?.statuses ?? [])].sort(
    (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  );

  return (
    <div style={{ minHeight: "100vh", padding: "24px" }}>
      <audio ref={audioRef} src="/alarm.mp3" loop preload="auto" />

      {isAlarmActive && (
        <div
          style={{
            background: isAcked ? "#7c2d12" : "#991b1b",
            border: "2px solid #f87171",
            borderRadius: 12,
            padding: "16px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            animation: isAcked ? "none" : "pulse 1s infinite",
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              ⚠️ 清掃されないまま利用が始まりそうです
            </div>
            <div style={{ marginTop: 6, opacity: 0.9, display: "flex", flexDirection: "column", gap: 2 }}>
              {alarmingIssues.map((i, idx) => (
                <div key={idx}>
                  {i.studio}: {i.message}
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setAckSignature(currentSignature)}
            disabled={isAcked}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: isAcked ? "#475569" : "#f8fafc",
              color: isAcked ? "#cbd5e1" : "#111827",
              fontWeight: 700,
              cursor: isAcked ? "default" : "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {isAcked ? "確認済み" : "確認した(音を止める)"}
          </button>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>スタジオ清掃監視ダッシュボード</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {!soundEnabled && (
            <button
              onClick={() => {
                setSoundEnabled(true);
                try {
                  window.localStorage.setItem(SOUND_ENABLED_KEY, "1");
                } catch {}
                audioRef.current?.play().then(() => {
                  audioRef.current?.pause();
                  if (audioRef.current) audioRef.current.currentTime = 0;
                }).catch(() => {});
              }}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #334155",
                background: "#1e293b",
                color: "#f8fafc",
                cursor: "pointer",
              }}
            >
              🔊 音を有効にする
            </button>
          )}
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {data
              ? `最終更新: ${new Date(data.generatedAt).toLocaleTimeString("ja-JP")}`
              : "読み込み中..."}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "#1e293b",
          borderRadius: 12,
          padding: "14px 18px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 13, color: "#94a3b8" }}>監視期間:</span>
        <input
          type="date"
          value={fromInput}
          onChange={(e) => setFromInput(e.target.value)}
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#f8fafc",
            padding: "6px 8px",
            colorScheme: "dark",
          }}
        />
        <span style={{ color: "#94a3b8" }}>〜</span>
        <input
          type="date"
          value={toInput}
          onChange={(e) => setToInput(e.target.value)}
          style={{
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 6,
            color: "#f8fafc",
            padding: "6px 8px",
            colorScheme: "dark",
          }}
        />
        <button
          onClick={applyRange}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: "none",
            background: "#2563eb",
            color: "white",
            cursor: "pointer",
          }}
        >
          この期間を監視
        </button>
        {rangeActive && (
          <button
            onClick={clearRange}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "transparent",
              color: "#f8fafc",
              cursor: "pointer",
            }}
          >
            期間指定を解除(通常監視に戻す)
          </button>
        )}
        {rangeActive && (
          <span style={{ fontSize: 12, color: "#fbbf24" }}>
            現在 {fromParam} 〜 {toParam} の予約のみを監視中です
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            background: "#7c2d12",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          エラー: {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {sortedStatuses.map((s) => (
          <div
            key={s.studio}
            style={{
              background: "#1e293b",
              borderRadius: 12,
              padding: 18,
              borderLeft: `6px solid ${SEVERITY_COLOR[s.severity]}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>{s.studio}</div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: SEVERITY_COLOR[s.severity],
                }}
              >
                {SEVERITY_LABEL[s.severity]}
              </div>
            </div>
            {s.issues.length === 0 ? (
              <div style={{ marginTop: 10, fontSize: 14, color: "#cbd5e1" }}>
                問題なし
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {s.issues.map((issue, idx) => (
                  <div key={idx} style={{ fontSize: 13, color: "#cbd5e1", borderTop: idx > 0 ? "1px solid #334155" : "none", paddingTop: idx > 0 ? 8 : 0 }}>
                    <div>{issue.message}</div>
                    {issue.toTime && (
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        対象の利用開始: {formatTime(issue.toTime)}
                      </div>
                    )}
                    {!issue.toTime && issue.fromTime && (
                      <div style={{ fontSize: 12, color: "#94a3b8" }}>
                        利用終了: {formatTime(issue.fromTime)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {data && sortedStatuses.length === 0 && (
          <div style={{ color: "#94a3b8" }}>
            監視対象のスタジオが設定されていません(STUDIOS_CONFIG を確認してください)
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.75;
          }
        }
      `}</style>
    </div>
  );
}
