import { NextRequest, NextResponse } from "next/server";
import { RangeParams, getAllStudioStatuses } from "@/lib/calendar";
import { getConfig } from "@/lib/config";
import { isAuthorized } from "@/lib/auth";

export const dynamic = "force-dynamic"; // 常に最新のカレンダー状態を取得する

// "2026-09-01" のような日付文字列を、日本時間の 00:00:00 として解釈する
function parseJstDateStart(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00+09:00`);
}

// "2026-09-07" のような日付文字列を、日本時間のその日の 23:59:59 として解釈する
function parseJstDateEnd(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59+09:00`);
}

function parseRange(req: NextRequest): RangeParams {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (!from || !to) return null;

  const fromDate = parseJstDateStart(from);
  const toDate = parseJstDateEnd(to);
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error("from / to の日付形式が不正です(YYYY-MM-DD で指定してください)");
  }
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error("from は to より前の日付にしてください");
  }
  return { from: fromDate, to: toDate };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const config = getConfig();
    const range = parseRange(req);
    const { statuses, rokehanCards, rokehanDebug } = await getAllStudioStatuses(
      config,
      range
    );
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      range: range
        ? { from: range.from.toISOString(), to: range.to.toISOString() }
        : null,
      statuses,
      rokehanCards,
      // ロケハン予定の検知状況を確認するための一時的な診断情報(原因が分かったら削除予定)
      rokehanDebug,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 }
    );
  }
}
