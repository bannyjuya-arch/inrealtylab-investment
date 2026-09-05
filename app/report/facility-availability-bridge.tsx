"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { COMMERCIAL_CATEGORIES } from "@/lib/integrated-report";

// 2026-09-05: 수익시설 타일을 facility_group(7종)이 아니라 수익시설 코드(C01~C10)로 매칭하도록 바꿨다.
// 그전에는 타일 키가 LOGISTICS_WAREHOUSE·RESIDENTIAL·HEALTHCARE·EDUCATION_RESEARCH·
// INDUSTRIAL_MANUFACTURING·DATA_CENTER·MIXED_USE 였는데 DB의 facility_group에는 그런 값이 없어
// 10개 중 6개가 무슨 필지를 넣든 영구히 "추가 확인"으로만 표시됐다.
// 이제 part1_facility_catalog.facility_codes 가 건축법 용도를 수익시설 분류에 연결하고,
// 시설 목록·이름은 lib/integrated-report 의 COMMERCIAL_CATEGORIES 한 곳에서만 온다.

type Decision = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW";

type FacilityResult = {
  key: string;
  label: string;
  group: string;
  decision: Decision;
  reason?: string;
  confidence?: number;
  facilityCodes?: string[];
};

type AllowedUseResponse = {
  ok: boolean;
  facilities?: FacilityResult[];
  message?: string;
};

type AggregatedFacility = FacilityResult & { parcelCount: number };

const decisionRank: Record<Decision, number> = {
  ALLOWED: 1,
  CONDITIONAL: 2,
  REVIEW: 3,
  PROHIBITED: 4,
};

const decisionLabel: Record<Decision, string> = {
  ALLOWED: "사용 가능",
  CONDITIONAL: "조건부 검토",
  REVIEW: "추가 확인",
  PROHIBITED: "사용 불가",
};

function readContext() {
  const params = new URLSearchParams(window.location.search);
  const pnus = [
    ...new Set(
      (params.get("pnus") ?? params.get("pnu") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => /^\d{19}$/.test(item))
    ),
  ];

  let zoneName = "";
  try {
    const raw = sessionStorage.getItem("inrealtylab.part1Snapshot");
    if (raw) {
      const parsed = JSON.parse(raw) as { primaryZone?: string | null };
      zoneName = parsed.primaryZone?.trim() ?? "";
    }
  } catch {
    // 아래 쿼리스트링 폴백으로 넘어간다
  }

  if (!zoneName) {
    try {
      const raw = params.get("part1");
      if (raw) {
        const parsed = JSON.parse(raw) as { primaryZone?: string | null };
        zoneName = parsed.primaryZone?.trim() ?? "";
      }
    } catch {
      // 용도지역 없이도 판정은 진행한다
    }
  }

  return { pnus, zoneName };
}

function aggregateFacilities(results: FacilityResult[][]): AggregatedFacility[] {
  const byKey = new Map<string, FacilityResult[]>();
  for (const facilities of results) {
    for (const facility of facilities) {
      const list = byKey.get(facility.key) ?? [];
      list.push(facility);
      byKey.set(facility.key, list);
    }
  }

  return [...byKey.values()].map((items) => {
    // 복수 필지는 한 필지라도 더 엄격한 판정이 있으면 그쪽을 따른다.
    const strongest = [...items].sort((a, b) => decisionRank[b.decision] - decisionRank[a.decision])[0];
    return {
      ...strongest,
      parcelCount: items.length,
      reason: items.map((item) => item.reason).filter(Boolean).join(" / "),
    };
  });
}

function badgeTone(decision: Decision) {
  if (decision === "ALLOWED") return "pass";
  if (decision === "PROHIBITED") return "fail";
  return "review";
}

function PublicFacilities({ facilities }: { facilities: AggregatedFacility[] }) {
  const usable = facilities.filter((item) => item.decision === "ALLOWED" || item.decision === "CONDITIONAL");
  return (
    <div className="report-card" style={{ minHeight: 0 }}>
      <h3 style={{ marginBottom: 4 }}>기본 수요시설</h3>
      <div className="report-source" style={{ marginBottom: 12 }}>공공·필수 시설군</div>
      {usable.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {usable.map((facility) => (
            <span
              key={facility.key}
              title={facility.reason || undefined}
              className={`report-status ${badgeTone(facility.decision)}`}
            >
              {facility.label} · {decisionLabel[facility.decision]}
            </span>
          ))}
        </div>
      ) : (
        <div className="report-warning">
          현재 자동판정에서 사용 가능 또는 조건부 검토 기본 수요시설이 확인되지 않았습니다.
        </div>
      )}
    </div>
  );
}

