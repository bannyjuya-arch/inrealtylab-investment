import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 건물분 재산세 (2026-09-05 신설)
//
//   시가표준액(원/㎡) = 건물신축가격기준액 × 구조지수 × 용도지수 × 위치지수 × 잔가율
//   과세표준          = 시가표준액 × 공정시장가액비율(건축물 70%)
//   재산세            = 과세표준 × 세율(그 밖의 건축물 0.25%)
//
// 위치지수가 개별공시지가 구간으로 정해지는 게 핵심이다. 공시지가가 구간을 넘으면
// 건물은 그대로인데 시가표준액이 뛴다 — 매년 공시지가를 다시 봐야 하는 이유다.
//
// 종합부동산세는 계산하지 않는다. 과세대상이 주택과 토지뿐이라 일반 상업용 건축물은
// 대상이 아니고, 국공유지 사업은 토지가 공공 소유라 토지분 납세의무자도 아니다.

export const dynamic = "force-dynamic";

type IndexRow = {
  index_kind: string;
  index_code: string;
  index_name: string;
  index_value: number;
  notes: string | null;
};

type PriceRow = {
  base_year: number;
  use_code: string;
  use_name: string;
  price_per_sqm_krw: number;
  apply_from: string | null;
  apply_to: string | null;
};

type DepreciationRow = {
  structure_code: string;
  structure_name: string;
  useful_life_years: number | null;
  elapsed_years: number;
  residual_ratio_pct: number;
};

type TaxRuleRow = {
  rule_code: string;
  asset_class: string;
  value_pct: number | null;
  statute_ref: string | null;
};

/** 위치지수 구간 라벨에서 상한 금액을 뽑는다. "개별공시지가 1,000,000원 초과 1,200,000원 이하" → 1200000 */
function upperBoundFromLabel(label: string): number | null {
  const numbers = [...label.matchAll(/([\d,]+)\s*원/g)].map((m) => Number(m[1].replace(/,/g, "")));
  if (!numbers.length) return null;
  if (/초과\s*$/.test(label.trim())) return Number.POSITIVE_INFINITY;
  return numbers[numbers.length - 1];
}

/** 개별공시지가(원/㎡)로 위치지수를 고른다. 구간은 31단계다. */
export function pickLocationIndex(rows: IndexRow[], landPricePerSqm: number) {
  const candidates = rows
    .filter((row) => row.index_kind === "LOCATION")
    .map((row) => ({ row, upper: upperBoundFromLabel(row.index_name) }))
    .filter((item): item is { row: IndexRow; upper: number } => item.upper !== null)
    .sort((a, b) => a.upper - b.upper);

  for (const item of candidates) {
    if (landPricePerSqm <= item.upper) return item.row;
  }
  return candidates.length ? candidates[candidates.length - 1].row : null;
}

