import { NextRequest, NextResponse } from "next/server";
import { supabasePublicConfig, supabasePublicHeaders } from "../lib/supabase-public";

// 건축 가능시설 판정 (2026-09-04 전면 교체)
//
// 예전에는 국토부 토지이용규제정보 API가 돌려주는 '행위제한' 문구를 해석했다.
// 그 API는 명시적 금지만 돌려주고 대부분 "관련내용 없음"이라 가능 판정이 하나도
// 나오지 않았고, 원문 XML이 화면에 그대로 새는 문제도 있었다.
//
// 지금은 국토계획법 시행령 별표와 서울특별시 도시계획 조례 별표를 DB(zoning_use_permission)에
// 넣어 두 층으로 직접 판정한다.
//
//   시행령 제1항  → 조례 없이 바로 가능
//   시행령 제2항  → "도시·군계획조례가 정하는 바에 따라" → 조례층이 있어야 확정된다
//   금지 목록     → scope=FULL이면 용도 전체 불가, PARTIAL이면 일부 세부유형만 불가
//
// 조례층이 없는 지역(서울 외)은 제2항 항목을 REVIEW로 내보낸다. 임의로 가능/불가로
// 단정하지 않는 것이 이 판정의 원칙이다.

export const dynamic = "force-dynamic";

type Permission =
  | "ALLOWED"
  | "ORDINANCE_ALLOWED"
  | "PROHIBITED"
  | "ORDINANCE_PROHIBITED";

type PermissionRow = {
  statute_ref: string;
  clause: string;
  item_no: string | null;
  building_use_name: string;
  permission: Permission;
  condition_note: string | null;
  condition_max_gfa_sqm: number | null;
  facility_key: string | null;
  list_type: "POSITIVE" | "NEGATIVE";
  scope: "FULL" | "PARTIAL";
  jurisdiction: string;
  base_date: string | null;
};

type FacilityRow = {
  facility_key: string;
  facility_label: string;
  facility_group: string;
  facility_codes: string[] | null;
  display_order: number;
};

type ZoneRow = { ucode: string; zone_name_kr: string; zone_kind: string };

type CaveatRow = { statute_ref: string; clause: string; caveat_text: string };

type DistanceRow = {
  reference_feature: string;
  building_use_name: string;
  facility_key: string | null;
  hard_ban_distance_m: number | null;
  review_distance_m: number | null;
  condition_note: string | null;
  statute_ref: string;
};

type OrdinanceLimitRow = {
  max_bcr_pct: number | null;
  max_far_pct: number | null;
  max_far_pct_special: number | null;
  special_scope: string | null;
  statute_ref: string;
  condition_note: string | null;
  base_date: string | null;
};

type Decision = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW";

const SEOUL_PNU_PREFIX = "11";

async function selectRows<T>(path: string): Promise<T[]> {
  const { url } = supabasePublicConfig();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    cache: "no-store",
    headers: supabasePublicHeaders({ Accept: "application/json" }),
  });
  if (!response.ok) {
    throw new Error(`Supabase 조회 실패 (${path.split("?")[0]}, ${response.status})`);
  }
  return (await response.json()) as T[];
}

/** "제2종일반주거지역", "제2종 일반주거지역", "일반상업지역(도시지역)" 등을 흡수한다. */
function matchZone(zones: ZoneRow[], zoneName: string): ZoneRow | null {
  const needle = zoneName.replace(/\s+/g, "");
  if (!needle) return null;
  const exact = zones.find((zone) => zone.zone_name_kr === needle);
  if (exact) return exact;
  const contained = zones
    .filter((zone) => needle.includes(zone.zone_name_kr))
    .sort((a, b) => b.zone_name_kr.length - a.zone_name_kr.length)[0];
  if (contained) return contained;
  return zones.find((zone) => zone.zone_name_kr.includes(needle)) ?? null;
}

function joinReason(parts: Array<string | null | undefined>) {
  return parts.filter((part) => part && part.trim()).join(" · ");
}

/** 접도 조건은 필지의 도로 폭을 받기 전에는 자동 판정할 수 없다. */
function hasRoadCondition(note: string | null) {
  return !!note && /너비\s*\d+(\.\d+)?\s*미터/.test(note);
}

