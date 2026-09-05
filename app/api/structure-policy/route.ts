import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 사업구조 정책 (2026-09-04 신설)
//
// STEP 2에서 고른 사업방식(BTO/BOT·대부사용허가·신탁)과 사업주체(SPC·개발리츠·신탁사)를
// part3_business_structure_policy의 structure_code로 변환해 정책을 돌려준다.
//
// 지금까지 STEP 3은 STEP 2의 선택과 무관하게 BTO/BOT 매트릭스와 REITs 매트릭스를
// 항상 나란히 보여줬다. 고른 구조에 따라 잔존가 처리(ZERO / EXIT_VALUE)와 DSCR 기준이
// 달라지는데 그게 판정에 반영되지 않았다.

export const dynamic = "force-dynamic";

type StructurePolicyRow = {
  structure_code: string;
  structure_name: string;
  structure_group: string;
  terminal_value_policy: string;
  uses_exit_cap_rate: boolean;
  default_terminal_value_krw: number | null;
  dscr_required: boolean;
  default_dscr_min: number | null;
  depreciation_basis: string | null;
  property_tax_applies: boolean | null;
  ownership_during_operation: string | null;
  notes: string | null;
};

/**
 * STEP 2의 두 축(사업방식 · 사업주체)을 하나의 structure_code로 정리한다.
 * 사업주체가 리츠·신탁이면 그쪽이 구조를 결정하고, 그 밖에는 토지 권원이 결정한다.
 */
export function resolveStructureCode(input: {
  landRight?: string | null;
  concessionType?: string | null;
  vehicle?: string | null;
}): { code: string; reason: string } {
  const { landRight, concessionType, vehicle } = input;

  if (vehicle === "TRUSTEE" || landRight === "TRUST") {
    return { code: "TRUST_DEVELOPMENT", reason: "신탁·위탁개발 — 수탁자가 시행 주체" };
  }
  if (vehicle === "PROJECT_REIT") {
    return { code: "PROJECT_REIT", reason: "개발리츠 — 리츠 Vehicle 안에서 개발·운영" };
  }
  if (landRight === "CONCESSION") {
    return concessionType === "BOT"
      ? { code: "BOT", reason: "민간투자 BOT — 운영기간 중 민간이 시설 소유" }
      : { code: "BTO", reason: "민간투자 BTO — 준공 즉시 소유권 공공 귀속" };
  }
  if (landRight === "LEASE_PERMIT") {
    return { code: "LEASE_PERMIT", reason: "대부·사용허가 — 토지는 공공, 건축물은 민간 소유" };
  }
  if (landRight === "MIXED") {
    return {
      code: "BTO",
      reason: "혼합형 — 동·층별로 방식이 갈리므로 우선 BTO 기준으로 계산합니다. 실제로는 구역별 분리 계산이 필요합니다.",
    };
  }
  return { code: "BTO", reason: "사업방식이 선택되지 않아 BTO 기준으로 계산합니다." };
}

type TrustFeeRow = {
  trust_type: string;
  trust_type_name: string;
  fee_component: string;
  base_kind: string;
  base_kind_name: string;
  rate_pct: number;
  is_ceiling: boolean;
  notes: string | null;
  statute_ref: string;
  source_name: string;
};

