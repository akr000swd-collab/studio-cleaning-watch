import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "スタジオ清掃監視ダッシュボード",
  description: "清掃なしで次の予約が始まりそうなスタジオを監視します",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
