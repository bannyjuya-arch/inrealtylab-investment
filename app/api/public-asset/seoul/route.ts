import { NextRequest, NextResponse } from "next/server";

const SEOUL_ASSET_URL =
  "https://api.odcloud.kr/api/15080627/v1/uddi:2fc0c025-b2b7-435e-ac3f-d1237420776d";
const SOURCE_DATA_DATE = "2023-12-21";

type SeoulAssetRow = Record<string, unknown>;

type KeyConfig = {
  key: string;
  source: "PUBLIC_DATA_API_KEY" | "MOLIT_LANDLAW_API_KEY" | "MOLIT_LANDUSE_API_KEY" | "NONE";
};

function asText(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function normalize(value: string) {
  return value
    .replace(/^서울특별시\s*/, "")
    .replace(/\s+/g, "")
    .replace(/[(),]/g, "")
    .trim();
}

function decodeServiceKey(raw: string) {
  const trimmed = raw.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function serviceKey(): KeyConfig {
  const candidates: Array<[KeyConfig["source"], string | undefined]> = [
    ["PUBLIC_DATA_API_KEY", process.env.PUBLIC_DATA_API_KEY],
    ["MOLIT_LANDLAW_API_KEY", process.env.MOLIT_LANDLAW_API_KEY],
    ["MOLIT_LANDUSE_API_KEY", process.env.MOLIT_LANDUSE_API_KEY],
  ];

  for (const [source, raw] of candidates) {
    if (raw?.trim()) return { key: decodeServiceKey(raw), source };
  }

  return { key: "", source: "NONE" };
}

function safeText(raw: string, key: string) {
  return raw
    .replace(/\s+/g, " ")
    .replaceAll(key, "[SERVICE_KEY]")
    .replaceAll(encodeURIComponent(key), "[SERVICE_KEY]")
    .slice(0, 350);
}

function normalizeRow(row: SeoulAssetRow) {
  return {
    district: asText(row["구분"]),
    assetKind: asText(row["재산"]),
    location: asText(row["소재지"]),
    landCategory: asText(row["지목"]),
    areaSqm: Number(asText(row["(연)면적"]).replace(/,/g, "")) || null,
    manager: asText(row["재산관리관"]),
  };
}

export async function GET(request: NextRequest) {
  const legalDong = request.nextUrl.searchParams.get("legalDong")?.trim() ?? "";
  const jibun = request.nextUrl.searchParams.get("jibun")?.trim() ?? "";

  if (!legalDong.includes("서울") || !jibun) {
    return NextResponse.json(
      { ok: false, code: "NOT_SEOUL_OR_MISSING_ADDRESS", message: "서울 소재지와 지번이 필요합니다." },
      { status: 400 }
    );
  }

  const keyConfig = serviceKey();
  const key = keyConfig.key;
  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_PUBLIC_DATA_KEY",
        message: "공공데이터포털 서비스키가 없습니다. Vercel에 PUBLIC_DATA_API_KEY를 설정해 주세요.",
        keySource: keyConfig.source,
      },
      { status: 503 }
    );
  }

  const dong = legalDong.split(/\s+/).filter(Boolean).at(-1) ?? "";
  const searchTerm = `${dong} ${jibun}`.trim();
  const params = new URLSearchParams({
    page: "1",
    perPage: "100",
    serviceKey: key,
    "cond[소재지::LIKE]": searchTerm,
  });

  try {
    const response = await fetch(`${SEOUL_ASSET_URL}?${params.toString()}`, { cache: "no-store" });
    const raw = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: response.status === 401 ? "SEOUL_ASSET_INVALID_KEY" : "SEOUL_ASSET_UPSTREAM_ERROR",
          message: `서울시 시유재산 조회 실패 (HTTP ${response.status}): ${safeText(raw, key)}`,
          keySource: keyConfig.source,
        },
        { status: 502 }
      );
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "SEOUL_ASSET_PARSE_ERROR",
          message: `서울시 시유재산 응답 파싱 실패: ${safeText(raw, key)}`,
          keySource: keyConfig.source,
        },
        { status: 502 }
      );
    }

    const rows = Array.isArray(payload?.data) ? payload.data.map(normalizeRow) : [];
    const target = normalize(`${legalDong} ${jibun}`);
    const matched = rows.filter((row: ReturnType<typeof normalizeRow>) => {
      const location = normalize(row.location);
      return location.includes(normalize(`${dong}${jibun}`)) || target.includes(location) || location.includes(target);
    });

    const best = matched[0] ?? rows[0] ?? null;

    return NextResponse.json({
      ok: true,
      matched: Boolean(best),
      ownerEntity: best ? "서울특별시" : null,
      asset: best,
      matchCount: matched.length || rows.length,
      confidence: best ? (matched.length ? "ADDRESS_MATCH" : "SEARCH_CANDIDATE") : "NO_MATCH",
      freshness: "REFERENCE_REVERIFY",
      source: {
        name: "서울특별시 시유재산 현황",
        provider: "서울특별시",
        dataDate: SOURCE_DATA_DATE,
        note: "1회성 공개자료이므로 현재 관리관·재산상태는 최신 확인이 필요합니다.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "SEOUL_ASSET_FETCH_ERROR",
        message: error instanceof Error ? error.message : "서울시 시유재산 조회 중 오류가 발생했습니다.",
        keySource: keyConfig.source,
      },
      { status: 502 }
    );
  }
}
