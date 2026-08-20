import { NextRequest, NextResponse } from "next/server";

const BASE = "https://apis.data.go.kr/1613000/arLandUseInfoService";

type XmlRow = Record<string, string>;
type Decision = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW";
type RevenueGroup =
  | "OFFICE"
  | "RETAIL"
  | "LOGISTICS_WAREHOUSE"
  | "RESIDENTIAL"
  | "HOSPITALITY"
  | "HEALTHCARE"
  | "EDUCATION_RESEARCH"
  | "INDUSTRIAL_MANUFACTURING"
  | "DATA_CENTER"
  | "MIXED_USE";
type Group = RevenueGroup | "PUBLIC";

type FacilitySpec = {
  key: string;
  label: string;
  group: Group;
  keywords: string[];
};

type Evidence = {
  activityName: string;
  decisionRaw: string;
  condition: string | null;
  legalBasis: string | null;
  confidence: number;
};

type FacilityResult = {
  key: string;
  label: string;
  group: Group;
  decision: Decision;
  reason: string;
  confidence: number;
  activityCode: string | null;
  activityName: string | null;
  evidence: Evidence[];
};

const FACILITIES: FacilitySpec[] = [
  { key: "OFFICE_GENERAL", label: "오피스", group: "OFFICE", keywords: ["업무시설", "일반업무시설", "사무소"] },
  { key: "RETAIL", label: "리테일", group: "RETAIL", keywords: ["판매시설", "소매점", "상점", "근린생활시설"] },
  { key: "LOGISTICS_WAREHOUSE", label: "물류/창고", group: "LOGISTICS_WAREHOUSE", keywords: ["창고시설", "물류시설", "창고", "물류터미널"] },
  { key: "RESIDENTIAL", label: "주거", group: "RESIDENTIAL", keywords: ["공동주택", "주택", "기숙사", "도시형생활주택"] },
  { key: "HOSPITALITY", label: "숙박", group: "HOSPITALITY", keywords: ["숙박시설", "호텔", "관광숙박시설", "생활숙박시설"] },
  { key: "HEALTHCARE", label: "의료/헬스케어", group: "HEALTHCARE", keywords: ["의료시설", "병원", "의원", "요양병원"] },
  { key: "EDUCATION_RESEARCH", label: "교육/연구", group: "EDUCATION_RESEARCH", keywords: ["교육연구시설", "학교", "연구소", "학원"] },
  { key: "INDUSTRIAL_MANUFACTURING", label: "산업/제조", group: "INDUSTRIAL_MANUFACTURING", keywords: ["공장", "산업시설", "제조시설", "지식산업센터"] },
  { key: "DATA_CENTER", label: "데이터센터", group: "DATA_CENTER", keywords: ["데이터센터", "전산센터", "방송통신시설"] },
  { key: "MIXED_USE", label: "복합용도", group: "MIXED_USE", keywords: ["복합시설", "주상복합", "복합건축물"] },
  { key: "PUBLIC_OFFICE", label: "공공업무시설", group: "PUBLIC", keywords: ["공공업무시설", "공공청사", "청사"] },
  { key: "PUBLIC_EDUCATION_RESEARCH", label: "교육연구시설", group: "PUBLIC", keywords: ["교육연구시설", "학교", "연구소"] },
  { key: "CULTURE_ASSEMBLY", label: "문화 및 집회시설", group: "PUBLIC", keywords: ["문화및집회시설", "문화 및 집회시설", "공연장", "집회장"] },
  { key: "PUBLIC_MEDICAL", label: "의료시설", group: "PUBLIC", keywords: ["의료시설", "병원"] },
  { key: "WELFARE", label: "노유자시설", group: "PUBLIC", keywords: ["노유자시설", "사회복지시설"] },
  { key: "SPORTS", label: "운동시설", group: "PUBLIC", keywords: ["운동시설", "체육관"] },
];

