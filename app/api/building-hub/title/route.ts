import { NextRequest, NextResponse } from "next/server";
import { fetchPublicDataXml, publicDataServiceKey } from "../../lib/public-data";

const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";

export async function GET(request: NextRequest) {
  const sigunguCd = request.nextUrl.searchParams.get("sigunguCd")?.trim() ?? "";
  const bjdongCd = request.nextUrl.searchParams.get("bjdongCd")?.trim() ?? "";
  const platGbCd = request.nextUrl.searchParams.get("platGbCd")?.trim() ?? "0";
  const bun = request.nextUrl.searchParams.get("bun")?.trim() ?? "";
  const ji = request.nextUrl.searchParams.get("ji")?.trim() ?? "";
  const key = publicDataServiceKey();

  if (!/^\d{5}$/.test(sigunguCd)) {
    return NextResponse.json({ ok: false, code: "SIGUNGU_CD_REQUIRED", message: "5자리 시군구 코드(sigunguCd)가 필요합니다." }, { status: 400 });
  }
  if (!/^\d{5}$/.test(bjdongCd)) {
    return NextResponse.json({ ok: false, code: "BJDONG_CD_REQUIRED", message: "5자리 법정동 코드(bjdongCd)가 필요합니다." }, { status: 400 });
  }
  if (!/^[012]$/.test(platGbCd)) {
    return NextResponse.json({ ok: false, code: "PLAT_GB_CD_INVALID", message: "platGbCd는 0(대지), 1(산), 2(블록) 중 하나여야 합니다." }, { status: 400 });
  }
  if (bun && !/^\d{1,4}$/.test(bun)) {
    return NextResponse.json({ ok: false, code: "BUN_INVALID", message: "bun은 최대 4자리 숫자여야 합니다." }, { status: 400 });
  }
  if (ji && !/^\d{1,4}$/.test(ji)) {
    return NextResponse.json({ ok: false, code: "JI_INVALID", message: "ji는 최대 4자리 숫자여야 합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, code: "NO_PUBLIC_DATA_KEY", message: "DATA_GO_KR_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  }

  const params: Record<string, string> = {
    sigunguCd,
    bjdongCd,
    platGbCd,
    numOfRows: request.nextUrl.searchParams.get("numOfRows")?.trim() || "100",
    pageNo: request.nextUrl.searchParams.get("pageNo")?.trim() || "1",
    _type: "xml",
  };
  if (bun) params.bun = bun.padStart(4, "0");
  if (ji) params.ji = ji.padStart(4, "0");

  try {
    const result = await fetchPublicDataXml(BASE, "getBrTitleInfo", params, key);

    return NextResponse.json({
      ok: true,
      source: {
        name: "국토교통부 건축HUB 건축물대장 표제부",
        provider: "국토교통부",
        endpoint: "BldRgstHubService/getBrTitleInfo",
        queriedAt: new Date().toISOString(),
      },
      query: { sigunguCd, bjdongCd, platGbCd, bun: params.bun ?? null, ji: params.ji ?? null },
      totalCount: result.totalCount || result.rows.length,
      rows: result.rows,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "BUILDING_HUB_UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "건축HUB 표제부 조회 중 오류가 발생했습니다.",
    }, { status: 502 });
  }
}
