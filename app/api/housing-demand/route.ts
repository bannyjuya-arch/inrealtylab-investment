import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 2026-11-16: 주거(1인가구) 적정수요.
// Supabase compute_housing_demand(p_pnu, p_max_gfa, p_project_key, p_segment)를 호출한다.
// 잠재 수요 가구 = 본 자치구 1인가구 + 인접 자치구 1인가구 × 가중치 + 평일 주간 순유입인구 × 전환율
// 계획 세대 = 잠재 수요 가구 × 포착률(보수 / 중간 / 공격)
// 가정값은 모두 housing_demand_segment 표에 있고, 결과는 demand_result에 근거와 함께 저장된다.

type Row = {
  scenario: "CONSERVATIVE" | "BASE" | "AGGRESSIVE";
  scenario_name: string;
  gu_code: string;
  gu_name: string | null;
  base_date: string | null;
  own_households: number | string;
  adjacent_households: number | string;
  adjacent_weight_pct: number | string;
  daytime_net_inflow: number | string;
  inflow_conversion_pct: number | string;
  potential_demand_households: number | string;
  capture_pct: number | string;
  planned_units: number | string;
  demand_share_pct: number | string | null;
  demand_coverage_multiple: number | string | null;
  required_gfa_sqm: number | string;
  applied_gfa_sqm: number | string;
  ratio_of_max_pct: number | string | null;
  capped: boolean;
};

const n = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(req: NextRequest) {
  const pnu = req.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  const maxGfa = n(req.nextUrl.searchParams.get("maxGfa"));
  const segment = req.nextUrl.searchParams.get("segment")?.trim() || "SINGLE_1P";

  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json({ ok: false, message: "pnu(19자리)가 필요합니다." }, { status: 400 });
  }

  const { url } = supabasePublicConfig();
  try {
    const response = await fetch(`${url}/rest/v1/rpc/compute_housing_demand`, {
      method: "POST",
      cache: "no-store",
      headers: supabasePublicHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify({
        p_pnu: pnu,
        p_max_gfa: maxGfa !== null && maxGfa > 0 ? maxGfa : null,
        p_project_key: pnu,
        p_segment: segment,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return NextResponse.json({ ok: false, message: `수요 계산 실패 (${response.status})`, detail }, { status: 502 });
    }

    const rows = (await response.json()) as Row[];
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({
        ok: false,
        message: "이 부지가 속한 자치구의 1인가구 자료가 아직 없습니다. 현재는 서울 25개 자치구만 계산됩니다.",
      });
    }

    const first = rows[0];
    return NextResponse.json({
      ok: true,
      segment,
      basis: {
        guCode: first.gu_code,
        guName: first.gu_name,
        baseDate: first.base_date,
        ownHouseholds: n(first.own_households),
        adjacentHouseholds: n(first.adjacent_households),
        adjacentWeightPct: n(first.adjacent_weight_pct),
        daytimeNetInflow: n(first.daytime_net_inflow),
        inflowConversionPct: n(first.inflow_conversion_pct),
        potentialDemandHouseholds: n(first.potential_demand_households),
      },
      scenarios: rows.map((row) => ({
        code: row.scenario,
        name: row.scenario_name,
        capturePct: n(row.capture_pct),
        plannedUnits: n(row.planned_units),
        demandSharePct: n(row.demand_share_pct),
        demandCoverageMultiple: n(row.demand_coverage_multiple),
        requiredGfaSqm: n(row.required_gfa_sqm),
        appliedGfaSqm: n(row.applied_gfa_sqm),
        ratioOfMaxPct: n(row.ratio_of_max_pct),
        capped: Boolean(row.capped),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "수요 계산 중 오류" },
      { status: 500 }
    );
  }
}
