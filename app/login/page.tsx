"use client";

import { useState, type FormEvent } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError("로그인에 실패했습니다: " + signInError.message);
        return;
      }
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect") || "/report";
      window.location.href = redirect;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 24, fontFamily: "Arial, 'Noto Sans KR', sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>INRealtyLab 관리자 로그인</h1>
      <p style={{ color: "#667585", fontSize: 13, marginBottom: 20 }}>
        내부 입력 도구·원가 데이터가 포함된 관리자 모드는 인리얼티 팀 계정으로만 접근할 수 있습니다.
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 700, color: "#374151" }}>
          <span>이메일</span>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ padding: 10, border: "1px solid #cfd6dd", borderRadius: 8, fontSize: 14 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 700, color: "#374151" }}>
          <span>비밀번호</span>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ padding: 10, border: "1px solid #cfd6dd", borderRadius: 8, fontSize: 14 }}
          />
        </label>
        {error && <div style={{ color: "#9f2626", fontSize: 13 }}>{error}</div>}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "#111827",
            color: "#fff",
            border: "none",
            fontWeight: 700,
            cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
    </main>
  );
}
