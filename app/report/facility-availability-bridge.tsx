"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Decision = "ALLOWED" | "CONDITIONAL" | "PROHIBITED" | "REVIEW";
type Group = "OFFICE" | "RETAIL" | "PUBLIC";

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

function FacilityGroup({ title, subtitle, facilities }: {
  title: string;
  subtitle: string;
  facilities: AggregatedFacility[];
}) {
  const usable = facilities.filter((item) => item.decision === "ALLOWED" || item.decision === "CONDITIONAL");
  const review = facilities.filter((item) => item.decision === "REVIEW");
  const prohibited = facilities.filter((item) => item.decision === "PROHIBITED");

  return (
    <div className="report-card" style={{ minHeight: 0 }}>
      <h3 style={{ marginBottom: 4 }}>{title}</h3>
      <div className="report-source" style={{ marginBottom: 12 }}>{subtitle}</div>
      {usable.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {usable.map((facility) => (
            <span
              key={facility.key}
              title={facility.reason || undefined}
              className={`report-status ${facility.decision === "ALLOWED" ? "pass" : "review"}`}
              style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
            >
              {facility.label} · {decisionLabel[facility.decision]}
            </span>
          ))}
        </div>
      ) : (
        <div className="report-warning">현재 자동판정에서 즉시 사용 가능 또는 조건부 검토 시설이 확인되지 않았습니다.</div>
      )}
      {(review.length > 0 || prohibited.length > 0) && (
        <div className="report-source" style={{ marginTop: 12, lineHeight: 1.6 }}>
          추가 확인 {review.length}개 · 사용 불가 {prohibited.length}개
        </div>
      )}
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
        node.className = "report-section";
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
  const revenueFacilities = useMemo(() => facilities.filter((item) => item.group === "OFFICE" || item.group === "RETAIL"), [facilities]);

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
          <FacilityGroup
            title="기본 수요시설"
            subtitle="공공·필수 시설군"
            facilities={publicFacilities}
          />
          <FacilityGroup
            title="수익시설"
            subtitle="OFFICE · RETAIL"
            facilities={revenueFacilities}
          />
        </div>
      )}
    </>,
    mount
  );
}
