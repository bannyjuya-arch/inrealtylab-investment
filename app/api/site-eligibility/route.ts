import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const query = body?.query ?? "성수동 1가 643";

  return NextResponse.json({
    site: {
      address: query,
      area: 1850,
      landType: "대",
      ownerType: "공유지",
      pppEligible: true,
    },
    radar: {
      demand: 91,
      accessibility: 84,
      profitability: 76,
      infrastructure: 42,
      publicNeed: 88,
    },
    facilitySignals: [
      { name: "코리빙", status: "green", reason: "청년층 밀집 상위 1%" },
      { name: "실버스테이", status: "yellow", reason: "시니어 인구 평균 수준" },
      { name: "물류센터", status: "red", reason: "주거지역 내 제한" },
    ],
    strategyText:
      "본 부지는 성동구 내에서 문화시설 접근성이 평균 대비 하위 15%로 분석됩니다.",
  });
}