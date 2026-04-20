import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const inputs = body?.inputs ?? {};

  const years = Number(inputs.operationYears ?? 30);

  const cashflows = Array.from({ length: 40 }, (_, i) => {
    const year = i + 1;
    let value = 0;

    if (year <= 3) value = -18000000000 + i * 2000000000;
    else if (year <= 30) value = 1200000000 + (year - 4) * 120000000;
    else value = 6000000000 + (year - 31) * 350000000;

    return { year, value };
  });

  return NextResponse.json({
    summary: {
      projectIRR: 0.072,
      avgDSCR: 1.18,
      breakEvenYear: 14,
      monthlyRent: 184000000,
      totalCost: 60480000000,
    },
    cashflows,
    warnings: years < 40 ? ["운영 기간 연장 필요"] : [],
  });
}