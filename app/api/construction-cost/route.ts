import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

export async function GET(request: NextRequest) {
  const facilityCode = request.nextUrl.searchParams.get("facilityCode")?.trim() ?? "";
  const all = request.nextUrl.searchParams.get("all") === "1";

  const query = new URLSearchParams({
    select: "facility_code,category_code,category_name,default_cost_per_sqm,benchmark_count,latest_effective_date,source_codes,normalized_cost_basis",
    order: "category_code.asc",
  });

  if (facilityCode) query.set("facility_code", `eq.${facilityCode}`);
  else if (!all) {
    return NextResponse.json(
      { ok: false, code: "FACILITY_CODE_REQUIRED", message: "facilityCode 또는 all=1이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const { url } = supabasePublicConfig();
    const response = await fetch(`${url}/rest/v1/part3_commercial_cost_default?${query.toString()}`, {
      cache: "no-store",
      headers: supabasePublicHeaders({ Accept: "application/json" }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`Supabase REST error ${response.status}: ${detail}`);
    }

    const rows = (await response.json()) as Array<{
      facility_code: string;
      category_code: string;
      category_name: string;
      default_cost_per_sqm: number | string | null;
      benchmark_count: number | string | null;
      latest_effective_date: string | null;
      source_codes: string | null;
      normalized_cost_basis: string | null;
    }>;

    const normalized = rows.map((row) => ({
      facilityCode: row.facility_code,
      categoryCode: row.category_code,
      categoryName: row.category_name,
      defaultCostPerSqm: row.default_cost_per_sqm == null ? null : Number(row.default_cost_per_sqm),
      benchmarkCount: row.benchmark_count == null ? 0 : Number(row.benchmark_count),
      latestEffectiveDate: row.latest_effective_date,
      sourceCodes: row.source_codes,
      costBasis: row.normalized_cost_basis,
    }));

    return NextResponse.json({
      ok: true,
      costs: normalized,
      costUnit: "KRW_PER_SQM",
      vatBasis: "EXCLUDED",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "CONSTRUCTION_COST_LOOKUP_ERROR",
        message: error instanceof Error ? error.message : "공사비 조회 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
