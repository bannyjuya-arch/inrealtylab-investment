"use client";

// 2026-08-26 확정: 관리자 모드(내부 입력 도구·DB 단가 노출)를 정식 로그인 기반으로
// 보호하기 위한 브라우저용 Supabase Auth 클라이언트. 서버 컴포넌트/미들웨어는 쓰지 않고
// 클라이언트에서 세션 유무만 확인해 UI를 토글하는 단순한 구조로 시작한다.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 설정되어 있지 않습니다."
    );
  }

  cachedClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cachedClient;
}
