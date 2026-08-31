"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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

type FacilityResult = {
  key: string;
  label: string;
  group: Group;
  decision: Decision;
  reason?: string;
  confidence?: number;
};

type AllowedUseResponse = {
  ok: boolean;
  facilities?: FacilityResult[];
  message?: string;
};

type AggregatedFacility = FacilityResult & {
  parcelCount: number;
};

const REVENUE_GROUPS: { key: RevenueGroup; label: string }[] = [
  { key: "OFFICE", label: "오피스" },
  { key: "RETAIL", label: "리테일" },
  { key: "LOGISTICS_WAREHOUSE", label: "물류/창고" },
  { key: "RESIDENTIAL", label: "주거" },
  { key: "HOSPITALITY", label: "숙박" },
  { key: "HEALTHCARE", label: "의료/헬스케어" },
  { key: "EDUCATION_RESEARCH", label: "교육/연구" },
  { key: "INDUSTRIAL_MANUFACTURING", label: "산업/제조" },
  { key: "DATA_CENTER", label: "데이터센터" },
  { key: "MIXED_USE", label: "복합용도" },
];

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
  const pnus = [...new Set((params.get("pnus") ?? params.get("pnu") ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^\d{19}$/.test(item)))];

  let zoneName = "";
  try {
    const raw = sessionStorage.getItem("inrealtylab.part1Snapshot");
    if (raw) {
      const parsed = JSON.parse(raw) as { primaryZone?: string | null };
      zoneName = parsed.primaryZone?.trim() ?? "";
    }
  } catch {
    // query-string fallback below
  }

  if (!zoneName) {
    try {
      const raw = params.get("part1");
      if (raw) {
        const parsed = JSON.parse(raw) as { primaryZone?: string | null };
        zoneName = parsed.primaryZone?.trim() ?? "";
      }
    } catch {
      // keep empty zone name
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
            <span key={facility.key} title={facility.reason || undefined} className={`report-status ${badgeTone(facility.decision)}`}>
              {facility.label} · {decisionLabel[facility.decision]}
            </span>
          ))}
        </div>
      ) : (
        <div className="report-warning">현재 자동판정에서 사용 가능 또는 조건부 검토 기본 수요시설이 확인되지 않았습니다.</div>
      )}
    </div>
  );
}

function RevenueFacilities({ facilities }: { facilities: AggregatedFacility[] }) {
  const byGroup = new Map<RevenueGroup, AggregatedFacility>();
  for (const facility of facilities) {
    if (facility.group === "PUBLIC") continue;
    const group = facility.group as RevenueGroup;
    const current = byGroup.get(group);
    if (!current || decisionRank[facility.decision] > decisionRank[current.decision]) byGroup.set(group, facility);
  }

  return (
    <div className="report-card" style={{ minHeight: 0 }}>
      <h3 style={{ marginBottom: 4 }}>수익시설 10개 유형</h3>
      <div className="report-source" style={{ marginBottom: 12 }}>Part 3 수익시설 분류 기준</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {REVENUE_GROUPS.map((group) => {
          const facility = byGroup.get(group.key);
          const decision: Decision = facility?.decision ?? "REVIEW";
          return (
            <div key={group.key} title={facility?.reason || "자동판정 근거 추가 확인 필요"} style={{ border: "1px solid #eaecf0", borderRadius: 10, padding: 10 }}>
              <strong style={{ display: "block", marginBottom: 6 }}>{group.label}</strong>
              <span className={`report-status ${badgeTone(decision)}`}>{decisionLabel[decision]}</span>
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
        // 2026-08-26 확정: ALLOWED USE도 Part 2 자동판정 근거(내부 DB 기준)에 해당하므로
        // 외부 공유용 보고서에서는 인쇄 시에도, 관리자 로그인 전 화면에서도 숨긴다.
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
      setError("사용 가능 시설을 판정할 PNU가 없습니다.");
      return () => window.clearInterval(timer);
    }

    Promise.all(pnus.map(async (pnu) => {
      const query = new URLSearchParams({ pnu });
      if (zoneName) query.set("zoneName", zoneName);
      const response = await fetch(`/api/allowed-use?${query.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as AllowedUseResponse;
      if (!response.ok || !data.ok) throw new Error(data.message || "시설 사용가능 여부 조회 실패");
      return data.facilities ?? [];
    }))
      .then((rows) => {
        if (cancelled) return;
        const aggregated = aggregateFacilities(rows);
        setFacilities(aggregated);
        try {
          sessionStorage.setItem("inrealtylab.allowedFacilities", JSON.stringify({
            capturedAt: new Date().toISOString(),
            zoneName,
            pnus,
            facilities: aggregated,
          }));
        } catch {
          // report rendering does not depend on storage
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
  const revenueFacilities = useMemo(() => facilities.filter((item) => item.group !== "PUBLIC"), [facilities]);

  if (!mount) return null;

  return createPortal(
    <>
      <div className="report-section-head">
        <div><span>ALLOWED USE</span><br /><strong>사용 가능 시설</strong></div>
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
          <RevenueFacilities facilities={revenueFacilities} />
        </div>
      )}
    </>,
    mount
  );
}
