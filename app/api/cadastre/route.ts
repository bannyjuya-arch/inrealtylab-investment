import { NextRequest, NextResponse } from "next/server";

const VWORLD_WFS_URL = "https://api.vworld.kr/req/wfs";
const CADASTRAL_LAYER = "lt_c_landinfobasemap";

function parseJsonOrJsonp(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("빈 응답");

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/^[^(]+\(([\s\S]*)\)\s*;?$/);
    if (!match) throw new Error(`응답 파싱 실패: ${trimmed.slice(0, 220)}`);
    return JSON.parse(match[1]);
  }
}

function compactText(text: string) {
  return text.replace(/\s+/g, " ").trim();
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

  // VWorld's official cadastral attribute-query sample uses WFS GetFeature
  // against lt_c_landinfobasemap. We re-test that exact flow now that the
  // Vercel Function runs in Seoul (icn1), which removed the prior gateway issue.
  const delta = 0.00002;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");

  const params = new URLSearchParams({
    key,
    SERVICE: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    TYPENAME: CADASTRAL_LAYER,
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
      const contentType = response.headers.get("content-type") ?? "unknown-content-type";
      const body = compactText(text).slice(0, 220) || "응답 본문 없음";
      return NextResponse.json(
        {
          ok: false,
          code: "VWORLD_WFS_UPSTREAM_ERROR",
          message: `VWorld 지적 WFS 호출 실패 (HTTP ${response.status}) · ${contentType} · ${body}`,
          detail: body,
        },
        { status: 502 }
      );
    }

    let payload: any;
    try {
      payload = parseJsonOrJsonp(text);
    } catch (error) {
      const detail = error instanceof Error ? error.message : compactText(text).slice(0, 220);
      return NextResponse.json(
        {
          ok: false,
          code: "VWORLD_WFS_PARSE_ERROR",
          message: `VWorld 지적 WFS 응답 형식을 해석하지 못했습니다. · ${detail}`,
          detail,
        },
        { status: 502 }
      );
    }

    const features = Array.isArray(payload?.features) ? payload.features : [];
    const totalFeatures = Number(payload?.totalFeatures ?? features.length);

    if (!features.length || totalFeatures === 0) {
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
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        code: "VWORLD_WFS_FETCH_ERROR",
        message: `VWorld 지적 WFS 조회 중 네트워크 오류가 발생했습니다. · ${detail}`,
        detail,
      },
      { status: 502 }
    );
  }
}
