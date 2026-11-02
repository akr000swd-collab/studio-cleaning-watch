// 環境変数からアプリの設定を読み込む

export type StudioConfig = {
  name: string; // スタジオ名。清掃カレンダーの予定タイトルに含まれる文字列と一致させる
  reservationCalendarId: string; // このスタジオの予約用Googleカレンダー ID
};

export type CleaningCalendarConfig = {
  staff: string; // 清掃担当者名(表示用)
  calendarId: string; // その担当者の清掃用GoogleカレンダーID
};

export type AppConfig = {
  studios: StudioConfig[];
  cleaningCalendars: CleaningCalendarConfig[];
  alertThresholdMinutes: number; // 次の予約開始までこの分数を切ったら警報(音)を鳴らす
  windowHoursBefore: number; // 現在時刻から何時間前まで予約を確認するか(期間未指定時)
  windowHoursAfter: number; // 現在時刻から何時間後まで予約を確認するか(期間未指定時)
  coverageBufferMinutes: number; // 清掃予定が前の利用終了より多少早く始まっていても許容する分数
  rangeLookbackDays: number; // 最初の利用より前の清掃予定を何日分遡って探すか(期間指定の有無によらず常に適用)
  rangeLookaheadDays: number; // 最後の利用より後の清掃予定を何日分先読みして探すか(期間指定の有無によらず常に適用)
  rokehanCalendarId: string | null; // ロケハン予定が入っているGoogleカレンダーID(未設定ならロケハン重複チェックは無効)
  rokehanLookaheadDays: number; // ロケハン予定を何日先まで監視して、利用予定との重複をチェックするか
};

function parseJsonEnv<T>(name: string, fallback: T): T {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`環境変数 ${name} のJSONが不正です: ${(e as Error).message}`);
  }
}

export function getConfig(): AppConfig {
  const studios = parseJsonEnv<StudioConfig[]>("STUDIOS_CONFIG", []);
  const cleaningCalendars = parseJsonEnv<CleaningCalendarConfig[]>(
    "CLEANING_CALENDARS_CONFIG",
    []
  );
  const alertThresholdMinutes = Number(
    process.env.ALERT_THRESHOLD_MINUTES ?? "60"
  );
  const windowHoursBefore = Number(process.env.WINDOW_HOURS_BEFORE ?? "48");
  const windowHoursAfter = Number(process.env.WINDOW_HOURS_AFTER ?? "48");
  const coverageBufferMinutes = Number(
    process.env.COVERAGE_BUFFER_MINUTES ?? "15"
  );
  const rangeLookbackDays = Number(process.env.RANGE_LOOKBACK_DAYS ?? "7");
  const rangeLookaheadDays = Number(process.env.RANGE_LOOKAHEAD_DAYS ?? "7");
  const rokehanCalendarId = process.env.ROKEHAN_CALENDAR_ID || null;
  const rokehanLookaheadDays = Number(
    process.env.ROKEHAN_LOOKAHEAD_DAYS ?? "14"
  );

  return {
    studios,
    cleaningCalendars,
    alertThresholdMinutes,
    windowHoursBefore,
    windowHoursAfter,
    coverageBufferMinutes,
    rangeLookbackDays,
    rangeLookaheadDays,
    rokehanCalendarId,
    rokehanLookaheadDays,
  };
}

export function getServiceAccountCredentials() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY が設定されていません"
    );
  }
  // Vercelの環境変数はUIで改行がそのまま貼れない場合があるため \n を実改行に変換する
  privateKey = privateKey.replace(/\\n/g, "\n");
  return { email, privateKey };
}
