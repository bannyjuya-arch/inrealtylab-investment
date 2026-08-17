import { NextRequest, NextResponse } from "next/server";
import {
  calculateFacilityPortfolio,
  type FacilityDemandInput,
  type FacilityStandard,
} from "@/lib/facility-demand";

type FacilityMasterRow = {
  facility_code: string;
  public_revenue_type: "P-NR" | "P-R" | null;
  category_name: string;
  sub_type: string | null;
};

type FacilityStandardRow = {
  facility_code: string;
  engine_type: "ACCESS" | "RATIO" | "AREA" | "CAPACITY";
  demand_variable: string | null;
  catchment_value: number | string | null;
  participation_rate: number | string | null;
  target_utilization: number | string | null;
  demand_per_unit: number | string | null;
  capacity_per_unit: number | string | null;
  area_per_capacity: number | string | null;
  net_efficiency: number | string | null;
};

type RequestBody = {
  inputs?: Record<string, FacilityDemandInput>;
};

function num(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function supabaseGet<T>(path: string, url: string, secret: string): Promise<T> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    cache: "no-store",
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Supabase REST error ${response.status}: ${detail}`);
  }

  return response.json() as Promise<T>;
}

export async function POST(req: NextRequest) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, code: "SUPABASE_CONFIG_MISSING", message: "SUPABASE_URL 또는 SUPABASE_SECRET_KEY가 없습니다." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as RequestBody;
  if (!body.inputs || !Object.keys(body.inputs).length) {
    return NextResponse.json(
      { ok: false, code: "DEMAND_INPUT_REQUIRED", message: "시설수요 계산용 inputs가 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const [masters, standards] = await Promise.all([
      supabaseGet<FacilityMasterRow[]>(
        "facility_master?select=facility_code,public_revenue_type,category_name,sub_type&facility_class=eq.PUBLIC&is_active=eq.true",
        url,
        secret
      ),
      supabaseGet<FacilityStandardRow[]>(
        "facility_standard?select=facility_code,engine_type,demand_variable,catchment_value,participation_rate,target_utilization,demand_per_unit,capacity_per_unit,area_per_capacity,net_efficiency&valid_to=is.null",
        url,
        secret
      ),
    ]);

    const masterMap = new Map(masters.map((row) => [row.facility_code, row]));
    const mapped: FacilityStandard[] = standards.flatMap((row) => {
      const master = masterMap.get(row.facility_code);
      if (!master?.public_revenue_type) return [];

      const demandPerUnit = num(row.demand_per_unit);
      return [{
        facilityId: row.facility_code,
        facilityName: master.category_name,
        facilityClass: master.public_revenue_type,
        sector: master.sub_type ?? master.category_name,
        calcMethod: row.engine_type,
        demandVariable: row.demand_variable ?? "unknown",
        accessMinutes: row.engine_type === "ACCESS" ? num(row.catchment_value) : undefined,
        participationRate: num(row.participation_rate),
        targetUtilization: num(row.target_utilization),
        demandPerUnit: row.engine_type === "RATIO" ? demandPerUnit : undefined,
        areaPerDemand: row.engine_type === "AREA" ? demandPerUnit : undefined,
        capacityPerUnit: num(row.capacity_per_unit),
        areaPerCapacity: num(row.area_per_capacity),
        netEfficiency: num(row.net_efficiency),
      } satisfies FacilityStandard];
    });

    if (!mapped.length) {
      return NextResponse.json(
        { ok: false, code: "NO_ACTIVE_FACILITY_STANDARDS", message: "활성 공공시설 기준값이 없습니다." },
        { status: 503 }
      );
    }

    const portfolio = calculateFacilityPortfolio(mapped, body.inputs);

    return NextResponse.json({
      ok: true,
      module: "PART3_DEMAND_TO_FACILITY_NEED",
      dataMode: "SUPABASE_STANDARD_REQUEST",
      standardsCount: mapped.length,
      ...portfolio,
    });
  } catch (error) {
    console.error("facility-demand error", error);
    return NextResponse.json(
      {
        ok: false,
        code: "FACILITY_DEMAND_ERROR",
        message: error instanceof Error ? error.message : "시설수요 계산 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
