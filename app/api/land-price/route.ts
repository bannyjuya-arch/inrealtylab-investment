import { NextRequest, NextResponse } from "next/server";

const LAND_PRICE_URL = "https://api.vworld.kr/ned/data/getIndvdLandPriceAttr";

type JsonRecord = Record<string, unknown>;

function text(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function numberValue(value: unknown) {
  const normalized = text(value).replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectPriceRecords(value: unknown, output: JsonRecord[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPriceRecords(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;

  const record = value as JsonRecord;
  const hasPrice = Object.keys(record).some((key) =>
    ["pblntfPclnd", "pblntfPclndPrice", "landPrice", "price"].includes(key)
  );
  if (hasPrice) output.push(record);

  Object.values(record).forEach((child) => collectPriceRecords(child, output));
  return output;
}

function pick(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const direct = record[key];
    if (text(direct)) return direct;
    const entry = Object.entries(record).find(([name, value]) => name.toLowerCase() === key.toLowerCase() && text(value));
    if (entry) return entry[1];
  }
  return null;
}

function safeSnippet(raw: string, key: string) {
  return raw
    .replace(/\s+/g, " ")
    .replaceAll(key, "[VWORLD_KEY]")
    .replaceAll(encodeURIComponent(key), "[VWORLD_KEY]")
    .slice(0, 400);
}

async function fetchYear(pnu: string, year: number, key: string, domain: string) {
  const params = new URLSearchParams({
    key,
    domain,
    pnu,
    stdrYear: String(year),
    format: "json",
    numOfRows: "100",
    pageNo: "1",
  });

  const response = await fetch(`${LAND_PRICE_URL}?${params.toString()}`, { cache: "no-store" });
  const raw = await response.text();
  if (!response.ok) throw new Error(`VWorld 개별공시지가 호출 실패 (HTTP ${response.status}): ${safeSnippet(raw, key)}`);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`VWorld 개별공시지가 응답 파싱 실패: ${safeSnippet(raw, key)}`);
  }

  const records = collectPriceRecords(payload);
  const normalized = records
    .map((record) => ({
      pricePerSqm: numberValue(pick(record, ["pblntfPclnd", "pblntfPclndPrice", "landPrice", "price"])),
      standardYear: text(pick(record, ["stdrYear", "stdrYm", "baseYear", "year"])) || String(year),
      legalDong: text(pick(record, ["ldCodeNm", "ldCodeName", "legalDong"])),
      jibun: text(pick(record, ["mnnmSlno", "jibun"])),
      raw: record,
    }))
    .filter((record) => record.pricePerSqm !== null && record.pricePerSqm >= 0);

  return normalized[0] ?? null;
}

export async function GET(request: NextRequest) {
  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json({ ok: false, code: "PNU_REQUIRED", message: "19자리 PNU가 필요합니다." }, { status: 400 });
  }

  const key = process.env.VWORLD_API_KEY?.trim() ?? "";
  const domain = process.env.VWORLD_API_DOMAIN?.trim() ?? "";
  if (!key || !domain) {
    return NextResponse.json({ ok: false, code: "NO_VWORLD_CONFIG", message: "VWORLD_API_KEY 또는 VWORLD_API_DOMAIN 환경변수가 없습니다." }, { status: 503 });
  }

  const requestedYear = Number(request.nextUrl.searchParams.get("year"));
  const nowYear = new Date().getFullYear();
  const firstYear = Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= nowYear ? requestedYear : nowYear;
  const years = [firstYear, firstYear - 1, firstYear - 2];

  try {
    for (const year of years) {
      const record = await fetchYear(pnu, year, key, domain);
      if (!record) continue;
      return NextResponse.json({
        ok: true,
        pnu,
        pricePerSqm: record.pricePerSqm,
        standardYear: record.standardYear,
        legalDong: record.legalDong || null,
        jibun: record.jibun || null,
        source: {
          name: "국토교통부 개별공시지가정보",
          provider: "국토교통부 / VWorld",
          endpoint: "NED getIndvdLandPriceAttr",
          unit: "원/㎡",
          queriedAt: new Date().toISOString(),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      pnu,
      pricePerSqm: null,
      standardYear: null,
      message: `${years.join(", ")}년 개별공시지가 응답에서 가격을 찾지 못했습니다.`,
      source: { name: "국토교통부 개별공시지가정보", provider: "국토교통부 / VWorld", endpoint: "NED getIndvdLandPriceAttr" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "LAND_PRICE_UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "개별공시지가 조회 중 오류가 발생했습니다.",
    }, { status: 502 });
  }
}
