"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.replace(params.get("next") || "/");
      router.refresh();
    } else {
      setError("パスワードが違います");
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>スタジオ清掃監視</h1>
        <p>パスワードを入力してください</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <div className="login-error">{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? "確認中..." : "ログイン"}
        </button>
      </form>
      <style jsx>{`
        .login-wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0f172a;
          font-family: system-ui, sans-serif;
        }
        .login-card {
          background: #1e293b;
          padding: 32px;
          border-radius: 12px;
          width: 300px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        h1 {
          color: #f8fafc;
          font-size: 20px;
          margin: 0;
        }
        p {
          color: #94a3b8;
          margin: 0 0 8px 0;
          font-size: 14px;
        }
        input {
          padding: 10px;
          border-radius: 8px;
          border: 1px solid #334155;
          background: #0f172a;
          color: #f8fafc;
          font-size: 16px;
        }
        button {
          padding: 10px;
          border-radius: 8px;
          border: none;
          background: #2563eb;
          color: white;
          font-size: 15px;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.6;
        }
        .login-error {
          color: #f87171;
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}
