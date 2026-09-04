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

    // 지금 DB로 계산할 수 있는 것과 아직 못 하는 것을 구분해 화면에 그대로 알린다.
    const unmodelled: string[] = [];
    if (policy.property_tax_applies) {
      unmodelled.push(
        `${policy.structure_name}은 운영기간 중 시설분 재산세를 부담합니다. 시가표준액 기준값이 DB에 없어 현재 현금흐름에는 반영되지 않았습니다.`
      );
    }
    if (policy.structure_group === "TRUST") {
      unmodelled.push("신탁보수가 DB에 없어 운영비에 반영되지 않았습니다. 수탁 조건이 정해지면 입력해야 합니다.");
    }
    if (policy.structure_group === "REIT") {
      unmodelled.push(
        "리츠는 배당가능이익의 90% 이상을 배당하면 그 배당금액을 소득공제받습니다(법인세법 제51조의2). 법인세 계산 자체가 아직 없어 이 효과는 반영되지 않았습니다."
      );
    }
    if (policy.uses_exit_cap_rate) {
      unmodelled.push(
        "잔존가치를 Exit Cap Rate로 산정하는 구조인데 part3_underwriting_default에 exit_cap_rate_pct 값이 없습니다. 현재는 잔존가 0으로 보수적으로 계산합니다."
      );
    }

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
      },
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
