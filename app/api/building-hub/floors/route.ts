import { NextRequest, NextResponse } from "next/server";
import { fetchPublicDataXml, publicDataServiceKey } from "../../lib/public-data";

const BASE = "https://apis.data.go.kr/1613000/BldRgstHubService";

type Row = Record<string, string>;

function numberValue(value: string | undefined) {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pick(row: Row, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct?.trim()) return direct.trim();
    const found = Object.entries(row).find(([name, value]) => name.toLowerCase() === key.toLowerCase() && value?.trim());
    if (found) return found[1].trim();
  }
  return "";
}

function isBasement(row: Row) {
  const gb = pick(row, ["flrGbCd", "flrGbCdNm", "flrGbNm", "floorType"]);
  const name = pick(row, ["flrNoNm", "flrNo", "floorName"]);
  return gb === "10" || /지하|B\d+/i.test(`${gb} ${name}`);
}

export async function GET(request: NextRequest) {
  const sigunguCd = request.nextUrl.searchParams.get("sigunguCd")?.trim() ?? "";
  const bjdongCd = request.nextUrl.searchParams.get("bjdongCd")?.trim() ?? "";
  const platGbCd = request.nextUrl.searchParams.get("platGbCd")?.trim() ?? "0";
  const bun = request.nextUrl.searchParams.get("bun")?.trim() ?? "";
  const ji = request.nextUrl.searchParams.get("ji")?.trim() ?? "";
  const key = publicDataServiceKey();

  if (!/^\d{5}$/.test(sigunguCd) || !/^\d{5}$/.test(bjdongCd)) {
    return NextResponse.json({ ok: false, code: "LOCATION_CODE_REQUIRED", message: "5자리 sigunguCd와 bjdongCd가 필요합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, code: "NO_PUBLIC_DATA_KEY", message: "DATA_GO_KR_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  }

  const params: Record<string, string> = {
    sigunguCd,
    bjdongCd,
    platGbCd,
    numOfRows: "1000",
    pageNo: "1",
    _type: "xml",
  };
  if (bun) params.bun = bun.padStart(4, "0");
  if (ji) params.ji = ji.padStart(4, "0");

  try {
    const result = await fetchPublicDataXml(BASE, "getBrFlrOulnInfo", params, key);
    const rows = result.rows as Row[];
    let basementAreaSqm = 0;
    let aboveGroundAreaSqm = 0;

    for (const row of rows) {
      const area = numberValue(pick(row, ["area", "flrArea", "totArea"]));
      if (area <= 0) continue;
      if (isBasement(row)) basementAreaSqm += area;
      else aboveGroundAreaSqm += area;
    }

    const basementRatioPct = aboveGroundAreaSqm > 0 ? (basementAreaSqm / aboveGroundAreaSqm) * 100 : null;

    return NextResponse.json({
      ok: true,
      query: { sigunguCd, bjdongCd, platGbCd, bun: params.bun ?? null, ji: params.ji ?? null },
      totalCount: result.totalCount || rows.length,
      summary: {
        basementAreaSqm,
        aboveGroundAreaSqm,
        basementRatioPct,
      },
      rows,
      source: {
        name: "국토교통부 건축HUB 층별개요",
        provider: "국토교통부",
        endpoint: "BldRgstHubService/getBrFlrOulnInfo",
        queriedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "BUILDING_HUB_FLOOR_UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "건축HUB 층별개요 조회 중 오류가 발생했습니다.",
    }, { status: 502 });
  }
}
