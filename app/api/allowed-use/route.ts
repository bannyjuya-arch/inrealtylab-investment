import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

const PUBLIC_DATA_API_KEY =
  process.env.DATA_GO_KR_API_KEY?.trim() ||
  process.env.PUBLIC_DATA_API_KEY?.trim() ||
  "";

const LANDUSE_BASE = "https://apis.data.go.kr/1613000/arLandUseInfoService";

function tag(xml: string, name: string) {
  return xml.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]?.trim() ?? "";
}

function safeSnippet(raw: string) {
  let out = raw.replace(/\s+/g, " ");
  if (PUBLIC_DATA_API_KEY) {
    out = out
      .replaceAll(PUBLIC_DATA_API_KEY, "[SERVICE_KEY]")
      .replaceAll(encodeURIComponent(PUBLIC_DATA_API_KEY), "[SERVICE_KEY]");
  }
  return out.slice(0, 280);
}

async function runDiagnostic() {
  if (!PUBLIC_DATA_API_KEY) {
    return NextResponse.json({ ok: false, code: "NO_PUBLIC_DATA_KEY", message: "Vercel 공공데이터 키가 없습니다." }, { status: 503 });
  }

  const attempts: Array<Record<string, string>> = [
    {},
    { searchKeyword: "시설" },
    { keyword: "시설" },
    { lunNm: "시설" },
    { luname: "시설" },
    { searchWrd: "시설" },
    { searchWord: "시설" },
  ];

  const results = [];
  for (const params of attempts) {
    const qs = new URLSearchParams({
      ...params,
      serviceKey: PUBLIC_DATA_API_KEY,
      pageNo: "1",
      numOfRows: "1000",
    });
    try {
      const response = await fetch(`${LANDUSE_BASE}/DTsearchLunCd?${qs.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/xml,text/xml,*/*" },
      });
      const raw = await response.text();
      results.push({
        params,
        httpStatus: response.status,
        resultCode: tag(raw, "resultCode") || tag(raw, "returnReasonCode") || null,
        resultMsg: tag(raw, "resultMsg") || tag(raw, "returnAuthMsg") || tag(raw, "errMsg") || null,
        itemCount: (raw.match(/<item>/gi) ?? []).length,
        snippet: safeSnippet(raw),
      });
    } catch (error) {
      results.push({
        params,
        httpStatus: null,
        resultCode: null,
        resultMsg: error instanceof Error ? error.message : String(error),
        itemCount: 0,
        snippet: null,
      });
    }
  }

  return NextResponse.json({ ok: true, endpoint: "DTsearchLunCd", results });
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("diagnostic") === "1") {
    return runDiagnostic();
  }

  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  const zoneName = request.nextUrl.searchParams.get("zoneName")?.trim() ?? "";
  const aboveGroundGfaSqm = request.nextUrl.searchParams.get("aboveGroundGfaSqm")?.trim() ?? "";
  const scenarioCode = request.nextUrl.searchParams.get("scenarioCode")?.trim() || "BASE";

  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, message: "19자리 PNU가 필요합니다." },
      { status: 400 }
    );
  }

  const body: Record<string, string | number> = {
    pnu,
    zoneName,
    scenarioCode,
  };

  if (aboveGroundGfaSqm) {
    const gfa = Number(aboveGroundGfaSqm);
    if (!Number.isFinite(gfa) || gfa <= 0) {
      return NextResponse.json(
        { ok: false, message: "aboveGroundGfaSqm은 0보다 큰 숫자여야 합니다." },
        { status: 400 }
      );
    }
    body.aboveGroundGfaSqm = gfa;
  }

  try {
    const { url } = supabasePublicConfig();
    const headers: Record<string, string> = supabasePublicHeaders({
      "Content-Type": "application/json",
    });
    if (PUBLIC_DATA_API_KEY) headers["x-public-data-key"] = PUBLIC_DATA_API_KEY;

    const response = await fetch(`${url}/functions/v1/part1-allowed-use`, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, message: text || "Supabase 응답을 해석하지 못했습니다." };
    }

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "ALLOWED_USE_PROXY_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "건축 가능시설 조회 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