/** 신탁보수 요율 상한. 보수규정 제6조가 공공성 등을 이유로 할인을 허용하므로 낮춰 쓸 수 있다. */
const TRUST_FEE_MAX_PCT = 3;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const resolved = resolveStructureCode({
    landRight: params.get("landRight"),
    concessionType: params.get("concessionType"),
    vehicle: params.get("vehicle"),
  });

  try {
    const { url } = supabasePublicConfig();
    const query = new URLSearchParams({
      select:
        "structure_code,structure_name,structure_group,terminal_value_policy,uses_exit_cap_rate,default_terminal_value_krw,dscr_required,default_dscr_min,depreciation_basis,property_tax_applies,ownership_during_operation,notes",
      is_active: "eq.true",
    });

    const response = await fetch(`${url}/rest/v1/part3_business_structure_policy?${query.toString()}`, {
      cache: "no-store",
      headers: supabasePublicHeaders({ Accept: "application/json" }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, code: "STRUCTURE_QUERY_FAILED", message: `사업구조 정책 조회 실패 (${response.status})` },
        { status: 502 }
      );
    }

    const rows = (await response.json()) as StructurePolicyRow[];
    const policy = rows.find((row) => row.structure_code === resolved.code) ?? null;

    if (!policy) {
      return NextResponse.json(
        {
          ok: false,
          code: "STRUCTURE_NOT_FOUND",
          message: `사업구조 ${resolved.code}의 정책이 DB에 없습니다.`,
        },
        { status: 404 }
      );
    }

    // 법인세 — 누진세율표(법인세법 §55)와 법인지방소득세(지방세법 §103의20)를 함께 내려보낸다.
    // 리츠는 배당소득공제로 면세라 세율표 대신 면세 플래그로 처리한다.
    let corporateTax: {
      exempt: boolean;
      basis: string;
      statuteRef: string | null;
      brackets: Array<{ upperKrw: number | null; ratePct: number; deductionKrw: number }>;
      localBrackets: Array<{ upperKrw: number | null; ratePct: number; deductionKrw: number }>;
    } | null = null;
    try {
      const [ruleResponse, bracketResponse] = await Promise.all([
        fetch(
          `${url}/rest/v1/part3_corporate_tax_rule?select=structure_group,is_exempt,basis,statute_ref&structure_group=eq.${policy.structure_group}`,
          { cache: "no-store", headers: supabasePublicHeaders({ Accept: "application/json" }) }
        ),
        fetch(
          `${url}/rest/v1/part3_corporate_tax_bracket?select=entity_kind,upper_krw,rate_pct,progressive_deduction_krw&base_year=eq.2026&entity_kind=in.(FOR_PROFIT,LOCAL_INCOME)`,
          { cache: "no-store", headers: supabasePublicHeaders({ Accept: "application/json" }) }
        ),
      ]);
      if (ruleResponse.ok && bracketResponse.ok) {
        const rules = (await ruleResponse.json()) as Array<{
          is_exempt: boolean; basis: string; statute_ref: string | null;
        }>;
        const brackets = (await bracketResponse.json()) as Array<{
          entity_kind: string; upper_krw: number | null; rate_pct: number; progressive_deduction_krw: number;
        }>;
        const toBracket = (kind: string) =>
          brackets
            .filter((row) => row.entity_kind === kind)
            .map((row) => ({
              upperKrw: row.upper_krw === null ? null : Number(row.upper_krw),
              ratePct: Number(row.rate_pct),
              deductionKrw: Number(row.progressive_deduction_krw),
            }))
            .sort((a, b) => (a.upperKrw ?? Number.POSITIVE_INFINITY) - (b.upperKrw ?? Number.POSITIVE_INFINITY));
        if (rules.length) {
          corporateTax = {
            exempt: Boolean(rules[0].is_exempt),
            basis: rules[0].basis,
            statuteRef: rules[0].statute_ref,
            brackets: toBracket("FOR_PROFIT"),
            localBrackets: toBracket("LOCAL_INCOME"),
          };
        }
      }
    } catch {
      // 법인세 규칙을 못 읽으면 세전 기준으로 계산하고 화면에 미반영으로 남긴다.
    }

    // 신탁 구조면 신탁보수를 사업비에 넣는다.
    // 임대·운영형 사업이라 분양가액 기준 보수(관리형 1.5%, 차입형 분양보수 2%)는 적용할 수 없고,
    // 건설비 기준인 차입형 개발보수만 계산 가능하다.
    let trustFee: {
      ratePct: number;
      base: string;
      baseName: string;
      basis: string;
      isCeiling: boolean;
      overridden: boolean;
      alternatives: Array<{ name: string; component: string; baseName: string; ratePct: number }>;
    } | null = null;

    if (policy.structure_group === "TRUST") {
      const feeQuery = new URLSearchParams({
        select: "trust_type,trust_type_name,fee_component,base_kind,base_kind_name,rate_pct,is_ceiling,notes,statute_ref,source_name",
        trust_type: "in.(DEVELOPMENT_LAND_TRUST,MANAGED_LAND_TRUST)",
      });
      const feeResponse = await fetch(`${url}/rest/v1/part3_trust_fee_schedule?${feeQuery.toString()}`, {
        cache: "no-store",
        headers: supabasePublicHeaders({ Accept: "application/json" }),
      });
      if (feeResponse.ok) {
        const rows = (await feeResponse.json()) as TrustFeeRow[];
        const development = rows.find(
          (row) => row.trust_type === "DEVELOPMENT_LAND_TRUST" && row.fee_component === "DEVELOPMENT"
        );
        if (development) {
          // Number(null)은 0이라, 파라미터가 없을 때 "사용자가 0%로 지정했다"로 읽히면 안 된다.
          const rawRate = params.get("trustFeeRatePct");
          const requested = rawRate === null || rawRate.trim() === "" ? Number.NaN : Number(rawRate);
          const overridden = Number.isFinite(requested) && requested >= 0 && requested <= TRUST_FEE_MAX_PCT;
          const ratePct = overridden ? requested : Number(development.rate_pct);
          trustFee = {
            ratePct,
            base: development.base_kind,
            baseName: development.base_kind_name,
            basis: `${development.source_name} ${development.statute_ref} ${development.trust_type_name} ${
              development.fee_component === "DEVELOPMENT" ? "개발보수" : development.fee_component
            } — ${development.base_kind_name} × ${development.rate_pct}%${development.is_ceiling ? " 이내" : ""}`,
            isCeiling: development.is_ceiling,
            overridden,
            alternatives: rows
              .filter((row) => row !== development)
              .map((row) => ({
                name: row.trust_type_name,
                component: row.fee_component,
                baseName: row.base_kind_name,
                ratePct: Number(row.rate_pct),
              })),
          };
        }
      }
    }

    // 지금 DB로 계산할 수 있는 것과 아직 못 하는 것을 구분해 화면에 그대로 알린다.
    const unmodelled: string[] = [];
    if (policy.property_tax_applies) {
      unmodelled.push(
        `${policy.structure_name}은 운영기간 중 시설분 재산세를 부담합니다. 시가표준액 기준값이 DB에 없어 현재 현금흐름에는 반영되지 않았습니다.`
      );
    }
    if (policy.structure_group === "TRUST" && !trustFee) {
      unmodelled.push("신탁보수 요율을 불러오지 못해 사업비에 반영되지 않았습니다.");
    }
    if (!corporateTax) {
      unmodelled.push("법인세 실효세율을 불러오지 못해 세전 기준으로 계산했습니다.");
    }
    if (policy.uses_exit_cap_rate) {
      unmodelled.push(
        "잔존가치를 Exit Cap Rate로 산정하는 구조인데 part3_underwriting_default에 exit_cap_rate_pct 값이 없습니다. 현재는 잔존가 0으로 보수적으로 계산합니다."
      );
    }

    // 보유세 취급을 화면에 명시한다.
    // 종합부동산세 과세대상은 '주택'과 '토지'뿐이고 일반 상업용 건축물은 대상이 아니다(종부세법 §7·§12).
    // 국공유지 PPP는 토지가 공공 소유라 민간이 토지분 납세의무자가 되지 않으므로,
    // 상업시설만으로 구성되면 종부세는 걸리지 않고 건물분 재산세만 남는다.
    const taxNotes: string[] = [
      "종합부동산세 — 비대상. 과세대상이 주택과 토지로 한정되어 일반 상업용 건축물은 종부세가 부과되지 않고, 국공유지 사업은 토지가 공공 소유라 토지분 납세의무자도 아닙니다.",
    ];
    if (policy.property_tax_applies) {
      taxNotes.push(
        "건물분 재산세 — 부담. 시설을 민간이 소유하는 구조라 재산세는 납부해야 합니다. 시가표준액 기준값이 DB에 없어 아직 현금흐름에는 반영되지 않았습니다."
      );
    }
    taxNotes.push(
      "예외 — 시설에 임대주택·노인복지주택이 포함되면 주택분 종부세 검토가 필요합니다. 법인은 공제금액이 0원이고 세율이 2.7~5.0%로 높지만, 합산배제 임대주택과 임대형 노인복지주택은 과세표준에서 제외됩니다(종부세법 §8②)."
    );

    return NextResponse.json({
      ok: true,
      resolved,
      policy: {
        structureCode: policy.structure_code,
        structureName: policy.structure_name,
        structureGroup: policy.structure_group,
        terminalValuePolicy: policy.terminal_value_policy,
        usesExitCapRate: policy.uses_exit_cap_rate,
        defaultTerminalValueKrw: policy.default_terminal_value_krw,
        dscrRequired: policy.dscr_required,
        dscrMin: policy.default_dscr_min,
        depreciationBasis: policy.depreciation_basis,
        propertyTaxApplies: policy.property_tax_applies,
        ownershipDuringOperation: policy.ownership_during_operation,
        notes: policy.notes,
        trustFeeRatePct: trustFee?.ratePct ?? null,
        trustFeeBase: trustFee?.base ?? null,
        trustFeeBasis: trustFee?.basis ?? null,
        corporateTaxExempt: corporateTax?.exempt ?? null,
      },
      trustFee,
      taxNotes,
      corporateTax,
      unmodelled,
      available: rows.map((row) => ({ code: row.structure_code, name: row.structure_name })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "STRUCTURE_POLICY_ERROR",
        message: error instanceof Error ? error.message : "사업구조 정책 조회 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
