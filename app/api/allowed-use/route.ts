import { NextRequest, NextResponse } from "next/server";

const BASE = "https://apis.data.go.kr/1613000/arLandUseInfoService";

type XmlRow = Record<string, string>;
type Decision = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW";

type FacilitySpec = {
  key: string;
  label: string;
  group: "OFFICE" | "RETAIL" | "PUBLIC";
  keywords: string[];
};

const FACILITIES: FacilitySpec[] = [
  { key: "OFFICE_GENERAL", label: "업무시설", group: "OFFICE", keywords: ["업무시설", "일반업무시설", "사무소"] },
  { key: "RETAIL", label: "판매시설", group: "RETAIL", keywords: ["판매시설", "소매점", "상점"] },
  { key: "NEIGHBORHOOD_1", label: "제1종 근린생활시설", group: "RETAIL", keywords: ["제1종근린생활시설", "제1종 근린생활시설"] },
  { key: "NEIGHBORHOOD_2", label: "제2종 근린생활시설", group: "RETAIL", keywords: ["제2종근린생활시설", "제2종 근린생활시설"] },
  { key: "PUBLIC_OFFICE", label: "공공업무시설", group: "PUBLIC", keywords: ["공공업무시설", "공공청사", "청사"] },
  { key: "EDUCATION_RESEARCH", label: "교육연구시설", group: "PUBLIC", keywords: ["교육연구시설", "학교", "연구소"] },
  { key: "CULTURE_ASSEMBLY", label: "문화 및 집회시설", group: "PUBLIC", keywords: ["문화및집회시설", "문화 및 집회시설", "공연장", "집회장"] },
  { key: "MEDICAL", label: "의료시설", group: "PUBLIC", keywords: ["의료시설", "병원"] },
  { key: "WELFARE", label: "노유자시설", group: "PUBLIC", keywords: ["노유자시설", "사회복지시설"] },
  { key: "SPORTS", label: "운동시설", group: "PUBLIC", keywords: ["운동시설", "체육관"] },
];

function serviceKey() {
  const raw = process.env.DATA_GO_KR_API_KEY ?? process.env.PUBLIC_DATA_API_KEY ?? "";
  const trimmed = raw.trim();
  try { return decodeURIComponent(trimmed); } catch { return trimmed; }
}

function decodeXml(value: string) {
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
  const chunks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  return chunks.map((chunk) => {
    const row: XmlRow = {};
    for (const match of chunk.matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) {
      row[match[1]] = decodeXml(match[2]);
    }
    return row;
  });
}

function compact(value: string) {
  return value.replace(/\s+/g, "").replace(/[·ㆍ,()]/g, "").trim();
}

function rowText(row: XmlRow) {
  return Object.values(row).filter(Boolean).join(" ");
}

function pick(row: XmlRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct?.trim()) return direct.trim();
    const found = Object.entries(row).find(([name, value]) => name.toLowerCase() === key.toLowerCase() && value?.trim());
    if (found) return found[1].trim();
  }
  return "";
}

function extractActivityCode(row: XmlRow) {
  return pick(row, ["lunCd", "LUN_CD", "lun_code", "luncd", "actCd", "ACT_CD", "actCode", "lndUseActCd"]);
}

function extractActivityName(row: XmlRow) {
  return pick(row, ["lunNm", "luname", "lunName", "actNm", "actName", "lndUseActNm", "name"]) || rowText(row).slice(0, 240);
}

function scoreFacility(row: XmlRow, facility: FacilitySpec) {
  const hay = compact(rowText(row));
  return facility.keywords.reduce((score, keyword) => score + (hay.includes(compact(keyword)) ? compact(keyword).length : 0), 0);
}

function inferDecision(row: XmlRow): { decision: Decision; confidence: number; raw: string } {
  const raw = pick(row, [
    "prmisnAt", "posblAt", "prmisnYn", "useAt", "result", "allowYn", "permitYn",
    "limitCn", "reglCn", "contents", "lawCn", "detailCn", "cn",
  ]) || rowText(row);
  const text = raw.replace(/\s+/g, " ");

  if (/(불가|불허|금지|허용하지\s*않|할\s*수\s*없|건축할\s*수\s*없)/.test(text)) {
    return { decision: "PROHIBITED", confidence: 0.95, raw };
  }
  if (/(조건|심의|허가|협의|승인|위원회|조례|별표|제한|예외|경우에\s*한)/.test(text)) {
    return { decision: "CONDITIONAL", confidence: 0.78, raw };
  }
  if (/(가능|허용|할\s*수\s*있|건축할\s*수\s*있|허용함)/.test(text)) {
    return { decision: "ALLOWED", confidence: 0.9, raw };
  }
  return { decision: "REVIEW", confidence: 0.4, raw };
}

function decisionRank(decision: Decision) {
  return { PROHIBITED: 4, CONDITIONAL: 3, ALLOWED: 2, REVIEW: 1 }[decision];
}

