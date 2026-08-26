"use client";

// 2026-08-26 확정: Part 2(소유·DB 원가 검토: OWNERSHIP GATE, COMMERCIAL PROGRAM,
// OPERATING RENT DB)는 전부 인리얼티 내부 전용 화면이므로, 관리자로 로그인하지 않은
// 사용자는 이 라우트에 들어와도 실제 내용을 전혀 볼 수 없도록 레이아웃 단계에서 막는다.

import { useEffect, useState, type ReactNode } from "react";
import ReportLauncher from "./ReportLauncher";
import CommercialAllocationTable from "./CommercialAllocationTable";
import RentBenchmarkPanel from "./RentBenchmarkPanel";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";

export default function ControlLayout({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      setAuthReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setIsAdmin(Boolean(data.session));
      setAuthReady(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(Boolean(session));
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  if (!authReady) return null;

  if (!isAdmin) {
    return (
      <main
        style={{
          maxWidth: 480,
          margin: "120px auto",
          padding: 24,
          textAlign: "center",
          fontFamily: "Arial, 'Noto Sans KR', sans-serif",
        }}
      >
        <h1 style={{ fontSize: 20, marginBottom: 10 }}>관리자 로그인이 필요합니다</h1>
        <p style={{ color: "#667585", fontSize: 14, marginBottom: 20 }}>
          Part 2 (소유 · DB 원가 검토) 화면은 인리얼티 내부 관리자만 볼 수 있습니다.
        </p>
        <a
          href={`/login?redirect=${encodeURIComponent("/control")}`}
          style={{
            display: "inline-block",
            padding: "10px 16px",
            borderRadius: 8,
            background: "#111827",
            color: "#fff",
            fontWeight: 700,
            textDecoration: "none",
          }}
        >
          관리자 로그인
        </a>
      </main>
    );
  }

  return (
    <>
      {children}
      <CommercialAllocationTable />
      <RentBenchmarkPanel />
      <ReportLauncher />
    </>
  );
}
