import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, code: "SUPABASE_CONFIG_MISSING", message: "금융 벤치마크 DB 연결 설정이 없습니다." },
      { status: 503 }
    );
  }

  const query = new URLSearchParams({
    select: "metric_code,finance_type,value_low,value_mid,value_high,unit,base_date,benchmark_type,source_code,publisher,report_name,notes",
    metric_code: "in.(REFERENCE_RATE,BANK_LENDING_RATE)",
    order: "base_date.desc",
  });

  try {
    const response = await fetch(`${url}/rest/v1/part3_finance_benchmark?${query.toString()}`, {
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
      metric_code: string;
      finance_type: string | null;
      value_low: number | string | null;
      value_mid: number | string | null;
      value_high: number | string | null;
      unit: string | null;
      base_date: string | null;
      benchmark_type: string | null;
      source_code: string | null;
      publisher: string | null;
      report_name: string | null;
      notes: string | null;
    }>;

    const toNumber = (value: number | string | null) => {
      if (value === null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const benchmark = Object.fromEntries(rows.map((row) => [row.metric_code, {
      metricCode: row.metric_code,
      financeType: row.finance_type,
      valueLow: toNumber(row.value_low),
      valueMid: toNumber(row.value_mid),
      valueHigh: toNumber(row.value_high),
      unit: row.unit,
      baseDate: row.base_date,
      benchmarkType: row.benchmark_type,
      sourceCode: row.source_code,
      publisher: row.publisher,
      reportName: row.report_name,
      notes: row.notes,
    }]));

    return NextResponse.json({
      ok: true,
      benchmark,
      pfSpecificAvailable: false,
      note: "현재 DB에는 PF 전용 최근 대출금리 벤치마크가 없으며, 기준금리와 일반 은행 대출금리는 참고값으로만 사용합니다.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "FINANCE_BENCHMARK_LOOKUP_ERROR",
        message: error instanceof Error ? error.message : "금융 벤치마크 조회 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
