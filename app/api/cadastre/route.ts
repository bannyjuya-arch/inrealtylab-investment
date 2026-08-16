import { NextRequest, NextResponse } from "next/server";

const VWORLD_WFS_URL = "https://api.vworld.kr/req/wfs";
const VWORLD_DATA_URL = "https://api.vworld.kr/req/data";

function normalizeFeatures(payload: any) {
  if (Array.isArray(payload?.features)) return payload.features;
  if (Array.isArray(payload?.featureCollection?.features)) return payload.featureCollection.features;
  if (Array.isArray(payload?.response?.result?.featureCollection?.features)) {
    return payload.response.result.featureCollection.features;
  }
  return [];
}

async function queryWfs(lon: number, lat: number, key: string, domain: string) {
  const delta = 0.00001;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta].join(",");
  const params = new URLSearchParams({
    SERVICE: "WFS",
    REQUEST: "GetFeature",
    TYPENAME: "lp_pa_cbnd_bubun",
    VERSION: "1.1.0",
    MAXFEATURES: "5",
    SRSNAME: "EPSG:4326",
    OUTPUT: "json",
    BBOX: bbox,
    KEY: key,
    DOMAIN: domain,
  });

  const response = await fetch(`${VWORLD_WFS_URL}?${params.toString()}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`WFS HTTP ${response.status}`);

  try {
    const payload = JSON.parse(text);
    return { features: normalizeFeatures(payload), detail: payload };
  } catch {
    return { features: [], detail: { message: text.slice(0, 300) } };
  }
}

async function queryData(lon: number, lat: number, key: string, domain: string) {
  const params = new URLSearchParams({
    service: "data",
    version: "2.0",
    request: "GetFeature",
    data: "LP_PA_CBND_BUBUN",
    key,
    domain,
    geomFilter: `POINT(${lon} ${lat})`,
    geometry: "true",
    attribute: "true",
    size: "5",
    page: "1",
    format: "json",
    crs: "EPSG:4326",
  });

  const response = await fetch(`${VWORLD_DATA_URL}?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Data API HTTP ${response.status}`);

  const status = payload?.response?.status;
  if (status && status !== "OK" && status !== "NOT_FOUND") {
    const code = payload?.response?.error?.code ?? status;
    const text = payload?.response?.error?.text ?? "VWorld Data API 오류";
    throw new Error(`${code}: ${text}`);
  }

  return { features: normalizeFeatures(payload), detail: payload };
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

  const errors: string[] = [];

  try {
    const wfs = await queryWfs(lon, lat, key, domain);
    if (wfs.features.length > 0) {
      return NextResponse.json({
        ok: true,
        source: "vworld-wfs",
        featureCollection: { type: "FeatureCollection", features: wfs.features },
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? `WFS: ${error.message}` : "WFS 조회 실패");
  }

  try {
    const data = await queryData(lon, lat, key, domain);
    if (data.features.length > 0) {
      return NextResponse.json({
        ok: true,
        source: "vworld-data",
        featureCollection: { type: "FeatureCollection", features: data.features },
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? `Data: ${error.message}` : "Data API 조회 실패");
  }

  const detail = errors.length ? ` (${errors.join(" / ")})` : "";
  return NextResponse.json(
    { ok: false, message: `해당 위치에서 지적 필지를 찾지 못했습니다.${detail}` },
    { status: 404 }
  );
}
