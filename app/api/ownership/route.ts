import { NextRequest, NextResponse } from "next/server";

const LAND_OWNERSHIP_URL = "https://api.vworld.kr/ned/data/getPossessionAttr";

type RawOwnership = Record<string, unknown>;

function asText(value: unknown) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function classifyOwner(ownerClass: string) {
  const value = ownerClass.replace(/[\s,]/g, "");

  if (value.includes("국유")) {
    return { sector: "PUBLIC", ownerType: "STATE", label: "국가" } as const;
  }
  if (
    value.includes("시도유") ||
    value.includes("시유") ||
    value.includes("도유") ||
    value.includes("군유") ||
    value.includes("구유") ||
    value.includes("공유") ||
    value.includes("지방자치")
  ) {
    return { sector: "PUBLIC", ownerType: "LOCAL_GOVERNMENT", label: "지방자치단체" } as const;
  }
  if (value.includes("공공기관") || value.includes("공기업")) {
    return { sector: "PUBLIC", ownerType: "PUBLIC_ENTITY", label: "공공기관·공기업" } as const;
  }
  if (value.includes("법인")) {
    return { sector: "PRIVATE", ownerType: "CORPORATION", label: "법인" } as const;
  }
  if (
    value.includes("개인") ||
    value.includes("사유") ||
    value.includes("종중") ||
    value.includes("종교") ||
    value.includes("외국인")
  ) {
    return { sector: "PRIVATE", ownerType: "INDIVIDUAL", label: "민간" } as const;
  }
  return { sector: "UNKNOWN", ownerType: "UNKNOWN", label: ownerClass || "확인 필요" } as const;
}

function normalizeRecord(record: RawOwnership) {
  const ownerClass = asText(record.posesnSeCodeNm) || "확인 필요";
  const classification = classifyOwner(ownerClass);

  return {
    pnu: asText(record.pnu),
    legalDong: asText(record.ldCodeNm),
    jibun: asText(record.mnnmSlno),
    landCategory: asText(record.lndcgrCodeNm),
    areaSqm: Number(asText(record.ndpclAr)) || null,
    officialLandPrice: Number(asText(record.pblntfPclnd)) || null,
    ownerCode: asText(record.posesnSeCode),
    ownerClass,
    ownerSector: classification.sector,
    ownerType: classification.ownerType,
    ownerTypeLabel: classification.label,
    nationalInstitutionClass: asText(record.nationInsttSeCodeNm) || null,
    ownershipChangeCause: asText(record.ownshipChgCauseCodeNm) || null,
    ownershipChangeDate: asText(record.ownshipChgDe) || null,
    coOwnerCount: Number(asText(record.cnrsPsnCo)) || 0,
    referenceMonth: asText(record.stdrYm) || null,
    dataDate: asText(record.lastUpdtDt) || null,
  };
}

function assess(records: ReturnType<typeof normalizeRecord>[]) {
  const ownerSectors = unique(records.map((record) => record.ownerSector));
  const ownerTypes = unique(records.map((record) => record.ownerType));
  const ownerClasses = unique(records.map((record) => record.ownerClass));
  const publicOnly = ownerSectors.length === 1 && ownerSectors[0] === "PUBLIC";
  const containsPrivate = ownerSectors.includes("PRIVATE");
  const unresolved = ownerSectors.includes("UNKNOWN") || !records.length;

  if (containsPrivate) {
    return {
      inScope: false,
      readiness: "OUT_OF_SCOPE_PRIVATE",
      headline: "민간소유 부지 — 현재 검토대상 제외",
      summary:
        "INRealtyLab의 소유·사업추진 가능성 분석은 현재 공공소유 부지를 대상으로 합니다. 민간소유가 포함된 필지는 후속 관리주체·PPP 분석을 진행하지 않습니다.",
      ownerClasses,
      ownerTypes,
      gates: [
        { key: "OWNERSHIP", label: "공공소유 여부", status: "FAIL", detail: ownerClasses.join(", ") },
      ],
      candidateRoutes: [],
      unresolved: [],
    };
  }

  if (unresolved || !publicOnly) {
    return {
      inScope: false,
      readiness: "OWNERSHIP_REVIEW_REQUIRED",
      headline: "공공소유 여부 확인 필요",
      summary: "소유구분이 명확히 공공으로 확인되기 전에는 사업추진 가능성 분석을 진행하지 않습니다.",
      ownerClasses,
      ownerTypes,
      gates: [
        { key: "OWNERSHIP", label: "공공소유 여부", status: "REVIEW", detail: ownerClasses.join(", ") || "조회 결과 없음" },
      ],
      candidateRoutes: [],
      unresolved: ["공공소유 여부"],
    };
  }

  let candidateRoutes: string[] = [];
  let governingRegime = "공공자산 관련 법령·기관 규정 확인";

  if (ownerTypes.includes("STATE")) {
    governingRegime = "국유재산법 체계 검토";
    candidateRoutes = ["행정재산 관리위탁 가능성 검토", "일반재산 개발·대부 가능성 검토", "민간투자법 적용 가능성 검토"];
  } else if (ownerTypes.includes("LOCAL_GOVERNMENT")) {
    governingRegime = "공유재산 및 물품 관리법 체계 검토";
    candidateRoutes = ["행정재산 관리위탁 가능성 검토", "일반재산 위탁관리·위탁개발 가능성 검토", "민간투자법 적용 가능성 검토"];
  } else if (ownerTypes.includes("PUBLIC_ENTITY")) {
    governingRegime = "해당 공공기관 설립법·정관·자산관리규정 검토";
    candidateRoutes = ["공공기관 자체개발", "민관 공동사업", "장기임대·사용수익 구조", "민간투자법 적용 가능성 검토"];
  }

  return {
    inScope: true,
    readiness: "CONDITIONAL_REVIEW",
    headline: "공공소유 확인 — 사업추진 구조 검토 가능",
    summary:
      "공공소유는 확인되었습니다. 관리주체, 재산구분, 현재 사용상태 및 의사결정권자를 확인한 뒤 실제 사업추진 방식과 PPP 적합성을 판정합니다.",
    governingRegime,
    ownerClasses,
    ownerTypes,
    gates: [
      { key: "OWNERSHIP", label: "공공소유 여부", status: "PASS", detail: ownerClasses.join(", ") },
      { key: "MANAGER", label: "관리주체", status: "REVIEW", detail: "재산관리관·관리부서 별도 확인 필요" },
      { key: "ASSET_CLASS", label: "재산구분", status: "REVIEW", detail: "행정재산 / 일반재산 등 확인 필요" },
      { key: "CURRENT_USE", label: "현재 사용상태", status: "REVIEW", detail: "직접사용·유휴·임대·사용허가·점유 여부 확인 필요" },
      { key: "DECISION_AUTHORITY", label: "사업 의사결정권자", status: "REVIEW", detail: "관리·처분·개발 권한자 확인 필요" },
      { key: "DELIVERY", label: "사업추진 방식", status: "REVIEW", detail: "상기 확인 결과에 따라 PPP/위탁개발 등 구조 판정" },
    ],
    candidateRoutes,
    unresolved: [
      "실제 소유기관 명칭",
      "재산관리관·관리부서",
      "행정재산/일반재산 구분",
      "현재 사용·점유 상태",
      "관리·처분·개발 의사결정권자",
    ],
  };
}

