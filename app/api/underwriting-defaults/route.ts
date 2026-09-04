import { NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 금융 가정 기본값 (2026-09-04 신설)
//
// 그동안 대출금리 7.0%와 LTC 75%가 lib/integrated-report.ts에 상수로 박혀 있었다.
// 두 값 모두 출처가 없고, DB(part3_finance_benchmark)에는 한국은행 기준금리 2.75%와
// 전문가 설문 기준 LTV 65%가 이미 들어와 있었는데 계산에 쓰이지 않았다.
//
// 이 라우트는 DB 값을 그대로 돌려주고, 어떤 자료에서 온 값인지 함께 전달한다.
// 화면에서 근거를 못 대는 숫자는 판정에 쓰지 않는다는 원칙을 지키기 위한 것이다.
//
// 주의: 은행 평균 대출금리 4.26%는 DB 주석에도 적혀 있듯 PF 전용 금리가 아니다.
// 그래서 이 값을 그대로 조달금리로 쓰지 않고 기준금리와의 차이를 스프레드 참고치로만
// 제시하고, 실제 PF 스프레드는 사용자가 사업별로 입력하게 둔다.

export const dynamic = "force-dynamic";

type BenchmarkRow = {
  metric_code: string;
  finance_type: string | null;
  value_low: number | null;
  value_mid: number | null;
  value_high: number | null;
  unit: string | null;
  publisher: string | null;
  report_name: string | null;
  source_page: string | null;
  base_date: string | null;
  notes: string | null;
  confidence: number | null;
};

const WANTED = ["REFERENCE_RATE", "BANK_LENDING_RATE", "PREFERRED_LTV", "MIN_REQUIRED_RETURN"];

function num(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function GET() {
  try {
    const { url } = supabasePublicConfig();
    const query = new URLSearchParams({
      select:
        "metric_code,finance_type,value_low,value_mid,value_high,unit,publisher,report_name,source_page,base_date,notes,confidence",
      metric_code: `in.(${WANTED.join(",")})`,
    });

    const response = await fetch(`${url}/rest/v1/part3_finance_benchmark?${query.toString()}`, {
      cache: "no-store",
      headers: supabasePublicHeaders({ Accept: "application/json" }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, code: "BENCHMARK_QUERY_FAILED", message: `금융 기준값 조회 실패 (${response.status})` },
        { status: 502 }
      );
    }

    const rows = (await response.json()) as BenchmarkRow[];
    const pick = (code: string) => rows.find((row) => row.metric_code === code) ?? null;

    const reference = pick("REFERENCE_RATE");
    const bankLending = pick("BANK_LENDING_RATE");
    const ltv = pick("PREFERRED_LTV");
    const requiredReturn = pick("MIN_REQUIRED_RETURN");

    const referenceRatePct = num(reference?.value_mid ?? null);
    const bankLendingRatePct = num(bankLending?.value_mid ?? null);
    // 은행 평균 대출금리와 기준금리의 차이. PF 스프레드의 하한 참고치로만 쓴다.
    const observedSpreadPct =
      referenceRatePct !== null && bankLendingRatePct !== null
        ? Math.round((bankLendingRatePct - referenceRatePct) * 100) / 100
        : null;

    const warnings: string[] = [];
    if (bankLending?.notes) warnings.push(`대출금리: ${bankLending.notes}`);
    warnings.push(
      "PF 스프레드는 사업 구조·신용보강에 따라 크게 달라집니다. 기본값은 은행 평균 대출금리와 기준금리의 차이(참고치)이며, 실제 조달 조건으로 반드시 조정해야 합니다."
    );

    return NextResponse.json({
      ok: true,
      defaults: {
        referenceRatePct,
        pfSpreadPct: observedSpreadPct,
        // 참고: referenceRate + spread = 은행 평균 대출금리
        impliedRatePct:
          referenceRatePct !== null && observedSpreadPct !== null ? referenceRatePct + observedSpreadPct : null,
        debtRatioPct: num(ltv?.value_mid ?? null),
        debtRatioRange:
          ltv && (num(ltv.value_low) !== null || num(ltv.value_high) !== null)
            ? { low: num(ltv.value_low), high: num(ltv.value_high) }
            : null,
        investorRequiredReturnPct: num(requiredReturn?.value_mid ?? null),
        investorRequiredReturnRange:
          requiredReturn && (num(requiredReturn.value_low) !== null || num(requiredReturn.value_high) !== null)
            ? { low: num(requiredReturn.value_low), high: num(requiredReturn.value_high) }
            : null,
      },
      sources: rows.map((row) => ({
        metricCode: row.metric_code,
        value: num(row.value_mid),
        range: { low: num(row.value_low), high: num(row.value_high) },
        unit: row.unit,
        publisher: row.publisher,
        reportName: row.report_name,
        sourcePage: row.source_page,
        baseDate: row.base_date,
        note: row.notes,
        confidence: num(row.confidence),
      })),
      warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNDERWRITING_DEFAULTS_ERROR",
        message: error instanceof Error ? error.message : "금융 기준값 조회 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
