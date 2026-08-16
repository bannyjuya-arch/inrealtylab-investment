import { NextRequest, NextResponse } from "next/server";

const VWORLD_WMS_URL = "https://api.vworld.kr/req/wms";
const CADASTRAL_LAYER = "lt_c_landinfobasemap";

function parseJsonOrJsonp(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("빈 응답");

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/^[^(]+\(([\s\S]*)\)\s*;?$/);
    if (!match) throw new Error(`응답 파싱 실패: ${trimmed.slice(0, 180)}`);
    return JSON.parse(match[1]);
  }
}

function normalizeFeatures(payload: any) {
  if (Array.isArray(payload?.features)) return payload.features;
  if (Array.isArray(payload?.featureCollection?.features)) return payload.featureCollection.features;
  return [];
}

function compactText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export async function GET(req: NextRequest) {
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const key = process.env.VWORLD_API_KEY;
  const domain = process.env.VWORLD_API_DOMAIN ?? req.nextUrl.origin;

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ ok: false, message: "유효한 좌표가 필요합니다." }, { status: 400 });
  }

  if (!key) {
    return NextResponse.json(
      { ok: false, code: "VWORLD_KEY_MISSING", message: "서버에 VWORLD_API_KEY가 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  // WFS requests from Vercel are returning upstream 502 responses.
  // Use the queryable cadastral WMS layer instead and ask for GeoJSON feature info
  // around the clicked point. WMS 1.1.1 keeps EPSG:4326 BBOX axis order lon,lat.
  const delta = 0.00035;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");

  const params = new URLSearchParams({
    key,
    domain,
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: CADASTRAL_LAYER,
    QUERY_LAYERS: CADASTRAL_LAYER,
    STYLES: CADASTRAL_LAYER,
    SRS: "EPSG:4326",
    BBOX: bbox,
    WIDTH: "101",
    HEIGHT: "101",
    X: "50",
    Y: "50",
    FORMAT: "image/png",
    INFO_FORMAT: "application/json",
    FEATURE_COUNT: "5",
    TRANSPARENT: "true",
  });

  try {
    const response = await fetch(`${VWORLD_WMS_URL}?${params.toString()}`, {
      cache: "no-store",
      headers: { Accept: "application/json, text/javascript, text/plain, */*" },
    });

    const text = await response.text();
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "unknown-content-type";
      const server = response.headers.get("server") ?? "unknown-server";
      const body = compactText(text).slice(0, 180) || "응답 본문 없음";

      return NextResponse.json(
        {
          ok: false,
          code: "VWORLD_UPSTREAM_ERROR",
          message: `VWorld 지적 WMS 클릭조회 실패 (HTTP ${response.status}) · ${contentType} · server=${server} · ${body}`,
          detail: {
            status: response.status,
            contentType,
            server,
            body,
          },
        },
        { status: 502 }
      );
    }

    let payload: any;
    try {
      payload = parseJsonOrJsonp(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : compactText(text).slice(0, 180);
      return NextResponse.json(
        {
          ok: false,
          code: "VWORLD_RESPONSE_PARSE_ERROR",
          message: `VWorld 지적 WMS 응답 형식을 해석하지 못했습니다. · ${detail}`,
          detail,
        },
        { status: 502 }
      );
    }

    const features = normalizeFeatures(payload);
    if (!features.length) {
      return NextResponse.json(
        {
          ok: false,
          message: "해당 위치에서 지적 필지를 찾지 못했습니다.",
          source: "vworld-wms-getfeatureinfo",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      source: "vworld-wms-getfeatureinfo",
      dataProjection: "EPSG:4326",
      featureCollection: {
        type: "FeatureCollection",
        features,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        code: "VWORLD_FETCH_ERROR",
        message: `VWorld 지적 WMS 클릭조회 중 네트워크 오류가 발생했습니다. · ${detail}`,
        detail,
      },
      { status: 502 }
    );
  }
}
