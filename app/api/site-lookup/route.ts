import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const query = body?.query ?? "";

  return NextResponse.json({
    siteName: `${query || "행당중학교"} 부지`,
    address: "서울특별시 성동구 행당동 000-0",
    officialLandPricePerPyeong: 18500000,
    zoning: "제2종 일반주거지역",
    coords: {
      lat: 37.561,
      lng: 127.0365,
    },
  });
}