function num(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const landPricePerSqm = num(params.get("officialLandPricePerSqm"), 0);
  const baseYear = num(params.get("baseYear"), 2026);
  const useClass = params.get("useClass")?.trim() || "COMMERCIAL";
  // 기본값은 철근콘크리트조(4A). 국공유지 PPP 신축은 사실상 이 구조다.
  const structureCode = params.get("structureCode")?.trim() || "4A";
  const structureIndexCode = params.get("structureIndexCode")?.trim() || "4";
  const useIndexCode = params.get("useIndexCode")?.trim() || "";
  const elapsedYears = Math.max(0, num(params.get("elapsedYears"), 0));

  if (!(landPricePerSqm > 0)) {
    return NextResponse.json({
      ok: false,
      code: "LAND_PRICE_REQUIRED",
      message: "위치지수는 개별공시지가 구간으로 정해집니다. 공시지가가 없으면 재산세를 계산할 수 없습니다.",
    });
  }

  try {
    const { url } = supabasePublicConfig();
    const headers = supabasePublicHeaders({ Accept: "application/json" });

    const [indexResponse, priceResponse, depResponse, ruleResponse] = await Promise.all([
      fetch(
        `${url}/rest/v1/part3_building_index?select=index_kind,index_code,index_name,index_value,notes&base_year=eq.${baseYear}`,
        { cache: "no-store", headers }
      ),
      fetch(
        `${url}/rest/v1/part3_building_price_standard?select=base_year,use_code,use_name,price_per_sqm_krw,apply_from,apply_to&base_year=eq.${baseYear}`,
        { cache: "no-store", headers }
      ),
      fetch(
        `${url}/rest/v1/part3_building_depreciation?select=structure_code,structure_name,useful_life_years,elapsed_years,residual_ratio_pct&base_year=eq.${baseYear}&structure_code=eq.${encodeURIComponent(structureCode)}`,
        { cache: "no-store", headers }
      ),
      fetch(
        `${url}/rest/v1/part3_property_tax_rule?select=rule_code,asset_class,value_pct,statute_ref`,
        { cache: "no-store", headers }
      ),
    ]);

    if (!indexResponse.ok || !priceResponse.ok || !ruleResponse.ok) {
      return NextResponse.json(
        { ok: false, code: "TAX_QUERY_FAILED", message: "재산세 기준자료 조회에 실패했습니다." },
        { status: 502 }
      );
    }

    const indexRows = (await indexResponse.json()) as IndexRow[];
    const priceRows = (await priceResponse.json()) as PriceRow[];
    const depRows = depResponse.ok ? ((await depResponse.json()) as DepreciationRow[]) : [];
    const ruleRows = (await ruleResponse.json()) as TaxRuleRow[];

    const price = priceRows.find((row) => row.use_code === useClass) ?? null;
    const structure =
      indexRows.find((row) => row.index_kind === "STRUCTURE" && row.index_code === structureIndexCode) ?? null;
    const location = pickLocationIndex(indexRows, landPricePerSqm);

    const useRows = indexRows.filter(
      (row) => row.index_kind === "USE" && (row.notes ?? "") === useClass
    );
    // 용도번호를 지정하지 않으면 해당 대분류의 중앙값 지수를 쓰고 그 사실을 알린다.
    const sortedUse = [...useRows].sort((a, b) => a.index_value - b.index_value);
    const explicitUse = useIndexCode
      ? useRows.find((row) => row.index_code === `${useClass}:${useIndexCode}`) ?? null
      : null;
    const use = explicitUse ?? (sortedUse.length ? sortedUse[Math.floor(sortedUse.length / 2)] : null);

    const missing: string[] = [];
    if (!price) missing.push(`${baseYear}년 ${useClass} 건물신축가격기준액`);
    if (!structure) missing.push(`구조지수 ${structureIndexCode}`);
    if (!location) missing.push("위치지수");
    if (!use) missing.push(`${useClass} 용도지수`);

    if (!price || !structure || !location || !use) {
      return NextResponse.json({
        ok: false,
        code: "TAX_BASIS_MISSING",
        message: `재산세 계산에 필요한 기준값이 없습니다: ${missing.join(", ")}`,
        missing,
      });
    }

    const dep = depRows.find((row) => row.elapsed_years === elapsedYears)
      ?? depRows.sort((a, b) => b.elapsed_years - a.elapsed_years)[0]
      ?? null;
    const residualPct = dep ? Number(dep.residual_ratio_pct) : 100;

    // 지수는 100 기준 정수로 저장돼 있다.
    const rawPerSqm =
      Number(price.price_per_sqm_krw) *
      (Number(structure.index_value) / 100) *
      (Number(use.index_value) / 100) *
      (Number(location.index_value) / 100) *
      (residualPct / 100);

    // ㎡당 금액은 1,000원 미만을 버린다. 다만 1,000원 미만이면 1,000원으로 한다.
    const standardValuePerSqm = Math.max(1000, Math.floor(rawPerSqm / 1000) * 1000);

    const fairMarketRatio =
      ruleRows.find((row) => row.rule_code === "FAIR_MARKET_RATIO" && row.asset_class === "LAND_AND_BUILDING")
        ?.value_pct ?? null;
    const taxRate =
      ruleRows.find((row) => row.rule_code === "TAX_RATE" && row.asset_class === "BUILDING_GENERAL")?.value_pct ??
      null;

    if (fairMarketRatio === null || taxRate === null) {
      return NextResponse.json({
        ok: false,
        code: "TAX_RULE_MISSING",
        message: "재산세 세율 또는 공정시장가액비율이 DB에 없습니다.",
      });
    }

    const taxBasePerSqm = standardValuePerSqm * (Number(fairMarketRatio) / 100);
    const taxPerSqmYear = taxBasePerSqm * (Number(taxRate) / 100);

    return NextResponse.json({
      ok: true,
      baseYear,
      inputs: {
        officialLandPricePerSqm: landPricePerSqm,
        useClass,
        useName: price.use_name,
        structureCode,
        elapsedYears,
      },
      basis: {
        newBuildPricePerSqm: Number(price.price_per_sqm_krw),
        structureIndex: Number(structure.index_value),
        structureName: structure.index_name,
        useIndex: Number(use.index_value),
        useName: use.index_name,
        useIndexAssumed: !explicitUse,
        locationIndex: Number(location.index_value),
        locationBand: location.index_name,
        residualRatioPct: residualPct,
        fairMarketRatioPct: Number(fairMarketRatio),
        taxRatePct: Number(taxRate),
        applyFrom: price.apply_from,
        applyTo: price.apply_to,
      },
      standardValuePerSqm,
      taxBasePerSqm: Math.round(taxBasePerSqm),
      taxPerSqmYear: Math.round(taxPerSqmYear),
      formula:
        `${Number(price.price_per_sqm_krw).toLocaleString()} × 구조 ${structure.index_value}% × 용도 ${use.index_value}%` +
        ` × 위치 ${location.index_value}% × 잔가율 ${residualPct}% = ${standardValuePerSqm.toLocaleString()}원/㎡` +
        ` → × 공정시장가액비율 ${fairMarketRatio}% × 세율 ${taxRate}% = ${Math.round(taxPerSqmYear).toLocaleString()}원/㎡·년`,
      notes: [
        !explicitUse
          ? `용도번호를 지정하지 않아 ${price.use_name} 용도지수의 중앙값(${use.index_value})을 적용했습니다. 시설 용도가 확정되면 값이 달라집니다.`
          : null,
        "지방자치단체장은 조례로 표준세율을 ±50% 범위에서 가감할 수 있습니다(지방세법 §111③). 사업지 조례 확인이 필요합니다.",
        "종합부동산세는 과세대상이 주택과 토지로 한정되어 일반 상업용 건축물에는 부과되지 않습니다.",
      ].filter((item): item is string => item !== null),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "PROPERTY_TAX_ERROR",
        message: error instanceof Error ? error.message : "재산세 계산 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
