import { NextRequest, NextResponse } from "next/server";
import { fetchPublicDataXml, publicDataServiceKey, type XmlRow } from "../lib/public-data";

// 2026-11-16: 주거 임대료를 시군구 평균(한국부동산원)이 아니라 실거래로 산정하기 위한 적재용 조회.
// 국토부 아파트·오피스텔 전월세 실거래가를 시군구(LAWD_CD 5자리) × 최근 N개월로 불러와
// 건축년도, 전용면적, 보증금, 월세를 정리해 돌려준다. 결과는 DB(housing_rent_transaction)에 적재해 쓴다.
// 외부 API는 조회용이 아니라 적재용이라는 원칙에 따라 보고서는 이 라우트를 직접 부르지 않는다.

const SOURCES = {
  APT: { base: "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent", path: "getRTMSDataSvcAptRent", name: "국토교통부 아파트 전월세 실거래가" },
  OFFI: { base: "https://apis.data.go.kr/1613000/RTMSDataSvcOffiRent", path: "getRTMSDataSvcOffiRent", name: "국토교통부 오피스텔 전월세 실거래가" },
  RH: { base: "https://apis.data.go.kr/1613000/RTMSDataSvcRHRent", path: "getRTMSDataSvcRHRent", name: "국토교통부 연립다세대 전월세 실거래가" },
  // 단독/다가구는 전용면적이 아니라 계약면적만 공개된다. 단가 비교 시 별도 표시한다.
  SH: { base: "https://apis.data.go.kr/1613000/RTMSDataSvcSHRent", path: "getRTMSDataSvcSHRent", name: "국토교통부 단독/다가구 전월세 실거래가" },
} as const;

type SourceType = keyof typeof SOURCES;

const toNumber = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

function recentMonths(count: number) {
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function normalize(row: XmlRow, type: SourceType, lawdCd: string) {
  const year = row.dealYear ?? row["년"];
  const month = row.dealMonth ?? row["월"];
  const day = row.dealDay ?? row["일"];
  return {
    property_type: type,
    lawd_cd: row.sggCd || lawdCd,
    umd_nm: row.umdNm ?? row["법정동"] ?? null,
    jibun: row.jibun ?? row["지번"] ?? null,
    complex_name: (row.aptNm ?? row.offiNm ?? row.mhouseNm ?? row["아파트"] ?? row["단지명"] ?? row["연립다세대"] ?? null),
    house_type: row.houseType ?? row["주택유형"] ?? null,
    build_year: toNumber(row.buildYear ?? row["건축년도"]),
    exclusive_area_sqm: toNumber(row.excluUseAr ?? row["전용면적"] ?? row.contractArea ?? row["계약면적"]),
    area_basis: row.excluUseAr || row["전용면적"] ? "EXCLUSIVE" : "CONTRACT",
    floor: toNumber(row.floor ?? row["층"]),
    deposit_manwon: toNumber(row.deposit ?? row["보증금액"]),
    monthly_rent_manwon: toNumber(row.monthlyRent ?? row["월세금액"]),
    contract_type: row.contractType ?? null,
    contract_term: row.contractTerm ?? null,
    deal_date: year && month && day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null,
  };
}

export async function GET(request: NextRequest) {
  const lawdCd = request.nextUrl.searchParams.get("lawdCd")?.trim() ?? "";
  const months = Math.min(24, Math.max(1, Number(request.nextUrl.searchParams.get("months")) || 12));
  const typeParam = (request.nextUrl.searchParams.get("type") ?? "APT").toUpperCase();
  const type: SourceType = (["APT", "OFFI", "RH", "SH"] as const).includes(typeParam as SourceType) ? (typeParam as SourceType) : "APT";
  const key = publicDataServiceKey();

  if (!/^\d{5}$/.test(lawdCd)) {
    return NextResponse.json({ ok: false, message: "5자리 시군구 코드(lawdCd)가 필요합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, message: "DATA_GO_KR_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  }

  const source = SOURCES[type];
  const rows: ReturnType<typeof normalize>[] = [];
  const errors: string[] = [];

  for (const dealYmd of recentMonths(months)) {
    let page = 1;
    // 월별로 1,000건씩 페이지를 넘긴다.
    for (;;) {
      try {
        const result = await fetchPublicDataXml(
          source.base,
          source.path,
          { LAWD_CD: lawdCd, DEAL_YMD: dealYmd, numOfRows: "1000", pageNo: String(page) },
          key
        );
        rows.push(...result.rows.map((row) => normalize(row, type, lawdCd)));
        if (result.rows.length < 1000 || page * 1000 >= result.totalCount) break;
        page += 1;
      } catch (error) {
        errors.push(`${dealYmd}: ${error instanceof Error ? error.message : "조회 실패"}`);
        break;
      }
    }
  }

  return NextResponse.json({
    ok: rows.length > 0,
    source: { name: source.name, endpoint: `${source.path}`, queriedAt: new Date().toISOString() },
    query: { lawdCd, months, type },
    count: rows.length,
    errors,
    rows,
  });
}
