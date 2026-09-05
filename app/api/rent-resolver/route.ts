import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 시설별 적용 임대료 결정 (2026-09-04 신설)
//
// 임대료 자료가 세 군데에 흩어져 있고 단위도 달랐다.
//   part3_rent_benchmark          원/㎡·월
//   part3_operating_benchmark     원/㎡·월 과 원/평·월이 섞임
//   market_property_observation   건물 단위 호가, 원/평·월
//
// 그래서 엔진은 part3_underwriting_default의 C01_OFFICE 한 줄(40,109원/㎡·월)만 쓰고
// 나머지 시설은 매출이 0으로 잡혔고, 서울 전체를 한 값으로 계산했다.
//
// DB에 part3_facility_rent_resolved 뷰를 만들어 전부 원/㎡·월로 통일했고,
// 이 라우트가 필지 위치에 맞는 값을 골라 근거와 함께 돌려준다.

export const dynamic = "force-dynamic";

type FloorRatioRow = {
  property_subtype: string;
  geography_name: string;
  floor_label: string;
  floor_order: number;
  ratio_pct: number;
};

type RetailRentRow = {
  property_subtype: string;
  geography_level: string;
  geography_code: string | null;
  geography_name: string;
  rent_per_sqm_month: number;
  base_date: string;
  report_name: string | null;
  methodology: string | null;
};

type ResolvedRentRow = {
  facility_code: string;
  geography_level: string;
  geography_name: string;
  rent_per_sqm_month: number;
  rent_kind: string;
  sample_count: number;
  base_date: string | null;
  source_name: string | null;
  confidence: number | null;
  origin_table: string;
};

/**
 * PNU 앞 5자리(시군구코드)로 오피스 서브마켓을 가른다.
 * 임대료가 서브마켓별로 40% 넘게 벌어지기 때문에 서울 전체 한 값으로 계산하면 안 된다.
 */
export function submarketFromPnu(pnu: string): string | null {
  if (!/^\d{5}/.test(pnu)) return null;
  const sigungu = pnu.slice(0, 5);
  if (["11110", "11140"].includes(sigungu)) return "CBD"; // 종로·중구
  if (["11680", "11650"].includes(sigungu)) return "GBD"; // 강남·서초
  if (["11560"].includes(sigungu)) return "YBD"; // 영등포
  if (sigungu.startsWith("11")) return "Others"; // 그 밖의 서울
  if (["41135"].includes(sigungu)) return "Pangyo"; // 성남 분당(판교)
  if (["41131", "41133"].includes(sigungu)) return "Bundang";
  return null;
}

/**
 * 서울 자치구를 한국부동산원 광역상권 4개 권역으로 묶는다.
 * 상권을 직접 고르지 않았을 때 쓰는 차선책이며, 실제 상권이 정해지면 그쪽이 우선한다.
 */
export function seoulRetailZoneFromPnu(pnu: string): string | null {
  if (!/^\d{5}/.test(pnu)) return null;
  const sigungu = pnu.slice(0, 5);
  if (["11110", "11140"].includes(sigungu)) return "서울 소계(도심지역)";
  if (["11680", "11650"].includes(sigungu)) return "서울 소계(강남지역)";
  if (["11560", "11440", "11410"].includes(sigungu)) return "서울 소계(영등포신촌지역)";
  if (sigungu.startsWith("11")) return "서울 소계(기타지역)";
  return null;
}

/** 시군구코드 앞 2자리로 시도명을 얻는다. 상권·광역상권이 없을 때의 최후 단계. */
export function sidoFromPnu(pnu: string): string | null {
  const map: Record<string, string> = {
    "11": "서울", "26": "부산", "27": "대구", "28": "인천", "29": "광주",
    "30": "대전", "31": "울산", "36": "세종", "41": "경기", "42": "강원",
    "43": "충북", "44": "충남", "45": "전북", "46": "전남", "47": "경북",
    "48": "경남", "50": "제주",
  };
  return map[pnu.slice(0, 2)] ?? null;
}

