import { calendar_v3, google } from "googleapis";
import {
  AppConfig,
  CleaningCalendarConfig,
  StudioConfig,
  getServiceAccountCredentials,
} from "./config";

export type Severity = "ok" | "warning" | "critical_soon" | "critical_active";

// 「清掃-使用-清掃-使用-清掃」の連鎖のうち、清掃が見つからなかった1箇所を表す
export type Issue = {
  kind: "before_first" | "between" | "after_last";
  severity: Severity;
  message: string;
  // between: 前の利用の終了時刻 / after_last: 最後の利用の終了時刻 / before_first: null
  fromTime: string | null;
  // between: 次の利用の開始時刻 / before_first: 最初の利用の開始時刻 / after_last: null
  toTime: string | null;
  minutesUntilDue: number | null;
};

export type StudioStatus = {
  studio: string;
  severity: Severity; // issues の中で最も重いもの。issuesが空なら ok
  issues: Issue[];
};

type CalEvent = {
  start: Date;
  end: Date;
  summary: string;
};

export type RangeParams = {
  from: Date;
  to: Date;
} | null;

function toEvent(raw: calendar_v3.Schema$Event): CalEvent | null {
  const startRaw = raw.start?.dateTime ?? raw.start?.date;
  const endRaw = raw.end?.dateTime ?? raw.end?.date;
  if (!startRaw || !endRaw) return null;
  // 終日予定(date のみ)は対象外にする
  if (!raw.start?.dateTime || !raw.end?.dateTime) return null;
  return {
    start: new Date(startRaw),
    end: new Date(endRaw),
    summary: String(raw.summary ?? ""),
  };
}

