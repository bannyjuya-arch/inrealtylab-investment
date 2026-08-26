"use client";

// 2026-08-26 확정 (1차 수정): 처음엔 /control 전체를 로그인 게이트로 막았는데,
// 이러면 로그인 안 한 일반 사용자가 대지 선택 이후(Part 2 소유판정 → Part 3 보고서)로
// 아예 진행을 못 하게 되는 문제가 있었다. 그래서 방식을 바꾼다:
//  - 소유판정 결과(children: OWNERSHIP GATE, PARCEL OWNERSHIP, PROJECT DIRECTION 등)와
//    Part 3로 넘어가는 ReportLauncher는 그대로 누구나 볼 수 있게 둔다 (정상적인 진행 흐름).
//  - COMMERCIAL PROGRAM(공사비 단가 직접 조정)과 OPERATING RENT DB(임대료 DB 원본)만
//    "우리 DB 단가·기준" 내부 데이터이므로, 관리자로 로그인했을 때만 보이게 감싼다.

import { useEffect, useState, type ReactNode } from "react";
import ReportLauncher from "./ReportLauncher";
import CommercialAllocationTable from "./CommercialAllocationTable";
import RentBenchmarkPanel from "./RentBenchmarkPanel";
import { getSupabaseBrowserClient } from "../../lib/supabase-browser";

export default function ControlLayout({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setIsAdmin(Boolean(data.session));
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdmin(Boolean(session));
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    try {
      await getSupabaseBrowserClient().auth.signOut();
    } catch {
      // ignore
    }
  }

  return (
    <div className={isAdmin ? "control-page-root is-admin" : "control-page-root"}>
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          display: "flex",
          justifyContent: "flex-end",
          padding: "14px 28px 0",
        }}
      >
        {isAdmin ? (
          <button
            type="button"
            onClick={handleLogout}
            style={{
              border: "1px solid #d0d5dd",
              background: "#fff",
              color: "#344054",
              borderRadius: 10,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            로그아웃 (관리자 모드)
          </button>
        ) : (
          <a
            href="/login?redirect=%2Fcontrol"
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "1px solid #d0d5dd",
              background: "#fff",
              color: "#344054",
              borderRadius: 10,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 800,
              textDecoration: "none",
            }}
          >
            관리자 로그인
          </a>
        )}
      </div>

      {children}

      <div className="admin-only">
        <CommercialAllocationTable />
        <RentBenchmarkPanel />
      </div>

      <ReportLauncher />
    </div>
  );
}
