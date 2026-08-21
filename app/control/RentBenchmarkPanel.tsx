"use client";

import { useEffect, useMemo, useState } from "react";

type FacilityCode = "C01_OFFICE" | "C02_RETAIL" | "C04_LIVING";

type RentRow = {
  facility_code: FacilityCode;
  geography_type: string;
  geography_code: string | null;
  geography_name: string | null;
  submarket: string | null;
  rent_per_sqm_month: number | string | null;
  unit: string | null;
  source_kind: string | null;
  source_code: string | null;
  source_name: string | null;
  base_date: string | null;
  sample_count: number | null;
  methodology: string | null;
  confidence: number | string | null;
};

type RentResponse = {
  ok: boolean;
  rows?: RentRow[];
  latest?: RentRow | null;
  note?: string | null;
  message?: string;
  refreshResult?: {
    refreshed?: boolean;
    rentPerSqmMonth?: number;
    sampleCount?: number;
  } | null;
};

const FACILITIES: Array<{ code: FacilityCode; label: string; description: string }> = [
  { code: "C01_OFFICE", label: "C01 오피스", description: "서울 권역별 시장 임대료" },
  { code: "C02_RETAIL", label: "C02 리테일", description: "R-ONE 상권 임대시세" },
  { code: "C04_LIVING", label: "C04 리빙", description: "국토부 전월세 실거래 기반" },
];

function currentPnu() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("pnus") ?? params.get("pnu") ?? "").split(",")[0]?.trim() ?? "";
}

function previousMonthYmd() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  first.setMonth(first.getMonth() - 1);
  const y = first.getFullYear();
  const m = String(first.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRent(value: number | string | null | undefined) {
  const numeric = numberValue(value);
  return numeric === null ? "-" : `${Math.round(numeric).toLocaleString("ko-KR")}원/㎡·월`;
}

export default function RentBenchmarkPanel() {
  const [pnu, setPnu] = useState("");
  const [data, setData] = useState<Partial<Record<FacilityCode, RentResponse>>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function load(code: FacilityCode, refreshLiving = false) {
    const params = new URLSearchParams({ facility: code });
    if (pnu) params.set("pnu", pnu);
    if (code === "C04_LIVING" && refreshLiving) {
      params.set("refresh", "1");
      params.set("dealYmd", previousMonthYmd());
    }

    const response = await fetch(`/api/rent-benchmark?${params.toString()}`, { cache: "no-store" });
    const body = (await response.json()) as RentResponse;
    setData((current) => ({ ...current, [code]: body }));
    if (!response.ok || !body.ok) throw new Error(body.message ?? `${code} 임대료 조회 실패`);

    const preferred = code === "C01_OFFICE"
      ? body.rows?.find((row) => row.submarket === "SEOUL_TOTAL") ?? body.latest
      : body.latest;
    const rent = numberValue(preferred?.rent_per_sqm_month);
    if (rent !== null) {
      try {
        sessionStorage.setItem(`inrealtylab.rent.${code}`, String(rent));
        sessionStorage.setItem(`inrealtylab.rent.${code}.source`, JSON.stringify(preferred));
      } catch {
        // Continue if browser storage is unavailable.
      }
    }
  }

  useEffect(() => {
    const nextPnu = currentPnu();
    setPnu(nextPnu);
  }, []);

  useEffect(() => {
    if (!pnu) return;
    setLoading(true);
    Promise.allSettled(FACILITIES.map((facility) => load(facility.code)))
      .then((results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected && rejected.status === "rejected") {
          setMessage(rejected.reason instanceof Error ? rejected.reason.message : "임대료 DB 일부 조회 실패");
        }
      })
      .finally(() => setLoading(false));
  }, [pnu]);

  const officeRows = useMemo(() => data.C01_OFFICE?.rows ?? [], [data.C01_OFFICE]);

  async function refreshLiving() {
    setLoading(true);
    setMessage("");
    try {
      await load("C04_LIVING", true);
      setMessage(`리빙 최근 실거래(${previousMonthYmd()})를 갱신했습니다.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "리빙 실거래 갱신 실패");
    } finally {
      setLoading(false);
    }
  }

  if (!/^\d{19}$/.test(pnu)) return null;

  return (
    <section className="control-section rent-benchmark-section">
      <div className="control-section-title">
        <span>OPERATING RENT DB</span>
        <strong>오피스 · 리테일 · 리빙 임대료 자동연결</strong>
      </div>

      <div className="control-policy-card">
        <strong>적용 원칙</strong>
        <p>오피스는 서울 권역별 시장 임대료, 리테일은 R-ONE 상권 임대시세, 리빙은 국토부 전월세 실거래를 사용합니다. DB 값은 운영수지의 기본값으로만 사용하고 출처·기준일을 함께 보존합니다.</p>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>시설</th>
              <th style={{ textAlign: "left", padding: 10 }}>지역/권역</th>
              <th style={{ textAlign: "right", padding: 10 }}>임대료</th>
              <th style={{ textAlign: "center", padding: 10 }}>기준일</th>
              <th style={{ textAlign: "left", padding: 10 }}>출처</th>
              <th style={{ textAlign: "right", padding: 10 }}>표본</th>
            </tr>
          </thead>
          <tbody>
            {FACILITIES.map((facility) => {
              const response = data[facility.code];
              const preferred = facility.code === "C01_OFFICE"
                ? response?.rows?.find((row) => row.submarket === "SEOUL_TOTAL") ?? response?.latest
                : response?.latest;
              return (
                <tr key={facility.code}>
                  <td style={{ padding: 10 }}><strong>{facility.label}</strong><div style={{ fontSize: 12, opacity: 0.7 }}>{facility.description}</div></td>
                  <td style={{ padding: 10 }}>{preferred?.submarket ?? preferred?.geography_name ?? (facility.code === "C02_RETAIL" ? "상권자료 대기" : "-")}</td>
                  <td style={{ padding: 10, textAlign: "right" }}><strong>{formatRent(preferred?.rent_per_sqm_month)}</strong></td>
                  <td style={{ padding: 10, textAlign: "center" }}>{preferred?.base_date ?? "-"}</td>
                  <td style={{ padding: 10 }}>{preferred?.source_name ?? preferred?.source_code ?? response?.note ?? "-"}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>{preferred?.sample_count ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {officeRows.length > 1 && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          <strong>오피스 권역 DB:</strong>{" "}
          {officeRows.map((row) => `${row.submarket ?? "서울"} ${formatRent(row.rent_per_sqm_month)}`).join(" · ")}
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={refreshLiving} disabled={loading}>리빙 최근 실거래 DB 갱신</button>
        <span style={{ fontSize: 12, opacity: 0.72 }}>보증금 환산은 아직 적용하지 않고 실제 월세가 존재하는 거래의 ㎡당 월세 중앙값만 사용합니다.</span>
      </div>

      {message && <p style={{ marginTop: 10 }}>{message}</p>}
    </section>
  );
}