async function fetchEvents(
  calendarClient: calendar_v3.Calendar,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<CalEvent[]> {
  const events: CalEvent[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const res: { data: calendar_v3.Schema$Events } =
      await calendarClient.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
    for (const item of res.data.items ?? []) {
      const ev = toEvent(item);
      if (ev) events.push(ev);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return events;
}

function getCalendarClient() {
  const { email, privateKey } = getServiceAccountCredentials();
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  return google.calendar({ version: "v3", auth });
}

// 全角/半角表記のゆれ(＆ と & など)を吸収するための正規化
function normalizeText(s: string): string {
  return s.normalize("NFKC");
}

const STUDIO_SUFFIXES = ["スタジオ"];

// 清掃予定のタイトルと突き合わせる際に許容する、スタジオ名の言い換えパターンを作る
// 例: 「ゴシック&ロリータスタジオ」→ 「ゴシック&ロリータ」(末尾の「スタジオ」を省略した表記も許容する)
function studioNameVariants(studio: StudioConfig): string[] {
  const base = normalizeText(studio.name);
  const variants = new Set<string>([base]);
  for (const suffix of STUDIO_SUFFIXES) {
    if (base.endsWith(suffix) && base.length > suffix.length) {
      variants.add(base.slice(0, base.length - suffix.length));
    }
  }
  return Array.from(variants).filter((v) => v.length > 0);
}

// 清掃予定がこのスタジオ向けかどうかをタイトルで判定する
// (全角/半角のゆれ、「スタジオ」の省略表記を許容する)
function isCleaningForStudio(event: CalEvent, studio: StudioConfig): boolean {
  const summary = normalizeText(event.summary);
  return studioNameVariants(studio).some((variant) => summary.includes(variant));
}

// [rangeStart, rangeEnd] の間で終わる清掃予定が存在するか判定する
// (開始が rangeStart より多少早くてもよい = coverageBufferMinutes)
function hasCoveringCleaning(
  rangeStart: Date | null,
  rangeEnd: Date,
  cleaningEvents: CalEvent[],
  studio: StudioConfig,
  bufferMinutes: number
): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  return cleaningEvents.some((ev) => {
    if (!isCleaningForStudio(ev, studio)) return false;
    const finishesInTime = ev.end.getTime() <= rangeEnd.getTime() + 1000;
    if (!finishesInTime) return false;
    if (rangeStart === null) return true;
    return ev.start.getTime() >= rangeStart.getTime() - bufferMs;
  });
}

// 利用終了後、いつまでに清掃が「見つかっていればOK」とするかの探索範囲があるか判定する
// (after_last 用: 利用終了後に始まる清掃予定を探す。期限は特に設けず、探索窓の中にあるかだけを見る)
function hasCleaningAfter(
  afterTime: Date,
  searchEnd: Date,
  cleaningEvents: CalEvent[],
  studio: StudioConfig,
  bufferMinutes: number
): boolean {
  const bufferMs = bufferMinutes * 60 * 1000;
  return cleaningEvents.some((ev) => {
    if (!isCleaningForStudio(ev, studio)) return false;
    return (
      ev.start.getTime() >= afterTime.getTime() - bufferMs &&
      ev.start.getTime() <= searchEnd.getTime()
    );
  });
}

// 時間が重なっている予約を1つの利用としてまとめる。
// (開始時刻順に走査し、直前にまとめたブロックの終了時刻より前に次の予約が始まっていれば
//  同じ利用とみなして統合する。ぴったり連続しているだけ=重なりがない場合は統合しない)
function mergeOverlappingReservations(events: CalEvent[]): CalEvent[] {
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: CalEvent[] = [];
  for (const ev of sorted) {
    const last = merged[merged.length - 1];
    if (last && ev.start.getTime() < last.end.getTime()) {
      if (ev.end.getTime() > last.end.getTime()) {
        last.end = ev.end;
      }
    } else {
      merged.push({ ...ev });
    }
  }
  return merged;
}

function severityForDeadline(
  now: Date,
  deadline: Date,
  alertThresholdMinutes: number
): { severity: Severity; minutesUntilDue: number } {
  const minutesUntilDue = Math.round(
    (deadline.getTime() - now.getTime()) / 60000
  );
  let severity: Severity;
  if (minutesUntilDue <= 0) {
    severity = "critical_active";
  } else if (minutesUntilDue <= alertThresholdMinutes) {
    severity = "critical_soon";
  } else {
    severity = "warning";
  }
  return { severity, minutesUntilDue };
}

export async function computeStudioStatus(
  studio: StudioConfig,
  cleaningEvents: CalEvent[],
  reservationEvents: CalEvent[],
  now: Date,
  config: AppConfig,
  lookback: Date, // これより前は清掃を探さない(before_first用の下限)
  lookahead: Date // これより後は清掃を探さない(after_last用の上限)
): Promise<StudioStatus> {
  // 同じ利用が複数のシステム(自社予約システム、スペースマーケット、インスタベースなど)から
  // 別々の予定として登録され、時間が重なっているケースを1つの利用にまとめる。
  // (時間が重なっている予定だけを統合対象とし、単に隙間なく連続しているだけの
  //  別々の利用は統合しない=清掃なしの連続利用として引き続き検知する)
  const sorted = mergeOverlappingReservations(reservationEvents);

  const issues: Issue[] = [];

  if (sorted.length === 0) {
    return { studio: studio.name, severity: "ok", issues: [] };
  }

  // ① 最初の利用より前に清掃予定があるか
  const first = sorted[0];
  const coveredBefore = hasCoveringCleaning(
    lookback,
    first.start,
    cleaningEvents,
    studio,
    config.coverageBufferMinutes
  );
  if (!coveredBefore) {
    const { severity, minutesUntilDue } = severityForDeadline(
      now,
      first.start,
      config.alertThresholdMinutes
    );
    issues.push({
      kind: "before_first",
      severity,
      message:
        severity === "critical_active"
          ? "清掃予定がないまま最初の利用が始まっています"
          : severity === "critical_soon"
          ? `清掃予定がないまま、あと${minutesUntilDue}分で利用が始まります`
          : "利用開始までに清掃予定が入っていません",
      fromTime: null,
      toTime: first.start.toISOString(),
      minutesUntilDue,
    });
  }

  // ② 利用と利用の間(連続する予約のペアごと)
  for (let i = 0; i < sorted.length - 1; i++) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    const covered = hasCoveringCleaning(
      prev.end,
      next.start,
      cleaningEvents,
      studio,
      config.coverageBufferMinutes
    );
    if (covered) continue;

    // 利用がまだ続いている間は、開始から何時間経っていても表示し続ける。
    // 完全に終わった利用について、終了から1時間以上経っている過去のギャップだけを
    // 表示のノイズとみなして無視する。
    if (next.end.getTime() < now.getTime() - 60 * 60 * 1000) continue;

    const { severity, minutesUntilDue } = severityForDeadline(
      now,
      next.start,
      config.alertThresholdMinutes
    );
    issues.push({
      kind: "between",
      severity,
      message:
        severity === "critical_active"
          ? "清掃予定がないまま次の利用が始まっています"
          : severity === "critical_soon"
          ? `清掃予定がないまま、あと${minutesUntilDue}分で次の利用が始まります`
          : "次の利用までに清掃予定が入っていません",
      fromTime: prev.end.toISOString(),
      toTime: next.start.toISOString(),
      minutesUntilDue,
    });
  }

  // ③ 最後の利用の後に清掃予定があるか(次の予約がまだなくても必要)
  const last = sorted[sorted.length - 1];
  if (now.getTime() >= last.end.getTime()) {
    const coveredAfter = hasCleaningAfter(
      last.end,
      lookahead,
      cleaningEvents,
      studio,
      config.coverageBufferMinutes
    );
    if (!coveredAfter) {
      const minutesSinceEnd = Math.round(
        (now.getTime() - last.end.getTime()) / 60000
      );
      const severity: Severity =
        minutesSinceEnd <= config.alertThresholdMinutes
          ? "warning"
          : "critical_active";
      issues.push({
        kind: "after_last",
        severity,
        message:
          severity === "critical_active"
            ? "利用終了後、清掃予定が入らないまま時間が経っています"
            : "利用終了後の清掃予定がまだ入っていません",
        fromTime: last.end.toISOString(),
        toTime: null,
        minutesUntilDue: null,
      });
    }
  }

  const order: Record<Severity, number> = {
    ok: 0,
    warning: 1,
    critical_soon: 2,
    critical_active: 3,
  };
  const worst = issues.reduce<Severity>(
    (acc, issue) => (order[issue.severity] > order[acc] ? issue.severity : acc),
    "ok"
  );

  return { studio: studio.name, severity: worst, issues };
}

export async function getAllStudioStatuses(
  config: AppConfig,
  range: RangeParams
): Promise<StudioStatus[]> {
  if (config.studios.length === 0) {
    throw new Error(
      "STUDIOS_CONFIG が設定されていません。環境変数を確認してください。"
    );
  }
  const client = getCalendarClient();
  const now = new Date();

  // 予約を取得する範囲: 期間指定があればその期間そのもの、なければ現在時刻basis
  const reservationTimeMin = range
    ? range.from
    : new Date(now.getTime() - config.windowHoursBefore * 60 * 60 * 1000);
  const reservationTimeMax = range
    ? range.to
    : new Date(now.getTime() + config.windowHoursAfter * 60 * 60 * 1000);

  // 清掃を探す範囲: 利用予約を取得する範囲(reservationTimeMin/Max)そのものではなく、
  // 常に前後を rangeLookback/Lookahead 日分広げる。
  // (期間指定の有無にかかわらず、清掃予定だけは指定期間よりずっと前・後にあることがあるため)
  const lookback = new Date(
    reservationTimeMin.getTime() - config.rangeLookbackDays * 24 * 60 * 60 * 1000
  );
  const lookahead = new Date(
    reservationTimeMax.getTime() + config.rangeLookaheadDays * 24 * 60 * 60 * 1000
  );

  // 清掃カレンダーは全担当者分をまとめて先に取得しておく(スタジオ間で使い回す)
  const cleaningEventLists = await Promise.all(
    config.cleaningCalendars.map((c: CleaningCalendarConfig) =>
      fetchEvents(client, c.calendarId, lookback, lookahead)
    )
  );
  const allCleaningEvents = cleaningEventLists.flat();

  const statuses = await Promise.all(
    config.studios.map(async (studio) => {
      const reservationEvents = await fetchEvents(
        client,
        studio.reservationCalendarId,
        reservationTimeMin,
        reservationTimeMax
      );
      return computeStudioStatus(
        studio,
        allCleaningEvents,
        reservationEvents,
        now,
        config,
        lookback,
        lookahead
      );
    })
  );

  return statuses;
}