async function callApi(path: "DTsearchLunCd" | "DTarLandUseInfo", params: Record<string, string>, key: string) {
  const query = new URLSearchParams({ ...params, serviceKey: key });
  if (!query.has("numOfRows")) query.set("numOfRows", "1000");
  if (!query.has("pageNo")) query.set("pageNo", "1");

  const response = await fetch(`${BASE}/${path}?${query.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/xml,text/xml,*/*" },
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  if (/<resultCode>(?:20|30|31)<\/resultCode>/i.test(raw) || /SERVICE_(?:ACCESS_DENIED|KEY_IS_NOT_REGISTERED|KEY_IS_NULL)/i.test(raw)) {
    throw new Error("공공데이터포털 인증키 또는 활용신청 상태를 확인해야 합니다.");
  }
  return parseItems(raw);
}

async function loadActivityCatalog(key: string) {
  const attempts: Record<string, string>[] = [
    {},
    { searchKeyword: "시설" },
    { keyword: "시설" },
    { lunNm: "시설" },
    { luname: "시설" },
  ];

  let best: XmlRow[] = [];
  for (const params of attempts) {
    try {
      const rows = await callApi("DTsearchLunCd", params, key);
      if (rows.length > best.length) best = rows;
      if (rows.length >= 20) break;
    } catch {
      // Different revisions of this legacy API have exposed slightly different search parameter names.
    }
  }
  return best;
}

function matchZoneRows(rows: XmlRow[], zoneName: string) {
  if (!zoneName) return rows;
  const target = compact(zoneName);
  const matched = rows.filter((row) => compact(rowText(row)).includes(target));
  return matched.length ? matched : rows;
}

function evidenceFrom(row: XmlRow, inferred: ReturnType<typeof inferDecision>) {
  const condition = pick(row, ["limitCn", "reglCn", "condition", "cnstrCn", "detailCn", "contents", "cn"]);
  const legalBasis = pick(row, ["lawNm", "lawCn", "lawArticle", "ordinanceCn", "relateLaw", "lawName"]);
  return {
    activityName: extractActivityName(row),
    decisionRaw: inferred.raw.slice(0, 1200),
    condition: condition || null,
    legalBasis: legalBasis || null,
    confidence: inferred.confidence,
  };
}

export async function GET(request: NextRequest) {
  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  const zoneName = request.nextUrl.searchParams.get("zoneName")?.trim() ?? "";
  const key = serviceKey();

  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json({ ok: false, message: "19자리 PNU가 필요합니다." }, { status: 400 });
  }
  if (!key) {
    return NextResponse.json({ ok: false, code: "NO_PUBLIC_DATA_KEY", message: "DATA_GO_KR_API_KEY가 설정되지 않았습니다." }, { status: 503 });
  }

  const sigunguCode = pnu.slice(0, 5);
  const queriedAt = new Date().toISOString();

  try {
    const catalog = await loadActivityCatalog(key);

    const facilities = await Promise.all(FACILITIES.map(async (facility) => {
      const candidates = catalog
        .map((row) => ({ row, score: scoreFacility(row, facility), code: extractActivityCode(row) }))
        .filter((item) => item.score > 0 && item.code)
        .sort((a, b) => b.score - a.score);

      const selected = candidates[0];
      if (!selected) {
        return {
          key: facility.key,
          label: facility.label,
          group: facility.group,
          decision: "REVIEW" as Decision,
          reason: "토지이용행위 코드 자동 매칭 결과가 없어 추가 확인이 필요합니다.",
          confidence: 0.25,
          activityCode: null,
          activityName: null,
          evidence: [],
        };
      }

      let rows: XmlRow[] = [];
      const restrictionAttempts = [
        { sigunguCd: sigunguCode, lunCd: selected.code },
        { sigunguCode, lunCd: selected.code },
        { sigunguCd: sigunguCode, luncd: selected.code },
      ];
      for (const params of restrictionAttempts) {
        try {
          rows = await callApi("DTarLandUseInfo", params, key);
          if (rows.length) break;
        } catch {
          // Try the next compatibility spelling.
        }
      }

      const relevantRows = matchZoneRows(rows, zoneName);
      if (!relevantRows.length) {
        return {
          key: facility.key,
          label: facility.label,
          group: facility.group,
          decision: "REVIEW" as Decision,
          reason: "해당 시군구·행위 조합의 행위제한 응답을 확인하지 못했습니다.",
          confidence: 0.3,
          activityCode: selected.code,
          activityName: extractActivityName(selected.row),
          evidence: [],
        };
      }

      const interpreted = relevantRows.map((row) => ({ row, inferred: inferDecision(row) }));
      interpreted.sort((a, b) => decisionRank(b.inferred.decision) - decisionRank(a.inferred.decision));
      const strongest = interpreted[0];
      const zoneMatched = zoneName ? relevantRows.some((row) => compact(rowText(row)).includes(compact(zoneName))) : false;
      const confidence = Math.max(0.2, Math.min(0.98, strongest.inferred.confidence * (zoneName && !zoneMatched ? 0.75 : 1)));

      return {
        key: facility.key,
        label: facility.label,
        group: facility.group,
        decision: strongest.inferred.decision,
        reason: strongest.inferred.raw.slice(0, 600) || "행위제한 원문 확인 필요",
        confidence,
        activityCode: selected.code,
        activityName: extractActivityName(selected.row),
        evidence: interpreted.slice(0, 3).map(({ row, inferred }) => evidenceFrom(row, inferred)),
      };
    }));

    return NextResponse.json({
      ok: true,
      query: { pnu, sigunguCode, zoneName },
      facilities,
      diagnostics: {
        activityCatalogCount: catalog.length,
        matchedFacilityCount: facilities.filter((facility) => facility.activityCode).length,
      },
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
    return NextResponse.json({
      ok: false,
      code: "ALLOWED_USE_UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "토지이용규제정보 조회 중 오류가 발생했습니다.",
    }, { status: 502 });
  }
}
