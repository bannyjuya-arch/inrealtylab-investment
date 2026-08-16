import { NextRequest, NextResponse } from "next/server";

const VWORLD_WFS_URL = "https://api.vworld.kr/req/wfs";

function parseJsonOrJsonp(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("빈 응답");

  try {
    return JSON.parse(trimmed);
  } catch {
    // ES2017 target compatibility: avoid the RegExp dotAll (s) flag.
    const match = trimmed.match(/^[^(]+\(([\s\S]*)\)\s*;?$/);
    if (!match) throw new Error(`응답 파싱 실패: ${trimmed.slice(0, 120)}`);
    return JSON.parse(match[1]);
  }
}

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

  // VWorld official sample pattern: query the cadastral base-map WFS layer
  // using a very small BBOX around the clicked longitude/latitude.
  const delta = 0.000015;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");

  const params = new URLSearchParams({
    key,
    SERVICE: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    TYPENAME: "lt_c_landinfobasemap",
    OUTPUT: "text/javascript",
    SRSNAME: "EPSG:4326",
    BBOX: bbox,
    callback: "parseResponse",
  });

  try {
    const response = await fetch(`${VWORLD_WFS_URL}?${params.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/javascript, application/json, text/plain, */*" },
    });

    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: `VWorld 지적 WFS 호출 실패 (HTTP ${response.status})`,
          detail: text.slice(0, 300),
        },
        { status: 502 }
      );
    }

    const payload = parseJsonOrJsonp(text);
    const features = Array.isArray(payload?.features) ? payload.features : [];

    if (!features.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "해당 위치에서 지적 필지를 찾지 못했습니다.",
          source: "vworld-wfs-lt_c_landinfobasemap",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      source: "vworld-wfs-lt_c_landinfobasemap",
      featureCollection: {
        type: "FeatureCollection",
        features,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: "VWorld 지적 WFS 조회 중 오류가 발생했습니다.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  }
}
