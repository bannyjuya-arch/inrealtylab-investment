import { NextRequest, NextResponse } from "next/server";

const VWORLD_DATA_URL = "https://api.vworld.kr/req/data";

const LAYERS = [
  { id: "LT_C_UQ111", category: "zone", label: "도시지역" },
  { id: "LT_C_UQ112", category: "zone", label: "관리지역" },
  { id: "LT_C_UQ113", category: "zone", label: "농림지역" },
  { id: "LT_C_UQ114", category: "zone", label: "자연환경보전지역" },
  { id: "LT_C_UQ121", category: "district", label: "경관지구" },
  { id: "LT_C_UQ123", category: "district", label: "고도지구" },
  { id: "LT_C_UQ124", category: "district", label: "방화지구" },
  { id: "LT_C_UQ125", category: "district", label: "방재지구" },
  { id: "LT_C_UQ126", category: "district", label: "보호지구" },
  { id: "LT_C_UQ128", category: "district", label: "취락지구" },
  { id: "LT_C_UQ129", category: "district", label: "개발진흥지구" },
  { id: "LT_C_UQ130", category: "district", label: "특정용도제한지구" },
  { id: "LT_C_UD801", category: "area", label: "개발제한구역" },
  { id: "LT_C_UQ162", category: "area", label: "도시자연공원구역" },
  { id: "LT_C_UQ141", category: "extra", label: "토지거래허가구역" },
  { id: "LT_C_UPISUQ161", category: "plan", label: "지구단위계획구역" },
  { id: "LT_C_UPISUQ171", category: "restriction", label: "개발행위허가제한지역" },
] as const;

type ZoneLimit = { bcrMax: number; farMin: number; farMax: number };

const ZONE_LIMITS: Record<string, ZoneLimit> = {
  "제1종전용주거지역": { bcrMax: 50, farMin: 50, farMax: 100 },
  "제2종전용주거지역": { bcrMax: 50, farMin: 50, farMax: 150 },
  "제1종일반주거지역": { bcrMax: 60, farMin: 100, farMax: 200 },
  "제2종일반주거지역": { bcrMax: 60, farMin: 100, farMax: 250 },
  "제3종일반주거지역": { bcrMax: 50, farMin: 100, farMax: 300 },
  "준주거지역": { bcrMax: 70, farMin: 200, farMax: 500 },
  "중심상업지역": { bcrMax: 90, farMin: 200, farMax: 1500 },
  "일반상업지역": { bcrMax: 80, farMin: 200, farMax: 1300 },
  "근린상업지역": { bcrMax: 70, farMin: 200, farMax: 900 },
  "유통상업지역": { bcrMax: 80, farMin: 200, farMax: 1100 },
  "전용공업지역": { bcrMax: 70, farMin: 150, farMax: 300 },
  "일반공업지역": { bcrMax: 70, farMin: 150, farMax: 350 },
  "준공업지역": { bcrMax: 70, farMin: 150, farMax: 400 },
  "보전녹지지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "생산녹지지역": { bcrMax: 20, farMin: 50, farMax: 100 },
  "자연녹지지역": { bcrMax: 20, farMin: 50, farMax: 100 },
  "보전관리지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "생산관리지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "계획관리지역": { bcrMax: 40, farMin: 50, farMax: 100 },
  "농림지역": { bcrMax: 20, farMin: 50, farMax: 80 },
  "자연환경보전지역": { bcrMax: 20, farMin: 50, farMax: 80 },
};