/**
 * 층별 효용비율로 1층 임대료를 건물 평균으로 환산한다.
 * 층별 면적이 같다고 본다 — 실제 설계가 나오면 층별 면적으로 다시 계산해야 한다.
 *
 * 공표 구간이 시설 유형마다 다르다. 중대형·집합상가는 지하1층~6층 이상까지 있지만
 * 소규모상가는 2층까지만 공표된다. 없는 층은 공표된 마지막 층 값을 그대로 쓰고
 * 그 사실을 note로 돌려준다 — 조용히 1층(100%)으로 되돌리면 매출이 과대계상된다.
 */
export function blendFloorRatio(
  ratios: FloorRatioRow[],
  aboveGroundFloors: number,
  basementFloors: number
): {
  ratio: number;
  detail: Array<{ floor: string; ratioPct: number; count: number }>;
  notes: string[];
} | null {
  if (!ratios.length || aboveGroundFloors <= 0) return null;

  const above = ratios
    .filter((row) => row.floor_order >= 1)
    .sort((a, b) => a.floor_order - b.floor_order);
  if (!above.length) return null;

  const topRow = above[above.length - 1];
  const notes: string[] = [];
  const detail: Array<{ floor: string; ratioPct: number; count: number }> = [];
  let weighted = 0;
  let floors = 0;

  const push = (row: FloorRatioRow, count: number) => {
    weighted += Number(row.ratio_pct) * count;
    floors += count;
    const existing = detail.find((item) => item.floor === row.floor_label);
    if (existing) existing.count += count;
    else detail.push({ floor: row.floor_label, ratioPct: Number(row.ratio_pct), count });
  };

  for (let floor = 1; floor <= aboveGroundFloors; floor += 1) {
    // 공표된 층 중 요청 층을 넘지 않는 가장 높은 층. '6층 이상' 구간도 이 규칙으로 잡힌다.
    let row = above[0];
    for (const candidate of above) {
      if (candidate.floor_order <= floor) row = candidate;
    }
    push(row, 1);
  }

  if (aboveGroundFloors > topRow.floor_order && topRow.floor_order < 6) {
    notes.push(
      `${topRow.floor_label}까지만 공표된 자료라 ${topRow.floor_order + 1}층 이상은 ${topRow.floor_label} 비율(${topRow.ratio_pct}%)을 그대로 적용했습니다.`
    );
  }

  const basementRow = ratios.find((row) => row.floor_order === -1) ?? null;
  if (basementFloors > 0) {
    if (basementRow) push(basementRow, basementFloors);
    else notes.push("지하층 효용비율이 공표되지 않아 지하 상가는 환산에서 제외했습니다.");
  }

  if (!floors) return null;
  return { ratio: weighted / floors / 100, detail, notes };
}

/** 실제로 받는 돈에 가까운 순서. 렌트프리를 반영한 실질임대료를 우선한다. */
const KIND_RANK: Record<string, number> = { EFFECTIVE: 3, ASKING: 2, NOMINAL: 1 };

function score(row: ResolvedRentRow, submarket: string | null) {
  let value = 0;
  if (submarket && row.geography_name === submarket) value += 1000;
  else if (row.geography_name === "SEOUL_TOTAL" || row.geography_level === "REGION") value += 500;
  value += (KIND_RANK[row.rent_kind] ?? 0) * 50;
  if (row.base_date) value += Number(row.base_date.slice(0, 4)) - 2000;
  value += Math.min(20, Math.log10(Math.max(1, row.sample_count)) * 10);
  return value;
}

const RETAIL_SUBTYPES = ["중대형상가", "소규모상가", "집합상가"];
const HOUSING_TYPES = ["아파트", "종합", "연립다세대", "단독주택"];

/**
 * PNU 앞 2자리 → 한국부동산원 주택가격동향 시도 지역코드.
 * 강원(42→51)·전북(45→52)은 특별자치도 전환으로 코드가 바뀌어 두 값을 모두 받는다.
 * 광주·전남은 이 조사에서 12002·12001로 매겨져 있어 PNU 코드와 다르다.
 */
const HOUSING_SIDO_CODE: Record<string, string> = {
  "11": "11000", "26": "26000", "27": "27000", "28": "28000", "29": "12002",
  "30": "30000", "31": "31000", "36": "36000", "41": "41000", "42": "51000",
  "43": "43000", "44": "44000", "45": "52000", "46": "12001", "47": "47000",
  "48": "48000", "50": "50000", "51": "51000", "52": "52000",
};

