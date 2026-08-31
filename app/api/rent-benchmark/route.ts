import { NextRequest, NextResponse } from "next/server";
import { fetchPublicDataXml, publicDataServiceKey } from "../lib/public-data";

const SUPPORTED = ["C01_OFFICE", "C02_RETAIL", "C04_LIVING"] as const;
type FacilityCode = (typeof SUPPORTED)[number];

const SEOUL_SUPABASE_URL = "https://igiltlrafwiszkhvtspb.supabase.co";
const SEOUL_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Gy4GhKbuZU9vV3hEoPQ5Og_5P4_5_9e";

const LIVING_SOURCES = [
  {
    sourceCode: "RTMS_APT_RENT",
    sourceName: "국토교통부 아파트 전월세 실거래가",
    baseUrl: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent",
    path: "getRTMSDataSvcAptRent",
  },
  {
    sourceCode: "RTMS_RH_RENT",
    sourceName: "국토교통부 연립다세대 전월세 실거래가",
    baseUrl: "https://apis.data.go.kr/1613000/RTMSDataSvcRHRent",
    path: "getRTMSDataSvcRHRent",
  },
  {
    sourceCode: "RTMS_OFFI_RENT",
    sourceName: "국토교통부 오피스텔 전월세 실거래가",
    baseUrl: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent",
    path: "getRTMSDataSvcOffiRent",
  },
] as const;

function supabaseConfig() {
  return {
    url: (process.env.SUPABASE_URL || SEOUL_SUPABASE_URL).replace(/\/$/, ""),
    key:
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      SEOUL_SUPABASE_PUBLISHABLE_KEY,
  };
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function pick(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function readBenchmark(facilityCode: FacilityCode, lawdCd?: string) {
  const { url, key } = supabaseConfig();

  const query = new URLSearchParams({
    select: "facility_code,geography_type,geography_code,geography_name,submarket,rent_per_sqm_month,unit,source_kind,source_code,source_name,base_date,sample_count,methodology,confidence,raw_meta",
    facility_code: `eq.${facilityCode}`,
    order: "base_date.desc",
    limit: "50",
  });
  if (lawdCd && facilityCode === "C04_LIVING") query.set("geography_code", `eq.${lawdCd}`);

  const response = await fetch(`${url}/rest/v1/part3_rent_benchmark?${query.toString()}`, {
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`임대료 DB 조회 실패 ${response.status}: ${detail}`);
  }
  return response.json();
}

async function upsertLivingBenchmark(input: {
  lawdCd: string;
  dealYmd: string;
  rentPerSqmMonth: number;
  sampleCount: number;
  sourceBreakdown: Record<string, number>;
}) {
  const { url, key } = supabaseConfig();
  const baseDate = `${input.dealYmd.slice(0, 4)}-${input.dealYmd.slice(4, 6)}-01`;

  const response = await fetch(`${url}/rest/v1/rpc/part3_upsert_living_rent_benchmark`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_geography_code: input.lawdCd,
      p_base_date: baseDate,
      p_rent_per_sqm_month: input.rentPerSqmMonth,
      p_sample_count: input.sampleCount,
      p_source_breakdown: input.sourceBreakdown,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`리빙 임대료 DB 저장 실패 ${response.status}: ${detail}`);
  }
  return response.json();
}

async function refreshLiving(lawdCd: string, dealYmd: string) {
  const key = publicDataServiceKey();
  if (!key) throw new Error("DATA_GO_KR_API_KEY가 설정되지 않았습니다.");

  const unitRents: number[] = [];
  const sourceBreakdown: Record<string, number> = {};

  for (const source of LIVING_SOURCES) {
    const result = await fetchPublicDataXml(
      source.baseUrl,
      source.path,
      { LAWD_CD: lawdCd, DEAL_YMD: dealYmd, numOfRows: "999", pageNo: "1" },
      key
    );

    let accepted = 0;
    for (const row of result.rows) {
      const monthlyRent = parseNumber(pick(row, ["monthlyRent", "monthlyRentAmount", "월세금액"]));
      const area = parseNumber(pick(row, ["excluUseAr", "exclusiveArea", "area", "전용면적"]));
      if (monthlyRent === null || area === null || monthlyRent <= 0 || area <= 0) continue;

      // RTMS monthly rent is reported in 만원. Normalize to KRW/sqm/month.
      unitRents.push((monthlyRent * 10_000) / area);
      accepted += 1;
    }
    sourceBreakdown[source.sourceCode] = accepted;
  }

  const rentPerSqmMonth = median(unitRents);
  if (rentPerSqmMonth === null) {
    return { refreshed: false, reason: "NO_MONTHLY_RENT_SAMPLES", sampleCount: 0, sourceBreakdown };
  }

  await upsertLivingBenchmark({
    lawdCd,
    dealYmd,
    rentPerSqmMonth,
    sampleCount: unitRents.length,
    sourceBreakdown,
  });

  return { refreshed: true, rentPerSqmMonth, sampleCount: unitRents.length, sourceBreakdown };
}

export async function GET(request: NextRequest) {
  const facility = request.nextUrl.searchParams.get("facility")?.trim() as FacilityCode | undefined;
  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const dealYmd = request.nextUrl.searchParams.get("dealYmd")?.trim() ?? "";

  if (!facility || !SUPPORTED.includes(facility)) {
    return NextResponse.json({ ok: false, code: "UNSUPPORTED_FACILITY", message: "C01_OFFICE, C02_RETAIL, C04_LIVING 중 하나가 필요합니다." }, { status: 400 });
  }

  const lawdCd = /^\d{19}$/.test(pnu) ? pnu.slice(0, 5) : undefined;

  try {
    let refreshResult: unknown = null;
    if (facility === "C04_LIVING" && refresh) {
      if (!lawdCd) return NextResponse.json({ ok: false, code: "PNU_REQUIRED", message: "리빙 실거래 갱신에는 PNU가 필요합니다." }, { status: 400 });
      if (!/^\d{6}$/.test(dealYmd)) return NextResponse.json({ ok: false, code: "DEAL_YMD_REQUIRED", message: "리빙 실거래 갱신에는 YYYYMM 계약년월이 필요합니다." }, { status: 400 });
      refreshResult = await refreshLiving(lawdCd, dealYmd);
    }

    const rows = await readBenchmark(facility, lawdCd);
    return NextResponse.json({
      ok: true,
      facility,
      lawdCd: lawdCd ?? null,
      rows,
      latest: Array.isArray(rows) && rows.length ? rows[0] : null,
      refreshResult,
      note: facility === "C02_RETAIL" && (!Array.isArray(rows) || !rows.length)
        ? "R-ONE 상권 임대료 수집값이 아직 DB에 적재되지 않았습니다. R-ONE 수집기가 적재하면 동일 API에서 자동 노출됩니다."
        : null,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "RENT_BENCHMARK_ERROR",
      message: error instanceof Error ? error.message : "임대료 벤치마크 조회 중 오류가 발생했습니다.",
    }, { status: 502 });
  }
}
