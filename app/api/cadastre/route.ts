import { NextRequest, NextResponse } from "next/server";

const VWORLD_DATA_URL = "https://api.vworld.kr/req/data";

export async function GET(req: NextRequest) {
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const key = process.env.VWORLD_API_KEY;

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ ok: false, message: "유효한 좌표가 필요합니다." }, { status: 400 });
  }

  if (!key) {
    return NextResponse.json(
      { ok: false, code: "VWORLD_KEY_MISSING", message: "서버에 VWORLD_API_KEY가 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    service: "data",
    request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    key,
    domain: process.env.VWORLD_API_DOMAIN ?? req.nextUrl.origin,
    geomFilter: `POINT(${lon} ${lat})`,
    geometry: "true",
    attribute: "true",
    size: "10",
    page: "1",
    format: "json",
    crs: "EPSG:4326",
  });

  try {
    const response = await fetch(`${VWORLD_DATA_URL}?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`VWorld data API error: ${response.status}`);
    }

    const payload = await response.json();
    const featureCollection = payload?.response?.result?.featureCollection;
    const features = featureCollection?.features ?? [];

    if (!Array.isArray(features) || features.length === 0) {
      return NextResponse.json(
        { ok: false, message: "해당 위치에서 지적 필지를 찾지 못했습니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      featureCollection: {
        type: "FeatureCollection",
        features,
      },
    });
  } catch (error) {
    console.error("VWorld cadastral lookup error", error);
    return NextResponse.json(
      { ok: false, message: "지적 필지 조회 중 오류가 발생했습니다." },
      { status: 502 }
    );
  }
}