function safeUpstreamText(raw: string, key: string) {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "응답 본문 없음";

  return compact
    .replaceAll(key, "[VWORLD_KEY]")
    .replaceAll(encodeURIComponent(key), "[VWORLD_KEY]")
    .slice(0, 400);
}

function collectOwnershipRecords(value: unknown, output: RawOwnership[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOwnershipRecords(item, output));
    return output;
  }

  if (!value || typeof value !== "object") return output;

  const record = value as RawOwnership;
  if (Object.prototype.hasOwnProperty.call(record, "posesnSeCodeNm")) {
    output.push(record);
  }

  Object.values(record).forEach((child) => collectOwnershipRecords(child, output));
  return output;
}

function findMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMessage(item);
      if (found) return found;
    }
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["resultMsg", "errMsg", "returnAuthMsg", "message", "text"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  for (const child of Object.values(record)) {
    const found = findMessage(child);
    if (found) return found;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const pnu = request.nextUrl.searchParams.get("pnu")?.trim() ?? "";
  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json({ ok: false, message: "19자리 PNU가 필요합니다." }, { status: 400 });
  }

  const key = process.env.VWORLD_API_KEY?.trim() ?? process.env.MOLIT_LANDOWNERSHIP_API_KEY?.trim() ?? "";
  const domain = process.env.VWORLD_API_DOMAIN?.trim() ?? "";

  if (!key || !domain) {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_VWORLD_CONFIG",
        message: "VWORLD_API_KEY 또는 VWORLD_API_DOMAIN 환경변수가 없습니다.",
      },
      { status: 503 }
    );
  }

  const params = new URLSearchParams({
    key,
    domain,
    pnu,
    format: "json",
    numOfRows: "100",
    pageNo: "1",
  });

  try {
    const response = await fetch(`${LAND_OWNERSHIP_URL}?${params.toString()}`, {
      cache: "no-store",
      redirect: "follow",
    });
    const raw = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: "OWNERSHIP_UPSTREAM_ERROR",
          message: `VWorld 토지소유정보 호출 실패 (HTTP ${response.status}): ${safeUpstreamText(raw, key)}`,
        },
        { status: 502 }
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { ok: false, message: `VWorld 토지소유정보 응답 파싱 실패: ${safeUpstreamText(raw, key)}` },
        { status: 502 }
      );
    }

    const sourceRecords = collectOwnershipRecords(payload);
    const deduped = [...new Map(sourceRecords.map((record) => [
      [asText(record.pnu), asText(record.posesnSeCode), asText(record.cnrsPsnSn), asText(record.buldHoNm)].join("|"),
      record,
    ])).values()];

    if (!deduped.length) {
      const upstreamMessage = findMessage(payload);
      if (upstreamMessage) {
        return NextResponse.json({ ok: false, message: upstreamMessage }, { status: 502 });
      }
    }

    const records = deduped.map(normalizeRecord);

    return NextResponse.json({
      ok: true,
      pnu,
      records,
      assessment: assess(records),
      source: {
        name: "VWorld 국토정보 토지소유정보",
        endpoint: "NED getPossessionAttr",
        queriedAt: new Date().toISOString(),
        totalCount: records.length,
      },
      privacy: {
        note: "개인 성명·주민등록번호·상세 거주지 등 개인정보는 수집·표시하지 않습니다.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "토지소유정보 조회 중 오류가 발생했습니다." },
      { status: 502 }
    );
  }
}
