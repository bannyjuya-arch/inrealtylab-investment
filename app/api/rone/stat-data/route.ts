import { NextRequest, NextResponse } from "next/server";

const RONE_STAT_DATA_URL = "https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do";

export async function GET(req: NextRequest) {
  const key = process.env.RONE_API_KEY?.trim();
  if (!key) {
    return NextResponse.json(
      { ok: false, code: "RONE_KEY_MISSING", message: "RONE_API_KEY가 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  const statblId = req.nextUrl.searchParams.get("statblId")?.trim();
  if (!statblId) {
    return NextResponse.json(
      { ok: false, code: "STATBL_ID_REQUIRED", message: "R-ONE 통계표 코드(statblId)가 필요합니다." },
      { status: 400 }
    );
  }

  const params = new URLSearchParams({
    KEY: key,
    Type: "json",
    STATBL_ID: statblId,
    pIndex: req.nextUrl.searchParams.get("pIndex") ?? "1",
    pSize: req.nextUrl.searchParams.get("pSize") ?? "100",
  });

  for (const [from, to] of [
    ["cycle", "DTACYCLE_CD"],
    ["time", "WRTTIME_IDTFR_ID"],
    ["item", "ITM_ID"],
    ["class", "CLS_ID"],
  ] as const) {
    const value = req.nextUrl.searchParams.get(from)?.trim();
    if (value) params.set(to, value);
  }

  try {
    const response = await fetch(`${RONE_STAT_DATA_URL}?${params.toString()}`, { cache: "no-store" });
    const text = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, code: "RONE_UPSTREAM_ERROR", message: `R-ONE 호출 실패 (HTTP ${response.status})` },
        { status: 502 }
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, code: "RONE_PARSE_ERROR", message: "R-ONE JSON 응답을 해석하지 못했습니다." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      source: "R-ONE",
      statblId,
      payload,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, code: "RONE_FETCH_ERROR", message: error instanceof Error ? error.message : "R-ONE 조회 오류" },
      { status: 502 }
    );
  }
}
