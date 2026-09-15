import { NextRequest } from "next/server";

export const AUTH_COOKIE_NAME = "swc_pw";

// APP_PASSWORD が未設定の場合はパスワード保護なし(誰でもアクセス可)で動作する
export function isAuthEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function isAuthorized(req: NextRequest): boolean {
  if (!isAuthEnabled()) return true;
  const cookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  return cookie === process.env.APP_PASSWORD;
}
