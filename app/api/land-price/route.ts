import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

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
    const entry = Object.entries(record).find(
      ([name, value]) => name.toLowerCase() === key.toLowerCase() && text(value)
    );
    if (entry) return entry[1];
  }
  return null;
}

function safeSnippet(raw: string, key: string) {
  return raw.replace(/\s+/g, " ").replaceAll(key, "[KEY]").slice(0, 400);
}

async function fetchYear(pnu: string, year: number, key: string, domain: string) {
  const params = new URLSearchParams({
    key, domain, pnu, stdrYear: String(year),
    format: "json", numOfRows: "100", pageNo: "1",
  });
  const response = await fetch(`${LAND_PRICE_URL}?${params.toString()}`, { cache: "no-store" });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`VWorld 호출 실패 (HTTP ${response.status}): ${safeSnippet(raw, key)}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`VWorld 응답 파싱 실패: ${safeSnippet(raw, key)}`);
  }
  const records = collectPriceRecords(payload);
  const normalized = records
    .map((record) => ({
      pricePerSqm: numberValue(pick(record, ["pblntfPclnd", "pblntfPclndPrice", "landPrice", "price"])),
      standardYear: text(pick(record, ["stdrYear", "stdrYm", "baseYear", "year"])) || String(year),
      legalDong: text(pick(record, ["ldCodeNm", "ldCodeName", "legalDong"])),
      jibun: text(pick(record, ["mnnmSlno", "jibun"])),
    }))
    .filter((record) => record.pricePerSqm !== null && record.pricePerSqm >= 0);
  return normalized[0] ?? null;
}

type FallbackRow = {
  pnu: string;
  sigungu: string | null;
  bjdong: string | null;
  price_per_sqm: number | null;
  base_year: number | null;
};

async function fetchFromSupabase(pnu: string): Promise<FallbackRow | null> {
  const { url } = supabasePublicConfig();
  const endpoint =
    `${url}/rest/v1/land_price_official?pnu=eq.${encodeURIComponent(pnu)}` +
    `&select=pnu,sigungu,bjdong,price_per_sqm,base_year&limit=1`;
  const response = await fetch(endpoint, {
    headers: supabasePublicHeaders({ Accept: "application/json" }),
    cache: "no-store",
  });
  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`공시지가 DB 조회 실패 (HTTP ${response.status}): ${raw.slice(0, 200)}`);
  }
  const rows = (await response.json()) as FallbackRow[];
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.price_per_sqm === null || row.price_per_sqm === undefined) return null;
  return row;
}

function supabaseResponse(pnu: string, row: FallbackRow, upstreamNote: string | null) {
  return NextResponse.json({
    ok: true,
    pnu,
    pricePerSqm: Number(row.price_per_sqm),
    standardYear: row.base_year === null ? null : String(row.base_year),
    legalDong: row.bjdong ?? null,
    jibun: null,
    fallback: true,
    upstreamNote,
    source: {
      name: "국토교통부 개별공시지가 공개자료",
      provider: "국토교통부 (Supabase 적재본)",
      endpoint: "land_price_official",
      unit: "원/㎡",
      queriedAt: new Date().toISOString(),
    },
  });
}

export async function GET(request: NextRequest) {
  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json(
      { ok: false, code: "PNU_REQUIRED", message: "19자리 PNU가 필요합니다." },
      { status: 400 }
    );
  }

  const key = process.env.VWORLD_API_KEY?.trim() ?? "";
  const domain = process.env.VWORLD_API_DOMAIN?.trim() ?? "";

  if (!key || !domain) {
    try {
      const row = await fetchFromSupabase(pnu);
      if (row) return supabaseResponse(pnu, row, "VWORLD 환경변수 미설정");
      return NextResponse.json({
        ok: true, pnu, pricePerSqm: null, standardYear: null,
        message: "VWorld 설정이 없고 DB 적재본에도 해당 필지가 없습니다. (서울특별시만 적재됨)",
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        code: "LAND_PRICE_FALLBACK_ERROR",
        message: error instanceof Error ? error.message : "공시지가 DB 조회 오류",
      }, { status: 502 });
    }
  }

  const requestedYear = Number(request.nextUrl.searchParams.get("year"));
  const nowYear = new Date().getFullYear();
  const firstYear =
    Number.isInteger(requestedYear) && requestedYear >= 2000 && requestedYear <= nowYear
      ? requestedYear : nowYear;
  const years = [firstYear, firstYear - 1, firstYear - 2];

  let upstreamNote: string | null = null;

  try {
    for (const year of years) {
      const record = await fetchYear(pnu, year, key, domain);
      if (!record) continue;
      return NextResponse.json({
        ok: true, pnu,
        pricePerSqm: record.pricePerSqm,
        standardYear: record.standardYear,
        legalDong: record.legalDong || null,
        jibun: record.jibun || null,
        fallback: false,
        source: {
          name: "국토교통부 개별공시지가정보",
          provider: "국토교통부 / VWorld",
          endpoint: "NED getIndvdLandPriceAttr",
          unit: "원/㎡",
          queriedAt: new Date().toISOString(),
        },
      });
    }
    upstreamNote = `${years.join(", ")}년 VWorld 응답에서 가격을 찾지 못함`;
  } catch (error) {
    upstreamNote = error instanceof Error ? error.message : "VWorld 조회 오류";
  }

  try {
    const row = await fetchFromSupabase(pnu);
    if (row) return supabaseResponse(pnu, row, upstreamNote);
  } catch (error) {
    return NextResponse.json({
      ok: false,
      code: "LAND_PRICE_FALLBACK_ERROR",
      message: `VWorld 실패 후 DB 폴백도 실패. VWorld: ${upstreamNote} / DB: ${
        error instanceof Error ? error.message : "알 수 없는 오류"
      }`,
    }, { status: 502 });
  }

  return NextResponse.json({
    ok: true, pnu, pricePerSqm: null, standardYear: null,
    message: `공시지가를 찾지 못했습니다. VWorld: ${upstreamNote} / DB 적재본에도 해당 필지 없음 (서울특별시만 적재됨)`,
    source: { name: "국토교통부 개별공시지가정보", provider: "국토교통부 / VWorld" },
  });
}