function serviceKey(): string {
  const raw = process.env.DATA_GO_KR_API_KEY ?? process.env.PUBLIC_DATA_API_KEY ?? "";
  const trimmed = raw.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseItems(xml: string): XmlRow[] {
  const result: XmlRow[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const chunk = itemMatch[1] ?? "";
    const row: XmlRow = {};
    const fieldRegex = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let fieldMatch: RegExpExecArray | null;

    while ((fieldMatch = fieldRegex.exec(chunk)) !== null) {
      const key = fieldMatch[1] ?? "";
      const value = fieldMatch[2] ?? "";
      if (key) row[key] = decodeXml(value);
    }
    result.push(row);
  }
  return result;
}

function compact(value: string): string {
  return value.replace(/\s+/g, "").replace(/[·ㆍ,()]/g, "").trim();
}

function rowText(row: XmlRow): string {
  return Object.values(row).filter(Boolean).join(" ");
}

function pick(row: XmlRow, keys: string[]): string {
  for (const key of keys) {
    const direct = row[key];
    if (direct && direct.trim()) return direct.trim();
    for (const [name, value] of Object.entries(row)) {
      if (name.toLowerCase() === key.toLowerCase() && value.trim()) return value.trim();
    }
  }
  return "";
}

function activityCode(row: XmlRow): string {
  return pick(row, ["lunCd", "LUN_CD", "lun_code", "luncd", "actCd", "ACT_CD", "actCode", "lndUseActCd"]);
}

function activityName(row: XmlRow): string {
  return pick(row, ["lunNm", "luname", "lunName", "actNm", "actName", "lndUseActNm", "name"]) || rowText(row).slice(0, 240);
}

function scoreFacility(row: XmlRow, facility: FacilitySpec): number {
  const text = compact(rowText(row));
  let score = 0;
  for (const keyword of facility.keywords) {
    const normalized = compact(keyword);
    if (text.includes(normalized)) score += normalized.length;
  }
  return score;
}

function inferDecision(row: XmlRow): { decision: Decision; confidence: number; raw: string } {
  const raw = pick(row, ["prmisnAt", "posblAt", "prmisnYn", "useAt", "result", "allowYn", "permitYn", "limitCn", "reglCn", "contents", "lawCn", "detailCn", "cn"]) || rowText(row);
  const text = raw.replace(/\s+/g, " ");

  if (/(불가|불허|금지|허용하지\s*않|할\s*수\s*없|건축할\s*수\s*없)/.test(text)) return { decision: "PROHIBITED", confidence: 0.95, raw };
  if (/(조건|심의|허가|협의|승인|위원회|조례|별표|제한|예외|경우에\s*한)/.test(text)) return { decision: "CONDITIONAL", confidence: 0.78, raw };
  if (/(가능|허용|할\s*수\s*있|건축할\s*수\s*있|허용함)/.test(text)) return { decision: "ALLOWED", confidence: 0.9, raw };
  return { decision: "REVIEW", confidence: 0.4, raw };
}

function decisionRank(decision: Decision): number {
  if (decision === "PROHIBITED") return 4;
  if (decision === "CONDITIONAL") return 3;
  if (decision === "ALLOWED") return 2;
  return 1;
}

async function callApi(path: "DTsearchLunCd" | "DTarLandUseInfo", params: Record<string, string>, key: string): Promise<XmlRow[]> {
  const query = new URLSearchParams({ ...params, serviceKey: key });
  if (!query.has("numOfRows")) query.set("numOfRows", "1000");
  if (!query.has("pageNo")) query.set("pageNo", "1");

  const response = await fetch(`${BASE}/${path}?${query.toString()}`, { cache: "no-store", headers: { Accept: "application/xml,text/xml,*/*" } });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  if (/<resultCode>(?:20|30|31)<\/resultCode>/i.test(raw) || /SERVICE_(?:ACCESS_DENIED|KEY_IS_NOT_REGISTERED|KEY_IS_NULL)/i.test(raw)) {
    throw new Error("공공데이터포털 인증키 또는 활용신청 상태를 확인해야 합니다.");
  }
  return parseItems(raw);
}

async function loadActivityCatalog(key: string): Promise<XmlRow[]> {
  const attempts: Record<string, string>[] = [{}, { searchKeyword: "시설" }, { keyword: "시설" }, { lunNm: "시설" }, { luname: "시설" }];
  let best: XmlRow[] = [];
  for (const params of attempts) {
    try {
      const rows = await callApi("DTsearchLunCd", params, key);
      if (rows.length > best.length) best = rows;
      if (rows.length >= 20) break;
    } catch {
      // legacy endpoint parameter variants
    }
  }
  return best;
}

async function analyzeFacility(facility: FacilitySpec, catalog: XmlRow[], sigunguCode: string, zoneName: string, key: string): Promise<FacilityResult> {
  let selectedRow: XmlRow | null = null;
  let selectedCode = "";
  let bestScore = 0;

  for (const row of catalog) {
    const code = activityCode(row);
    const score = scoreFacility(row, facility);
    if (code && score > bestScore) {
      bestScore = score;
      selectedRow = row;
      selectedCode = code;
    }
  }

  if (!selectedRow || !selectedCode) {
    return { key: facility.key, label: facility.label, group: facility.group, decision: "REVIEW", reason: "토지이용행위 코드 자동 매칭 결과가 없어 추가 확인이 필요합니다.", confidence: 0.25, activityCode: null, activityName: null, evidence: [] };
  }

  let rows: XmlRow[] = [];
  const attempts: Record<string, string>[] = [
    { sigunguCd: sigunguCode, lunCd: selectedCode },
    { sigunguCode, lunCd: selectedCode },
    { sigunguCd: sigunguCode, luncd: selectedCode },
  ];
  for (const params of attempts) {
    try {
      rows = await callApi("DTarLandUseInfo", params, key);
      if (rows.length) break;
    } catch {
      // compatibility spelling fallback
    }
  }

  let relevantRows = rows;
  if (zoneName && rows.length) {
    const target = compact(zoneName);
    const matched = rows.filter((row) => compact(rowText(row)).includes(target));
    if (matched.length) relevantRows = matched;
  }

  if (!relevantRows.length) {
    return { key: facility.key, label: facility.label, group: facility.group, decision: "REVIEW", reason: "해당 시군구·행위 조합의 행위제한 응답을 확인하지 못했습니다.", confidence: 0.3, activityCode: selectedCode, activityName: activityName(selectedRow), evidence: [] };
  }

  const interpreted = relevantRows.map((row) => ({ row, inferred: inferDecision(row) }));
  interpreted.sort((a, b) => decisionRank(b.inferred.decision) - decisionRank(a.inferred.decision));
  const strongest = interpreted[0];
  if (!strongest) {
    return { key: facility.key, label: facility.label, group: facility.group, decision: "REVIEW", reason: "판정 가능한 응답이 없습니다.", confidence: 0.2, activityCode: selectedCode, activityName: activityName(selectedRow), evidence: [] };
  }

  const zoneMatched = zoneName ? relevantRows.some((row) => compact(rowText(row)).includes(compact(zoneName))) : false;
  const confidence = Math.max(0.2, Math.min(0.98, strongest.inferred.confidence * (zoneName && !zoneMatched ? 0.75 : 1)));
  const evidence: Evidence[] = interpreted.slice(0, 3).map(({ row, inferred }) => ({
    activityName: activityName(row),
    decisionRaw: inferred.raw.slice(0, 1200),
    condition: pick(row, ["limitCn", "reglCn", "condition", "cnstrCn", "detailCn", "contents", "cn"]) || null,
    legalBasis: pick(row, ["lawNm", "lawCn", "lawArticle", "ordinanceCn", "relateLaw", "lawName"]) || null,
    confidence: inferred.confidence,
  }));

  return {
    key: facility.key,
    label: facility.label,
    group: facility.group,
    decision: strongest.inferred.decision,
    reason: strongest.inferred.raw.slice(0, 600) || "행위제한 원문 확인 필요",
    confidence,
    activityCode: selectedCode,
    activityName: activityName(selectedRow),
    evidence,
  };
}

export async function GET(request: NextRequest) {
  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  const zoneName = request.nextUrl.searchParams.get("zoneName")?.trim() ?? "";
  const key = serviceKey();

  if (!/^\d{19}$/.test(pnu)) return NextResponse.json({ ok: false, message: "19자리 PNU가 필요합니다." }, { status: 400 });
  if (!key) return NextResponse.json({ ok: false, code: "NO_PUBLIC_DATA_KEY", message: "DATA_GO_KR_API_KEY가 설정되지 않았습니다." }, { status: 503 });

  const sigunguCode = pnu.slice(0, 5);
  const queriedAt = new Date().toISOString();

  try {
    const catalog = await loadActivityCatalog(key);
    const facilities: FacilityResult[] = [];
    for (const facility of FACILITIES) {
      facilities.push(await analyzeFacility(facility, catalog, sigunguCode, zoneName, key));
    }

    return NextResponse.json({
      ok: true,
      query: { pnu, sigunguCode, zoneName },
      facilities,
      diagnostics: { activityCatalogCount: catalog.length, matchedFacilityCount: facilities.filter((facility) => facility.activityCode !== null).length },
      source: {
        code: "MOLIT_LANDUSE_RESTRICTION",
        name: "국토교통부 토지이용규제정보서비스",
        endpoints: ["DTsearchLunCd", "DTarLandUseInfo"],
        baseDate: queriedAt.slice(0, 10),
        queriedAt,
        note: "공공데이터 원문을 정규화한 1차 판정입니다. 조건·예외·조례·지구단위계획이 있으면 원문 및 법령정보 추가 확인이 필요합니다.",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, code: "ALLOWED_USE_UPSTREAM_ERROR", message: error instanceof Error ? error.message : "토지이용규제정보 조회 중 오류가 발생했습니다." }, { status: 502 });
  }
}