function citation(row: PermissionRow) {
  const ref = row.statute_ref.replace("국토의 계획 및 이용에 관한 법률 시행령", "영");
  return `${ref} ${row.clause}${row.item_no ? ` ${row.item_no}목` : ""}`;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const pnu = params.get("pnu")?.trim() ?? "";
  const zoneName = params.get("zoneName")?.trim() ?? "";
  const gfaParam = params.get("aboveGroundGfaSqm")?.trim() ?? "";
  const siteAreaParam = params.get("siteAreaSqm")?.trim() ?? "";

  if (!/^\d{19}$/.test(pnu)) {
    return NextResponse.json({ ok: false, message: "19자리 PNU가 필요합니다." }, { status: 400 });
  }
  if (!zoneName) {
    return NextResponse.json(
      { ok: false, code: "NO_ZONE", message: "용도지역이 확인되지 않아 건축 가능 용도를 판정할 수 없습니다." },
      { status: 400 }
    );
  }

  let requestedGfa = gfaParam ? Number(gfaParam) : null;
  const siteAreaSqm = siteAreaParam ? Number(siteAreaParam) : null;
  const isSeoul = pnu.startsWith(SEOUL_PNU_PREFIX);

  try {
    const [zones, facilities] = await Promise.all([
      selectRows<ZoneRow>("part1_zone_ucode_reference?select=ucode,zone_name_kr,zone_kind"),
      selectRows<FacilityRow>(
        "part1_facility_catalog?select=facility_key,facility_label,facility_group,facility_codes,display_order&is_active=eq.true&order=display_order.asc"
      ),
    ]);

    const zone = matchZone(
      zones.filter((item) => item.zone_kind !== "용도지구"),
      zoneName
    );

    if (!zone) {
      return NextResponse.json(
        {
          ok: false,
          code: "ZONE_NOT_IN_DB",
          message: `"${zoneName}"에 해당하는 용도지역 별표가 DB에 없습니다.`,
        },
        { status: 404 }
      );
    }

    const [rows, caveats, distances, limitRows] = await Promise.all([
      selectRows<PermissionRow>(
        `zoning_use_permission?select=statute_ref,clause,item_no,building_use_name,permission,condition_note,condition_max_gfa_sqm,facility_key,list_type,scope,jurisdiction,base_date&ucode=eq.${zone.ucode}`
      ),
      selectRows<CaveatRow>(
        `zoning_clause_caveat?select=statute_ref,clause,caveat_text&ucode=eq.${zone.ucode}`
      ),
      selectRows<DistanceRow>(
        `seoul_distance_restriction?select=reference_feature,building_use_name,facility_key,hard_ban_distance_m,review_distance_m,condition_note,statute_ref&ucode=eq.${zone.ucode}`
      ),
      // 조례 건폐율·용적률 상한. 국가 시행령 상한과 함께 더 엄격한 값을 적용해야 한다.
      selectRows<OrdinanceLimitRow>(
        `zone_far_bcr_limit?select=max_bcr_pct,max_far_pct,max_far_pct_special,special_scope,statute_ref,condition_note,base_date&ucode=eq.${zone.ucode}`
      ),
    ]);

    if (!rows.length) {
      return NextResponse.json(
        {
          ok: false,
          code: "NO_RULE_ROWS",
          message: `${zone.zone_name_kr}의 별표 데이터가 아직 DB에 없습니다.`,
        },
        { status: 404 }
      );
    }

    const nationalRows = rows.filter((row) => row.jurisdiction === "국가");
    const localRows = rows.filter((row) => row.jurisdiction !== "국가");
    const listType = nationalRows[0]?.list_type ?? "POSITIVE";
    // 조례층은 지자체별로 넣는다. 지금 DB에는 서울특별시만 들어와 있다.
    const hasLocalLayer = localRows.length > 0 && isSeoul;
    const localName = localRows[0]?.jurisdiction ?? "도시·군계획조례";

    const baseDate =
      rows
        .map((row) => row.base_date)
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ?? "";

    const results = facilities.map((facility) => {
      const key = facility.facility_key;
      const mine = rows.filter((row) => row.facility_key === key);
      const national = mine.filter((row) => row.jurisdiction === "국가");
      const local = mine.filter((row) => row.jurisdiction !== "국가");

      let decision: Decision;
      let confidence: number;
      const reasons: string[] = [];
      let maxGfaSqm: number | null = null;

      const capOf = (list: PermissionRow[]) => {
        const caps = list
          .map((row) => row.condition_max_gfa_sqm)
          .filter((value): value is number => typeof value === "number" && value > 0);
        return caps.length ? Math.min(...caps) : null;
      };

      if (listType === "POSITIVE") {
        const direct = national.find((row) => row.permission === "ALLOWED");
        const viaOrdinance = national.find((row) => row.permission === "ORDINANCE_ALLOWED");

        if (direct) {
          decision = "ALLOWED";
          confidence = 0.95;
          reasons.push(`${citation(direct)} — 조례 없이 건축할 수 있는 건축물`);
          if (direct.condition_note) reasons.push(direct.condition_note);
          maxGfaSqm = capOf(national.filter((row) => row.permission === "ALLOWED"));
        } else if (viaOrdinance && hasLocalLayer && local.length) {
          decision = "CONDITIONAL";
          confidence = 0.9;
          reasons.push(`${citation(viaOrdinance)} — 조례로 정하는 바에 따라 건축 가능`);
          for (const row of local) reasons.push(`${citation(row)} — ${row.condition_note ?? "열거됨"}`);
          maxGfaSqm = capOf(local) ?? capOf(national);
        } else if (viaOrdinance && hasLocalLayer) {
          decision = "PROHIBITED";
          confidence = 0.9;
          reasons.push(
            `${citation(viaOrdinance)}은 조례 위임 사항인데 ${localName} 조례 별표에 열거되어 있지 않습니다.`
          );
        } else if (viaOrdinance) {
          decision = "REVIEW";
          confidence = 0.5;
          reasons.push(
            `${citation(viaOrdinance)} — 조례로 정하는 바에 따릅니다. 해당 지자체 도시·군계획조례 별표를 확인해야 확정됩니다.`
          );
          maxGfaSqm = capOf(national);
        } else {
          decision = "PROHIBITED";
          confidence = 0.9;
          reasons.push(`${zone.zone_name_kr} 별표에 열거되지 않은 용도입니다.`);
        }
      } else {
        const fullBan = mine.find((row) => row.permission === "PROHIBITED" && row.scope === "FULL");
        const ordinanceBan = national.find(
          (row) => row.permission === "ORDINANCE_PROHIBITED" && row.scope === "FULL"
        );
        const localBan = local.find((row) => row.scope === "FULL");
        const partial = mine.filter((row) => row.scope === "PARTIAL");

        if (fullBan) {
          decision = "PROHIBITED";
          confidence = 0.95;
          reasons.push(`${citation(fullBan)} — 건축할 수 없는 건축물`);
          if (fullBan.condition_note) reasons.push(fullBan.condition_note);
        } else if (localBan) {
          decision = "PROHIBITED";
          confidence = 0.9;
          reasons.push(`${citation(localBan)} — 조례가 금지한 건축물`);
        } else if (ordinanceBan && !hasLocalLayer) {
          decision = "REVIEW";
          confidence = 0.5;
          reasons.push(
            `${citation(ordinanceBan)} — 조례로 정하는 바에 따라 제한될 수 있습니다. 해당 지자체 조례를 확인해야 합니다.`
          );
        } else if (partial.length) {
          decision = "CONDITIONAL";
          confidence = 0.85;
          for (const row of partial) reasons.push(`${citation(row)} — ${row.condition_note ?? "일부 세부유형만 제한"}`);
          maxGfaSqm = capOf(partial);
        } else {
          decision = "ALLOWED";
          confidence = 0.9;
          reasons.push(`${zone.zone_name_kr} 금지 목록에 열거되지 않은 용도입니다.`);
        }
      }

      // 접도 조건 — 도로 폭을 받기 전에는 자동으로 확정하지 않는다.
      const roadRow = mine.find((row) => hasRoadCondition(row.condition_note));
      if (roadRow && decision === "ALLOWED") decision = "CONDITIONAL";
      if (roadRow) reasons.push("접도 조건이 있어 대지가 접한 도로 폭을 확인해야 합니다.");

      // 이격거리 규정 — 주거지역 경계와의 거리를 계산해야 확정된다.
      const distance = distances.find(
        (row) => (row.facility_key && row.facility_key === key) || row.building_use_name.includes(facility.facility_label)
      );
      if (distance && decision !== "PROHIBITED") {
        decision = "CONDITIONAL";
        confidence = Math.min(confidence, 0.7);
        reasons.push(
          `${distance.statute_ref} — ${distance.reference_feature}로부터 ${distance.hard_ban_distance_m ?? 0}m 이내 불가` +
            (distance.review_distance_m ? `, ${distance.review_distance_m}m까지 심의 대상` : "")
        );
      }

      if (maxGfaSqm && requestedGfa && requestedGfa > maxGfaSqm) {
        reasons.push(
          `해당 용도 바닥면적 상한 ${maxGfaSqm.toLocaleString("ko-KR")}㎡ — 법정 최대 연면적 ${Math.round(
            requestedGfa
          ).toLocaleString("ko-KR")}㎡보다 작아 이 용도만으로는 채울 수 없습니다.`
        );
      }

      return {
        key,
        label: facility.facility_label,
        group: facility.facility_group,
        // 건축법 용도 → 수익시설 10분류. 화면의 시설 타일은 이 코드로 매칭한다.
        facilityCodes: facility.facility_codes ?? [],
        decision,
        reason: joinReason(reasons),
        confidence,
        activityCode: null,
        activityName: null,
        maxGfaSqm,
      };
    });

    const caveatText = caveats.map((row) => `${row.statute_ref} ${row.clause}: ${row.caveat_text}`);

    const limitRow = limitRows[0] ?? null;

    // 프론트가 넘긴 연면적은 국가 상한 기준이다. 조례 용적률이 더 엄격하면 그쪽으로 낮춘다.
    if (limitRow?.max_far_pct && siteAreaSqm && siteAreaSqm > 0) {
      const ordinanceGfa = siteAreaSqm * (limitRow.max_far_pct / 100);
      requestedGfa = requestedGfa ? Math.min(requestedGfa, ordinanceGfa) : ordinanceGfa;
    }

    return NextResponse.json({
      ok: true,
      zone: { ucode: zone.ucode, name: zone.zone_name_kr, listType },
      ordinanceLimit: limitRow
        ? {
            bcrMaxPct: limitRow.max_bcr_pct,
            farMaxPct: limitRow.max_far_pct,
            farMaxPctSpecial: limitRow.max_far_pct_special,
            specialScope: limitRow.special_scope,
            legalBasis: limitRow.statute_ref,
            note: limitRow.condition_note,
            baseDate: limitRow.base_date,
          }
        : null,
      facilities: results,
      caveats: caveatText,
      diagnostics: {
        activityCatalogCount: rows.length,
        matchedFacilityCount: results.filter((item) => item.decision !== "PROHIBITED").length,
        nationalRuleCount: nationalRows.length,
        localRuleCount: localRows.length,
        hasLocalLayer,
      },
      source: {
        code: "STATUTE_TABLE",
        name: hasLocalLayer
          ? `국토계획법 시행령 별표 + ${localName} 도시계획 조례 별표`
          : "국토계획법 시행령 별표",
        endpoints: ["zoning_use_permission", "zoning_clause_caveat", "seoul_distance_restriction"],
        baseDate,
        queriedAt: new Date().toISOString(),
        note: hasLocalLayer
          ? "시행령 제2항(조례 위임) 항목은 조례 별표에 열거된 경우에만 가능으로 판정합니다."
          : "이 지역의 도시·군계획조례 별표가 아직 DB에 없어 조례 위임 항목은 '추가확인'으로 표시합니다.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "ALLOWED_USE_DB_ERROR",
        message: error instanceof Error ? error.message : "건축 가능시설 판정 중 오류가 발생했습니다.",
      },
      { status: 502 }
    );
  }
}