function compact(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function pickName(properties: Record<string, unknown>, fallback: string) {
  const keys = ["uname", "name", "zonename", "e_name", "dname", "title", "nm", "zone_name", "dan_name", "cat_nam", "dgm_nm", "upj_name"];
  for (const key of keys) {
    const value = properties[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function findZoneLimit(name: string) {
  const normalized = compact(name);
  const matched = Object.entries(ZONE_LIMITS).find(([zone]) => normalized.includes(compact(zone)));
  return matched ? { zoneName: matched[0], ...matched[1] } : null;
}

async function queryLayer(
  layer: (typeof LAYERS)[number],
  lon: number,
  lat: number,
  key: string,
  domain: string
) {
  const params = new URLSearchParams({
    service: "data",
    request: "GetFeature",
    data: layer.id,
    key,
    domain,
    format: "json",
    size: "10",
    geometry: "false",
    geomFilter: `POINT(${lon} ${lat})`,
  });

  try {
    const response = await fetch(`${VWORLD_DATA_URL}?${params.toString()}`, { cache: "no-store" });
    const text = await response.text();
    if (!response.ok) {
      return { layer, hits: [], error: `HTTP ${response.status}` };
    }

    let payload: any;
    try {
      payload = JSON.parse(text);
    } catch {
      return { layer, hits: [], error: "응답 파싱 실패" };
    }

    const apiResponse = payload?.response;
    if (apiResponse?.status === "NOT_FOUND") return { layer, hits: [], error: null };
    if (apiResponse?.status !== "OK") {
      const code = apiResponse?.error?.code ?? apiResponse?.status ?? "UNKNOWN";
      const message = apiResponse?.error?.text ?? "VWorld 조회 실패";
      return { layer, hits: [], error: `${code}: ${message}` };
    }

    const features = apiResponse?.result?.featureCollection?.features ?? [];
    const hits = features.map((feature: any) => {
      const properties = feature?.properties ?? {};
      return {
        layer: layer.id,
        category: layer.category,
        label: layer.label,
        name: pickName(properties, layer.label),
        designationYear: properties?.dyear ? String(properties.dyear) : null,
        designationNumber: properties?.dnum ? String(properties.dnum) : null,
      };
    });

    return { layer, hits, error: null };
  } catch (error) {
    return { layer, hits: [], error: error instanceof Error ? error.message : "네트워크 오류" };
  }
}

export async function GET(req: NextRequest) {
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const pnu = req.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  const key = process.env.VWORLD_API_KEY?.trim();
  const domain = process.env.VWORLD_API_DOMAIN?.trim();

  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return NextResponse.json({ ok: false, message: "유효한 좌표가 필요합니다." }, { status: 400 });
  }
  if (!key || !domain) {
    return NextResponse.json(
      { ok: false, message: "VWORLD_API_KEY 또는 VWORLD_API_DOMAIN 환경변수가 없습니다." },
      { status: 503 }
    );
  }

  const results = await Promise.all(LAYERS.map((layer) => queryLayer(layer, lon, lat, key, domain)));
  const hits = results.flatMap((result) => result.hits);
  const errors = results
    .filter((result) => result.error)
    .map((result) => ({ layer: result.layer.id, label: result.layer.label, message: result.error }));

  const byCategory = (category: string) => hits.filter((hit) => hit.category === category);
  const useZones = byCategory("zone");
  const primaryZoneHit = useZones.find((hit) => findZoneLimit(hit.name));
  const statutoryLimit = primaryZoneHit ? findZoneLimit(primaryZoneHit.name) : null;

  const warnings: string[] = [];
  if (!useZones.length) warnings.push("용도지역 공간중첩 결과를 찾지 못했습니다.");
  if (useZones.length && !statutoryLimit) warnings.push("세부 용도지역을 특정하지 못해 건폐율·용적률 법정상한을 계산하지 않았습니다.");
  if (byCategory("plan").length) warnings.push("지구단위계획구역입니다. 지구단위계획 결정도서가 건폐율·용적률을 별도로 정할 수 있으므로 추가 확인이 필요합니다.");
  if (byCategory("restriction").length) warnings.push("개발행위허가제한지역 중첩이 확인됩니다. 개발행위 가능 여부를 별도로 검토해야 합니다.");

  return NextResponse.json({
    ok: true,
    pnu,
    queriedAt: new Date().toISOString(),
    regulation: {
      useZones,
      districts: byCategory("district"),
      areas: byCategory("area"),
      districtPlans: byCategory("plan"),
      developmentRestrictions: byCategory("restriction"),
      landTransactionPermit: byCategory("extra"),
      primaryZone: primaryZoneHit?.name ?? null,
      statutoryLimit: statutoryLimit
        ? {
            ...statutoryLimit,
            legalBasis: "국토의 계획 및 이용에 관한 법률 시행령 제84조·제85조",
            effectiveDate: "2026-07-01",
            scope: "국가 법정범위 상한. 지자체 조례·지구단위계획·개별법 규제 미반영",
          }
        : null,
      warnings,
      layerErrors: errors,
    },
    source: {
      spatial: "VWorld 용도지역지구/도시계획 주제도",
      statutory: "국토의 계획 및 이용에 관한 법률 시행령 제84조·제85조",
      statutoryEffectiveDate: "2026-07-01",
    },
  });
}