type DerivationRule = {
  facility_code: string;
  base_facility_code: string;
  ratio_pct: number;
  basis: string;
  decided_by: string | null;
};

type HousingRentRow = {
  geography_level: string;
  geography_name: string;
  geography_code: string;
  housing_type: string;
  stat_kind: string;
  conversion_rate_pct: number;
  rate_source_geography: string;
  rate_source_housing_type: string;
  rent_per_sqm_month_exclusive: number;
  rent_krw_unit_month: number;
  jeonse_price_per_sqm_krw: number;
  base_month: string;
  report_name: string | null;
  source_page: string | null;
};

/** '서울 공덕역'과 '공덕역'을 같은 상권으로 본다. */
function normalizeAreaName(name: string) {
  return name.replace(/^서울\s*/, "").replace(/\s+/g, "").toLowerCase();
}

function intParam(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

type RetailResolution = {
  subtype: string;
  firstFloorRentPerSqmMonth: number;
  blendedRentPerSqmMonth: number | null;
  geographyLevel: string;
  geographyName: string;
  matchLevel: string;
  matchBasis: string;
  baseDate: string;
  source: string | null;
  methodology: string | null;
  floors: { aboveGround: number; basement: number };
  floorRatio: {
    ratioPct: number;
    geography: string;
    detail: Array<{ floor: string; ratioPct: number; count: number }>;
    notes: string[];
  } | null;
  tradeAreaOptions: Array<{ code: string | null; name: string; rentPerSqmMonth: number }>;
  notes: string[];
};

/**
 * 리테일은 일반 랭킹으로 고르면 안 된다.
 * 한국부동산원 자료는 상권 단위이고 1층 기준이라, 명동(222,137원)과 상계역(30,178원)이
 * 같은 후보 목록에 들어간다. 필지 위치로 상권을 좁힌 뒤 층수로 환산해야 값이 의미를 갖는다.
 */
async function resolveRetail(
  url: string,
  options: { pnu: string; tradeArea: string | null; subtype: string; floors: number; basements: number }
): Promise<RetailResolution | null> {
  const { pnu, tradeArea, subtype, floors, basements } = options;

  const rentQuery = new URLSearchParams({
    select:
      "property_subtype,geography_level,geography_code,geography_name,rent_per_sqm_month,base_date,report_name,methodology",
    facility_code: "eq.C02_RETAIL",
    property_subtype: `eq.${subtype}`,
  });
  const ratioQuery = new URLSearchParams({
    select: "property_subtype,geography_name,floor_label,floor_order,ratio_pct",
    facility_code: "eq.C02_RETAIL",
    property_subtype: `eq.${subtype}`,
  });

  const [rentResponse, ratioResponse] = await Promise.all([
    fetch(`${url}/rest/v1/part3_rent_observation?${rentQuery.toString()}`, {
      cache: "no-store",
      headers: supabasePublicHeaders({ Accept: "application/json" }),
    }),
    fetch(`${url}/rest/v1/part3_floor_utility_ratio?${ratioQuery.toString()}`, {
      cache: "no-store",
      headers: supabasePublicHeaders({ Accept: "application/json" }),
    }),
  ]);

  if (!rentResponse.ok) return null;
  const rows = ((await rentResponse.json()) as RetailRentRow[]).filter((row) =>
    Number.isFinite(Number(row.rent_per_sqm_month))
  );
  if (!rows.length) return null;

  const zone = seoulRetailZoneFromPnu(pnu);
  const sido = sidoFromPnu(pnu);
  const notes: string[] = [];

  // 상권 → 광역상권 → 시도 → 전국. 위에서부터 맞는 것을 쓴다.
  let chosen: RetailRentRow | null = null;
  let matchBasis = "";

  if (tradeArea) {
    const wanted = normalizeAreaName(tradeArea);
    chosen =
      rows.find(
        (row) =>
          row.geography_level === "TRADE_AREA" &&
          (row.geography_code === tradeArea || normalizeAreaName(row.geography_name) === wanted)
      ) ?? null;
    if (chosen) matchBasis = "선택한 상권";
    else notes.push(`'${tradeArea}' 상권 자료가 없어 상위 권역 값으로 대체했습니다.`);
  }
  if (!chosen && zone) {
    chosen = rows.find((row) => row.geography_level === "SUBMARKET" && row.geography_name === zone) ?? null;
    if (chosen) matchBasis = "PNU 시군구코드 → 광역상권";
  }
  if (!chosen && sido) {
    chosen = rows.find((row) => row.geography_level === "SIDO" && row.geography_name === sido) ?? null;
    if (chosen) matchBasis = "PNU 시도코드";
  }
  if (!chosen) {
    chosen = rows.find((row) => row.geography_level === "NATION") ?? null;
    if (chosen) matchBasis = "전국 평균 (위치 매칭 실패)";
  }
  if (!chosen) return null;

  if (chosen.geography_level !== "TRADE_AREA") {
    notes.push(
      "상권 단위 값이 아니라 권역 평균입니다. 같은 권역 안에서도 상권별로 두 배 이상 벌어지므로 상권을 지정하면 정확해집니다."
    );
  }

  const firstFloorRent = Number(chosen.rent_per_sqm_month);

  let floorRatio: RetailResolution["floorRatio"] = null;
  let blended: number | null = null;
  if (ratioResponse.ok) {
    const ratioRows = (await ratioResponse.json()) as FloorRatioRow[];
    const preferred = sido === "서울" ? "서울" : "전국";
    const scoped = ratioRows.filter((row) => row.geography_name === preferred);
    const usable = scoped.length ? scoped : ratioRows.filter((row) => row.geography_name === "전국");
    const blend = blendFloorRatio(usable, floors, basements);
    if (blend) {
      floorRatio = {
        ratioPct: Math.round(blend.ratio * 1000) / 10,
        geography: usable[0]?.geography_name ?? preferred,
        detail: blend.detail,
        notes: blend.notes,
      };
      blended = Math.round(firstFloorRent * blend.ratio);
    }
  }
  if (blended === null) {
    notes.push("층별 효용비율을 적용하지 못해 1층 기준 임대료를 그대로 씁니다. 실제보다 높게 잡힙니다.");
  }

  const optionZone = zone;
  const tradeAreaOptions = rows
    .filter((row) => row.geography_level === "TRADE_AREA")
    .filter((row) => !optionZone || row.geography_name.startsWith("서울"))
    .sort((a, b) => a.geography_name.localeCompare(b.geography_name, "ko"))
    .map((row) => ({
      code: row.geography_code,
      name: row.geography_name,
      rentPerSqmMonth: Math.round(Number(row.rent_per_sqm_month)),
    }));

  return {
    subtype,
    firstFloorRentPerSqmMonth: Math.round(firstFloorRent),
    blendedRentPerSqmMonth: blended,
    geographyLevel: chosen.geography_level,
    geographyName: chosen.geography_name,
    matchLevel: chosen.geography_level,
    matchBasis,
    baseDate: chosen.base_date,
    source: chosen.report_name,
    methodology: chosen.methodology,
    floors: { aboveGround: floors, basement: basements },
    floorRatio,
    tradeAreaOptions,
    notes,
  };
}

type HousingResolution = {
  housingType: string;
  statKind: string;
  rentPerSqmMonthExclusive: number;
  rentKrwUnitMonth: number;
  geographyName: string;
  geographyCode: string;
  geographyLevel: string;
  matchBasis: string;
  conversionRatePct: number;
  rateSource: string;
  jeonsePerSqmKrw: number;
  baseMonth: string;
  report: string | null;
  sourcePage: string | null;
  areaBasis: string;
  notes: string[];
};

/**
 * 주거시설 임대료를 필지 위치에 맞춰 고른다.
 *
 * 임대료 수준값이 원 단위로 공표되지 않기 때문에 ㎡당 전세가격에 전월세전환율을 적용한다.
 *   임대료 = ㎡당 전세가격 × 전월세전환율 ÷ 12
 * 보고서가 정의한 전월세전환율 산식을 그대로 뒤집은 것이라 별도 가정이 들어가지 않는다.
 *
 * 결과는 전용면적 기준이다. GFA 환산은 엔진의 시설별 efficiency(C04_LIVING 0.70)가 이미
 * 맡고 있으므로 여기서 다시 곱하면 안 된다.
 */
async function resolveHousing(
  url: string,
  options: { pnu: string; housingType: string; statKind: string }
): Promise<HousingResolution | null> {
  const { pnu, housingType, statKind } = options;

  const query = new URLSearchParams({
    select:
      "geography_level,geography_name,geography_code,housing_type,stat_kind,conversion_rate_pct,rate_source_geography,rate_source_housing_type,rent_per_sqm_month_exclusive,rent_krw_unit_month,jeonse_price_per_sqm_krw,base_month,report_name,source_page",
    housing_type: `eq.${housingType}`,
    stat_kind: `eq.${statKind}`,
  });

  const response = await fetch(`${url}/rest/v1/part3_housing_rent_resolved?${query.toString()}`, {
    cache: "no-store",
    headers: supabasePublicHeaders({ Accept: "application/json" }),
  });
  if (!response.ok) return null;

  const rows = ((await response.json()) as HousingRentRow[]).filter((row) =>
    Number.isFinite(Number(row.rent_per_sqm_month_exclusive))
  );
  if (!rows.length) return null;

  const byCode = new Map(rows.map((row) => [row.geography_code, row]));
  const notes: string[] = [];
  let chosen: HousingRentRow | undefined;
  let matchBasis = "";

  // 시군구 → 시도 → 전국. 시군구가 있으면 그게 가장 정확하다(서초구와 노원구가 2배 넘게 벌어진다).
  const sigungu = pnu.slice(0, 5);
  if (/^\d{5}$/.test(sigungu) && byCode.has(sigungu)) {
    chosen = byCode.get(sigungu);
    matchBasis = "PNU 시군구코드";
  }
  if (!chosen) {
    const sidoCode = HOUSING_SIDO_CODE[pnu.slice(0, 2)];
    if (sidoCode && byCode.has(sidoCode)) {
      chosen = byCode.get(sidoCode);
      matchBasis = "PNU 시도코드 (시군구 자료 없음)";
      notes.push("이 시군구는 조사 대상에 없어 시도 평균을 적용했습니다.");
    }
  }
  if (!chosen && byCode.has("00000")) {
    chosen = byCode.get("00000");
    matchBasis = "전국 평균 (위치 매칭 실패)";
    notes.push("필지 위치를 지역에 연결하지 못해 전국 평균을 적용했습니다.");
  }
  if (!chosen) return null;

  if (chosen.rate_source_geography !== chosen.geography_name) {
    notes.push(
      `전월세전환율은 ${chosen.rate_source_geography} ${chosen.rate_source_housing_type} 값 ${chosen.conversion_rate_pct}%를 적용했습니다. 아파트 전환율은 전국·수도권·지방·서울 네 곳만 공표됩니다.`
    );
  }

  return {
    housingType: chosen.housing_type,
    statKind: chosen.stat_kind,
    rentPerSqmMonthExclusive: Math.round(Number(chosen.rent_per_sqm_month_exclusive)),
    rentKrwUnitMonth: Math.round(Number(chosen.rent_krw_unit_month)),
    geographyName: chosen.geography_name,
    geographyCode: chosen.geography_code,
    geographyLevel: chosen.geography_level,
    matchBasis,
    conversionRatePct: Number(chosen.conversion_rate_pct),
    rateSource: `${chosen.rate_source_geography} ${chosen.rate_source_housing_type}`,
    jeonsePerSqmKrw: Math.round(Number(chosen.jeonse_price_per_sqm_krw)),
    baseMonth: chosen.base_month,
    report: chosen.report_name,
    sourcePage: chosen.source_page,
    areaBasis: "전용면적",
    notes,
  };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pnu = params.get("pnu")?.trim() ?? "";
  const explicitSubmarket = params.get("submarket")?.trim() || null;
  const submarket = explicitSubmarket ?? (pnu ? submarketFromPnu(pnu) : null);

  const tradeArea = params.get("tradeArea")?.trim() || null;
  const requestedSubtype = params.get("retailSubtype")?.trim() || "";
  const retailSubtype = RETAIL_SUBTYPES.includes(requestedSubtype) ? requestedSubtype : "중대형상가";
  const retailFloors = intParam(params.get("retailFloors"), 1);
  const retailBasementFloors = intParam(params.get("retailBasementFloors"), 0);

  const requestedHousing = params.get("housingType")?.trim() || "";
  const housingType = HOUSING_TYPES.includes(requestedHousing) ? requestedHousing : "아파트";
  const housingStat = params.get("housingStat") === "MEDIAN" ? "MEDIAN" : "MEAN";

  try {
    const { url } = supabasePublicConfig();
    const query = new URLSearchParams({
      select:
        "facility_code,geography_level,geography_name,rent_per_sqm_month,rent_kind,sample_count,base_date,source_name,confidence,origin_table",
    });

    const response = await fetch(`${url}/rest/v1/part3_facility_rent_resolved?${query.toString()}`, {
      cache: "no-store",
      headers: supabasePublicHeaders({ Accept: "application/json" }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, code: "RENT_QUERY_FAILED", message: `임대료 자료 조회 실패 (${response.status})` },
        { status: 502 }
      );
    }

    const rows = (await response.json()) as ResolvedRentRow[];
    const byFacility = new Map<string, ResolvedRentRow[]>();
    for (const row of rows) {
      if (!Number.isFinite(row.rent_per_sqm_month)) continue;
      // 상권 단위 리테일 관측치는 아래 전용 경로에서 위치·층수로 고른다.
      // 일반 랭킹에 섞으면 필지와 무관한 상권(예: 명동)이 뽑힌다.
      if (row.facility_code === "C02_RETAIL" && row.origin_table === "part3_rent_observation") continue;
      const list = byFacility.get(row.facility_code) ?? [];
      list.push(row);
      byFacility.set(row.facility_code, list);
    }

    const facilities = [...byFacility.entries()].map(([facilityCode, list]) => {
      const ranked = [...list].sort((a, b) => score(b, submarket) - score(a, submarket));
      const chosen = ranked[0];
      return {
        facilityCode,
        rentPerSqmMonth: Math.round(chosen.rent_per_sqm_month),
        rentKind: chosen.rent_kind,
        geography: chosen.geography_name,
        sampleCount: chosen.sample_count,
        baseDate: chosen.base_date,
        source: chosen.source_name,
        originTable: chosen.origin_table,
        matchedSubmarket: submarket !== null && chosen.geography_name === submarket,
        alternatives: ranked.slice(1, 4).map((row) => ({
          rentPerSqmMonth: Math.round(row.rent_per_sqm_month),
          rentKind: row.rent_kind,
          geography: row.geography_name,
          baseDate: row.base_date,
          source: row.source_name,
        })),
      };
    });

    // 리테일: 위치로 상권을 좁히고 층별 효용비율로 건물 평균 임대료를 만든다.
    const retail = await resolveRetail(url, {
      pnu,
      tradeArea,
      subtype: retailSubtype,
      floors: retailFloors,
      basements: retailBasementFloors,
    });

    if (retail) {
      const applied = retail.blendedRentPerSqmMonth ?? retail.firstFloorRentPerSqmMonth;
      const existing = facilities.findIndex((item) => item.facilityCode === "C02_RETAIL");
      const entry = {
        facilityCode: "C02_RETAIL",
        rentPerSqmMonth: applied,
        rentKind: "NOMINAL",
        geography: retail.geographyName,
        sampleCount: 1,
        baseDate: retail.baseDate,
        source: retail.source,
        originTable: "part3_rent_observation",
        matchedSubmarket: retail.geographyLevel === "TRADE_AREA",
        alternatives: existing >= 0 ? facilities[existing].alternatives : [],
      };
      if (existing >= 0) facilities[existing] = entry;
      else facilities.push(entry);
    }

    // 주거: ㎡당 전세가격 × 전월세전환율로 만든 전용면적 기준 임대료.
    const housing = await resolveHousing(url, { pnu, housingType, statKind: housingStat });

    if (housing) {
      const existing = facilities.findIndex((item) => item.facilityCode === "C04_LIVING");
      const entry = {
        facilityCode: "C04_LIVING",
        rentPerSqmMonth: housing.rentPerSqmMonthExclusive,
        rentKind: "NOMINAL",
        geography: housing.geographyName,
        sampleCount: 1,
        baseDate: housing.baseMonth,
        source: housing.report,
        originTable: "part3_housing_rent_resolved",
        matchedSubmarket: housing.geographyLevel === "SIGUNGU",
        alternatives: existing >= 0 ? facilities[existing].alternatives : [],
      };
      if (existing >= 0) facilities[existing] = entry;
      else facilities.push(entry);
    }

    // 관측치가 없는 시설을 다른 시설에서 파생시킨다(part3_rent_derivation_rule).
    // 시장 자료가 아니라 내부 적용 기준이므로 rentKind를 DERIVED로 표시해 구분한다.
    const derivations: Array<{
      facilityCode: string;
      baseFacilityCode: string;
      ratioPct: number;
      rentPerSqmMonth: number;
      basis: string;
      decidedBy: string | null;
    }> = [];

    try {
      const ruleQuery = new URLSearchParams({
        select: "facility_code,base_facility_code,ratio_pct,basis,decided_by",
        is_active: "eq.true",
      });
      const ruleResponse = await fetch(`${url}/rest/v1/part3_rent_derivation_rule?${ruleQuery.toString()}`, {
        cache: "no-store",
        headers: supabasePublicHeaders({ Accept: "application/json" }),
      });
      if (ruleResponse.ok) {
        const rules = (await ruleResponse.json()) as DerivationRule[];
        for (const rule of rules) {
          if (facilities.some((item) => item.facilityCode === rule.facility_code)) continue;
          const base = facilities.find((item) => item.facilityCode === rule.base_facility_code);
          if (!base) continue;
          const ratio = Number(rule.ratio_pct);
          if (!Number.isFinite(ratio) || ratio <= 0) continue;

          const rent = Math.round(base.rentPerSqmMonth * ratio / 100);
          facilities.push({
            facilityCode: rule.facility_code,
            rentPerSqmMonth: rent,
            rentKind: "DERIVED",
            geography: base.geography,
            sampleCount: 0,
            baseDate: base.baseDate,
            source: `${rule.base_facility_code}의 ${ratio}% (인리얼티 내부 기준)`,
            originTable: "part3_rent_derivation_rule",
            matchedSubmarket: base.matchedSubmarket,
            alternatives: [],
          });
          derivations.push({
            facilityCode: rule.facility_code,
            baseFacilityCode: rule.base_facility_code,
            ratioPct: ratio,
            rentPerSqmMonth: rent,
            basis: rule.basis,
            decidedBy: rule.decided_by,
          });
        }
      }
    } catch {
      // 파생 규칙을 못 읽어도 관측치 기반 임대료는 그대로 내보낸다.
    }

    // 시설은 있는데 임대료 자료가 없는 것들. 매출이 0으로 잡히는 원인이라 명시한다.
    const covered = new Set(facilities.map((item) => item.facilityCode));
    const missing = [
      "C02_RETAIL",
      "C03_HOSPITALITY",
      "C04_LIVING",
      "C05_HEALTHCARE",
      "C06_EDUCATION",
      "C07_CULTURE_ENTERTAINMENT",
      "C08_RND_LAB",
      "C10_DIGITAL_INFRA",
    ].filter((code) => !covered.has(code));

    return NextResponse.json({
      ok: true,
      submarket,
      submarketBasis: explicitSubmarket ? "직접 지정" : pnu ? "PNU 시군구코드" : "미지정",
      retailZone: pnu ? seoulRetailZoneFromPnu(pnu) : null,
      sido: pnu ? sidoFromPnu(pnu) : null,
      facilities,
      retail,
      housing,
      derivations,
      missing,
      note:
        "원/평·월 자료는 3.305785로 나눠 원/㎡·월로 통일했습니다. 실질임대료(EFFECTIVE)가 있으면 호가(ASKING)보다 먼저 씁니다. 리테일은 한국부동산원 1층 기준 임대료에 층별 효용비율을 적용한 건물 평균값이고, 주거는 ㎡당 전세가격에 전월세전환율을 적용한 전용면적 기준 값입니다.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "RENT_RESOLVER_ERROR",
        message: error instanceof Error ? error.message : "임대료 결정 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
