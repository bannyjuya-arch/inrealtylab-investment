import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 2026-11-19: STEP 2 수요 기반 프로그램 도출 (특허 10-2026-0144458 청구항 3, 7, 8).
// Supabase derive_facility_program(p_pnu, p_lat, p_lon, p_ucode, p_max_gfa, p_project_key, p_radius_km)를 호출한다.
//   청구항 7: 용도지역 화이트리스트 → 허용 시설만 수요 계산(오피스, 상가, 숙박, 주거, 실버, 문화, 의원)
//   청구항 8: 반경 1.5km 지역 특성 지표(서울 평균 = 1.0)로 5개 테마 적합도 산정 → 1순위 테마의 수익, 공공시설 조합
//   청구항 3: 건축물 노후도(구조별 내용연수)로 개발 시급성 산정
// 모든 가정값은 잠정(verified=false)이며 demand_param_registry, demand_validation_latest에서 검증 상태를 함께 내려준다.

const ZONE_UCODE: Record<string, string> = {
  제1종전용주거지역: "UQA111",
  제2종전용주거지역: "UQA112",
  제1종일반주거지역: "UQA121",
  제2종일반주거지역: "UQA122",
  제3종일반주거지역: "UQA123",
  준주거지역: "UQA130",
  중심상업지역: "UQA210",
  일반상업지역: "UQA220",
  근린상업지역: "UQA230",
  유통상업지역: "UQA240",
  전용공업지역: "UQA310",
  일반공업지역: "UQA320",
  준공업지역: "UQA330",
  보전녹지지역: "UQA410",
  생산녹지지역: "UQA420",
  자연녹지지역: "UQA430",
  보전관리지역: "UQB110",
  생산관리지역: "UQB120",
  계획관리지역: "UQB130",
  농림지역: "UQB210",
  자연환경보전지역: "UQB220",
};

function zoneToUcode(zoneName: string | null): string | null {
  if (!zoneName) return null;
  const compact = zoneName.replace(/\s/g, "");
  if (ZONE_UCODE[compact]) return ZONE_UCODE[compact];
  const hit = Object.keys(ZONE_UCODE).find((name) => compact.includes(name));
  return hit ? ZONE_UCODE[hit] : null;
}

const num = (value: string | null) => {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

type Registry = { model: string; param_key: string; value: number | null; unit: string; verified: boolean; note: string | null };
type Validation = { model: string; check_code: string; scope: string | null; verdict: string | null; metric: unknown; suggestion: unknown; run_at: string };

async function restGet<T>(url: string, path: string): Promise<T | null> {
  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      cache: "no-store",
      headers: supabasePublicHeaders({ Accept: "application/json" }),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const pnu = params.get("pnu")?.trim() ?? "";
  const lat = num(params.get("lat"));
  const lon = num(params.get("lon"));
  const maxGfa = num(params.get("maxGfa"));
  const zoneName = params.get("zoneName")?.trim() || null;
  const ucode = params.get("ucode")?.trim() || zoneToUcode(zoneName);

  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json({ ok: false, message: "pnu(19자리)가 필요합니다." }, { status: 400 });
  }
  if (lat === null || lon === null) {
    return NextResponse.json({ ok: false, message: "부지 중심 좌표(lat, lon)가 필요합니다." }, { status: 400 });
  }
  if (!pnu.startsWith("11")) {
    return NextResponse.json({
      ok: false,
      message: "수요 기반 프로그램 도출은 현재 서울 소재 필지만 계산합니다.",
    });
  }

  const { url } = supabasePublicConfig();
  try {
    const response = await fetch(`${url}/rest/v1/rpc/derive_facility_program`, {
      method: "POST",
      cache: "no-store",
      headers: supabasePublicHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({
        p_pnu: pnu,
        p_lat: lat,
        p_lon: lon,
        p_ucode: ucode,
        p_max_gfa: maxGfa !== null && maxGfa > 0 ? Math.round(maxGfa) : null,
        // 주거 수요 API(project_key = pnu)와 결과가 섞이지 않도록 STEP 2 전용 키를 쓴다.
        p_project_key: `STEP2|${pnu}|${ucode ?? "NA"}`,
        p_radius_km: 1.5,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return NextResponse.json({ ok: false, message: `프로그램 도출 실패 (${response.status})`, detail }, { status: 502 });
    }
    const result = await response.json();

    const [registry, validation] = await Promise.all([
      restGet<Registry[]>(url, "demand_param_registry?select=model,param_key,value,unit,verified,note"),
      restGet<Validation[]>(url, "demand_validation_latest?select=model,check_code,scope,verdict,metric,suggestion,run_at"),
    ]);
    const unverified = (registry ?? []).filter((row) => !row.verified).length;

    return NextResponse.json({
      ok: true,
      zoneName,
      ucode,
      result,
      calibration: {
        paramCount: registry?.length ?? null,
        unverifiedCount: registry ? unverified : null,
        latestRunAt: validation?.[0]?.run_at ?? null,
        checks: (validation ?? []).filter((row) => row.check_code !== "RECENT_PROJECT_SIZE"),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "프로그램 도출 중 오류" },
      { status: 500 }
    );
  }
}
