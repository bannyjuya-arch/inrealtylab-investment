import { NextRequest, NextResponse } from "next/server";
import { fetchPublicDataXml, publicDataServiceKey } from "../../lib/public-data";

const BASE = "https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade";

export async function GET(request: NextRequest) {
  const lawdCd = request.nextUrl.searchParams.get("lawdCd")?.trim() ?? "";
  const dealYmd = request.nextUrl.searchParams.get("dealYmd")?.trim() ?? "";
  const key = publicDataServiceKey();

  if (!/^\d{5}$/.test(lawdCd)) {
    return NextResponse.json({ ok: false, code: "LAWD_CD_REQUIRED", message: "5자리 시군구 코드(lawdCd)가 필요합니다." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(dealYmd)) {
    return NextResponse.json({ ok: false, code: "DEAL_YMD_REQUIRED", message: "6자리 계약년월(dealYmd, YYYYMM)이 필요합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, code: "NO_PUBLIC_DATA_KEY", message: "DATA_GO_KR_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  }

  try {
    const result = await fetchPublicDataXml(
      BASE,
      "getRTMSDataSvcLandTrade",
      { LAWD_CD: lawdCd, DEAL_YMD: dealYmd },
      key
    );

    return NextResponse.json({
      ok: true,
      source: {
        name: "국토교통부 토지 매매 실거래가",
        provider: "국토교통부",
        endpoint: "RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade",
        queriedAt: new Date().toISOString(),
      },
      query: { lawdCd, dealYmd },
      totalCount: result.totalCount || result.rows.length,
      rows: result.rows,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "LAND_TRADE_UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "토지 실거래가 조회 중 오류가 발생했습니다.",
    }, { status: 502 });
  }
}
