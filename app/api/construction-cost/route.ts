import { NextRequest, NextResponse } from "next/server";

const OFFICE_FACILITY_KEY = "OFFICE";
const OFFICE_DB_CODE = "C01_OFFICE";

export async function GET(request: NextRequest) {
  const facilityKey = request.nextUrl.searchParams.get("facilityKey")?.trim() ?? "";

  if (!facilityKey) {
    return NextResponse.json(
      { ok: false, code: "FACILITY_KEY_REQUIRED", message: "사업시설 선택값이 필요합니다." },
      { status: 400 }
    );
  }

  // Current sample rule: only OFFICE has a connected construction-cost benchmark.
  // Other facility types intentionally return null until their DB mapping is approved.
  if (facilityKey !== OFFICE_FACILITY_KEY) {
    return NextResponse.json({
      ok: true,
      facilityKey,
      facilityCode: null,
      costPerSqm: null,
      costLow: null,
      costMid: null,
      costHigh: null,
      effectiveDate: null,
      sourceCode: null,
      costBasis: null,
      status: "NO_CONNECTED_COST_DATA",
    });
  }

  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, code: "SUPABASE_CONFIG_MISSING", message: "공사비 DB 연결 설정이 없습니다." },
      { status: 503 }
    );
  }

  const query = new URLSearchParams({
    select: "facility_code,facility_name,facility_subtype,building_type,effective_date,cost_low,cost_mid,cost_high,cost_unit,cost_basis,source_code,confidence",
    facility_code: `eq.${OFFICE_DB_CODE}`,
    facility_subtype: "eq.DEFAULT",
    limit: "1",
  });

  try {
    const response = await fetch(`${url}/rest/v1/part3_construction_cost_ready?${query.toString()}`, {
      cache: "no-store",
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      throw new Error(`Supabase REST error ${response.status}: ${detail}`);
    }

    const rows = (await response.json()) as Array<{
      facility_code: string;
      facility_name: string | null;
      facility_subtype: string | null;
      building_type: string | null;
      effective_date: string | null;
      cost_low: number | string | null;
      cost_mid: number | string | null;
      cost_high: number | string | null;
      cost_unit: string | null;
      cost_basis: string | null;
      source_code: string | null;
      confidence: number | string | null;
    }>;

    const row = rows[0];
    if (!row) {
      return NextResponse.json({
        ok: true,
        facilityKey,
        facilityCode: OFFICE_DB_CODE,
        costPerSqm: null,
        costLow: null,
        costMid: null,
        costHigh: null,
        effectiveDate: null,
        sourceCode: null,
        costBasis: null,
        status: "OFFICE_COST_NOT_FOUND",
      });
    }

    const toNumber = (value: number | string | null) => {
      if (value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    return NextResponse.json({
      ok: true,
      facilityKey,
      facilityCode: row.facility_code,
      facilitySubtype: row.facility_subtype,
      buildingType: row.building_type,
      costPerSqm: toNumber(row.cost_mid),
      costLow: toNumber(row.cost_low),
      costMid: toNumber(row.cost_mid),
      costHigh: toNumber(row.cost_high),
      costUnit: row.cost_unit,
      effectiveDate: row.effective_date,
      sourceCode: row.source_code,
      costBasis: row.cost_basis,
      confidence: toNumber(row.confidence),
      status: "CONNECTED",
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