function RevenueFacilities({ facilities }: { facilities: AggregatedFacility[] }) {
  // 수익시설 코드 → 그 코드로 지을 수 있다고 판정된 건축법 용도들 중 가장 유리한 판정.
  const byCode = new Map<string, AggregatedFacility>();
  for (const facility of facilities) {
    for (const code of facility.facilityCodes ?? []) {
      const current = byCode.get(code);
      if (!current || decisionRank[facility.decision] < decisionRank[current.decision]) {
        byCode.set(code, facility);
      }
    }
  }

  return (
    <div className="report-card" style={{ minHeight: 0 }}>
      <h3 style={{ marginBottom: 4 }}>수익시설 유형별 가능 여부</h3>
      <div className="report-source" style={{ marginBottom: 12 }}>인리얼티 내부 DB 분석 기준</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {COMMERCIAL_CATEGORIES.map((category) => {
          const facility = byCode.get(category.key);
          return (
            <div
              key={category.key}
              title={
                facility
                  ? `${facility.label} 기준 · ${facility.reason || "판정 근거 없음"}`
                  : "이 용도지역에서 판정된 대응 건축물 용도가 없습니다."
              }
              style={{ border: "1px solid #eaecf0", borderRadius: 10, padding: 10 }}
            >
              <strong style={{ display: "block", marginBottom: 6 }}>{category.label}</strong>
              {facility ? (
                <>
                  <span className={`report-status ${badgeTone(facility.decision)}`}>
                    {decisionLabel[facility.decision]}
                  </span>
                  <div className="report-source" style={{ marginTop: 6 }}>{facility.label}</div>
                </>
              ) : (
                // 판정하지 않은 것과 판정해서 불가인 것은 다르다. 섞어서 보여주지 않는다.
                <span className="report-status review">판정자료 없음</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function FacilityAvailabilityBridge() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [facilities, setFacilities] = useState<AggregatedFacility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    function findMount() {
      const headings = Array.from(document.querySelectorAll<HTMLElement>(".report-section-head strong"));
      const demandHeading = headings.find((item) => item.textContent?.includes("시설별 연면적 DB 연결 슬롯"));
      const demandSection = demandHeading?.closest<HTMLElement>(".report-section");
      if (!demandSection) return false;

      let node = document.getElementById("inrealtylab-facility-availability");
      if (!node) {
        node = document.createElement("div");
        node.id = "inrealtylab-facility-availability";
        // 2026-08-26 확정: 자동판정 근거(내부 DB 기준)라 외부 공유용 보고서에서는
        // 인쇄 시에도, 관리자 로그인 전 화면에서도 숨긴다.
        node.className = "report-section no-print admin-only";
        demandSection.parentElement?.insertBefore(node, demandSection);
      }
      setMount(node);
      return true;
    }

    if (!findMount()) {
      timer = window.setInterval(() => {
        if (findMount()) window.clearInterval(timer);
      }, 100);
    }

    const { pnus, zoneName } = readContext();
    if (!pnus.length) {
      setLoading(false);
      setError("사용 가능 시설을 판정할 필지가 선택되지 않았습니다.");
      return () => window.clearInterval(timer);
    }

    Promise.all(
      pnus.map(async (pnu) => {
        const query = new URLSearchParams({ pnu });
        if (zoneName) query.set("zoneName", zoneName);
        const response = await fetch(`/api/allowed-use?${query.toString()}`, { cache: "no-store" });
        const data = (await response.json()) as AllowedUseResponse;
        if (!response.ok || !data.ok) throw new Error(data.message || "시설 사용가능 여부 조회 실패");
        return data.facilities ?? [];
      })
    )
      .then((rows) => {
        if (cancelled) return;
        const aggregated = aggregateFacilities(rows);
        setFacilities(aggregated);
        try {
          sessionStorage.setItem(
            "inrealtylab.allowedFacilities",
            JSON.stringify({ capturedAt: new Date().toISOString(), zoneName, pnus, facilities: aggregated })
          );
        } catch {
          // 보고서 렌더링은 저장 성공 여부에 의존하지 않는다
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "시설 사용가능 여부 조회 실패");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const publicFacilities = useMemo(() => facilities.filter((item) => item.group === "PUBLIC"), [facilities]);

  if (!mount) return null;

  return createPortal(
    <>
      <div className="report-section-head">
        <div><span>용도판정</span><br /><strong>사용 가능 시설</strong></div>
      </div>
      <div className="report-note" style={{ marginBottom: 12 }}>
        용도지역·토지이용규제 기준의 1차 자동판정입니다. 복수 필지는 한 필지라도 더 엄격한 판정이 있으면 그 결과를 적용합니다.
      </div>
      {loading ? (
        <div className="report-warning">사용 가능 시설을 자동 판정하고 있습니다.</div>
      ) : error ? (
        <div className="report-warning">{error}</div>
      ) : (
        <div className="report-grid">
          <PublicFacilities facilities={publicFacilities} />
          <RevenueFacilities facilities={facilities} />
        </div>
      )}
    </>,
    mount
  );
}
