import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  process.env.SUPABASE_URL?.trim() ||
  "https://igiltlrafwiszkhvtspb.supabase.co";

const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  "sb_publishable_Gy4GhKbuZU9vV3hEoPQ5Og_5P4_5_9e";

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
    const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/part3_commercial_cost_default?${query.toString()}`, {
      cache: "no-store",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: "application/json",
      },
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
