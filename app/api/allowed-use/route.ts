import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
  "https://igiltlrafwiszkhvtspb.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
  "sb_publishable_Gy4GhKbuZU9vV3hEoPQ5Og_5P4_5_9e";

const PUBLIC_DATA_API_KEY =
  process.env.DATA_GO_KR_API_KEY?.trim() ||
  process.env.PUBLIC_DATA_API_KEY?.trim() ||
  "";

export async function GET(request: NextRequest) {
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    };
    if (PUBLIC_DATA_API_KEY) headers["x-public-data-key"] = PUBLIC_DATA_API_KEY;

    const response = await fetch(`${SUPABASE_URL}/functions/v1/part1-allowed-use`, {
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
