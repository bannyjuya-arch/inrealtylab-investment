"use client";

import { useEffect, useMemo, useState } from "react";
import { COMMERCIAL_CATEGORIES } from "@/lib/integrated-report";

type DbFacilityCode = "C01_OFFICE" | "C02_RETAIL" | "C04_LIVING";
type FacilityCode =
  | DbFacilityCode
  | "C03_HOSPITALITY"
  | "C05_HEALTHCARE"
  | "C06_EDUCATION"
  | "C07_CULTURE_ENTERTAINMENT"
  | "C08_RND_LAB"
  | "C09_LOGISTICS"
  | "C10_DIGITAL_INFRA";

type RentRow = {
  facility_code: DbFacilityCode;
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

type FacilityDefinition = {
  code: FacilityCode;
  label: string;
  description: string;
  dbLinked: boolean;
};

// 2026-09-05: 시설 이름을 여기서 또 짓지 않는다. 이름은 COMMERCIAL_CATEGORIES 한 곳에서만 오고
// 화면에는 DB 코드(C01…)를 붙이지 않는다. description은 그 시설의 임대료가 어디서 오는지만 적는다.
const FACILITY_SOURCE: Record<string, { description: string; dbLinked: boolean }> = {
  C01_OFFICE: { description: "서울 권역별 시장 임대료", dbLinked: true },
  C02_RETAIL: { description: "한국부동산원 상권별 임대시세 · 층별효용비율 적용", dbLinked: true },
  C03_HOSPITALITY: { description: "임대료 자료 없음 — 가동률·객단가 모델 필요", dbLinked: false },
  C04_LIVING: { description: "국토부 전월세 실거래 · 전월세전환율 환산", dbLinked: true },
  C05_HEALTHCARE: { description: "임대주택 임대료에서 파생 (인리얼티 내부 DB 분석 기준)", dbLinked: false },
  C06_EDUCATION: { description: "임대료 자료 없음", dbLinked: false },
  C07_CULTURE_ENTERTAINMENT: { description: "임대료 자료 없음", dbLinked: false },
  C08_RND_LAB: { description: "오피스 임대료에서 파생 (인리얼티 내부 DB 분석 기준)", dbLinked: false },
  C09_LOGISTICS: { description: "임대료 자료 없음", dbLinked: false },
  C10_DIGITAL_INFRA: { description: "원/kW·월 단가라 ㎡ 환산 불가 — 별도 모델 필요", dbLinked: false },
};

/** 서브마켓 코드는 리서치 용어라 화면에는 한글 권역명으로 바꿔 보여준다. */
const REGION_LABEL: Record<string, string> = {
  CBD: "도심권역", GBD: "강남권역", YBD: "여의도권역",
  Others: "서울 기타권역", Pangyo: "판교", Bundang: "분당",
  "Capital Area": "수도권", SEOUL_TOTAL: "서울 전체", NATION: "전국",
};
function regionLabel(value: string | null | undefined) {
  if (!value) return null;
  return REGION_LABEL[value] ?? value;
}

const FACILITIES: FacilityDefinition[] = COMMERCIAL_CATEGORIES.map((item) => ({
  code: item.key as FacilityCode,
  label: item.label,
  description: FACILITY_SOURCE[item.key]?.description ?? "임대료 자료 없음",
  dbLinked: FACILITY_SOURCE[item.key]?.dbLinked ?? false,
}));

const DB_FACILITIES = FACILITIES.filter((facility): facility is FacilityDefinition & { code: DbFacilityCode } => facility.dbLinked);
const ZERO_RENT_FACILITIES = FACILITIES.filter((facility) => !facility.dbLinked);

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
  const [data, setData] = useState<Partial<Record<DbFacilityCode, RentResponse>>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function load(code: DbFacilityCode, refreshLiving = false) {
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

    try {
      for (const facility of ZERO_RENT_FACILITIES) {
        sessionStorage.setItem(`inrealtylab.rent.${facility.code}`, "0");
        sessionStorage.setItem(`inrealtylab.rent.${facility.code}.source`, JSON.stringify({
          source_kind: "PILOT_DEFAULT",
          source_name: "시범검토 기본값",
          rent_per_sqm_month: 0,
          unit: "KRW/sqm/month",
          note: "임대료 DB 미구축 시설은 시범검토 기간 동안 0원/㎡·월 적용",
        }));
      }
    } catch {
      // Continue if browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!pnu) return;
    setLoading(true);
    Promise.allSettled(DB_FACILITIES.map((facility) => load(facility.code)))
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
      setMessage(`임대주택 최근 실거래(${previousMonthYmd()})를 갱신했습니다.`);
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
        <span>임대료 기준</span>
        <strong>시설별 적용 임대료</strong>
      </div>

      <div className="control-policy-card">
        <strong>시범검토 적용 원칙</strong>
        <p>오피스·리테일·임대주택은 시장 조사자료에서 임대료를 가져옵니다. 실버하우스·헬스케어와 R&amp;D·랩은 각각 임대주택·오피스 임대료에서 파생합니다. 나머지 시설은 근거자료가 없어 임의로 채우지 않고 0원/㎡·월로 둡니다.</p>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>시설</th>
              <th style={{ textAlign: "left", padding: 10 }}>지역/권역</th>
              <th style={{ textAlign: "right", padding: 10 }}>임대료</th>
              <th style={{ textAlign: "center", padding: 10 }}>기준일</th>
              <th style={{ textAlign: "left", padding: 10 }}>출처/상태</th>
              <th style={{ textAlign: "right", padding: 10 }}>표본</th>
            </tr>
          </thead>
          <tbody>
            {FACILITIES.map((facility) => {
              if (!facility.dbLinked) {
                return (
                  <tr key={facility.code}>
                    <td style={{ padding: 10 }}><strong>{facility.label}</strong><div style={{ fontSize: 12, opacity: 0.7 }}>{facility.description}</div></td>
                    <td style={{ padding: 10 }}>-</td>
                    <td style={{ padding: 10, textAlign: "right" }}><strong>{formatRent(0)}</strong></td>
                    <td style={{ padding: 10, textAlign: "center" }}>시범검토</td>
                    <td style={{ padding: 10 }}>근거자료 없음 · 0원</td>
                    <td style={{ padding: 10, textAlign: "right" }}>-</td>
                  </tr>
                );
              }

              const code = facility.code as DbFacilityCode;
              const response = data[code];
              const preferred = code === "C01_OFFICE"
                ? response?.rows?.find((row) => row.submarket === "SEOUL_TOTAL") ?? response?.latest
                : response?.latest;
              return (
                <tr key={facility.code}>
                  <td style={{ padding: 10 }}><strong>{facility.label}</strong><div style={{ fontSize: 12, opacity: 0.7 }}>{facility.description}</div></td>
                  <td style={{ padding: 10 }}>{regionLabel(preferred?.submarket ?? preferred?.geography_name) ?? (code === "C02_RETAIL" ? "상권자료 대기" : "-")}</td>
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
          <strong>오피스 권역별 임대료:</strong>{" "}
          {officeRows.map((row) => `${row.submarket ?? "서울"} ${formatRent(row.rent_per_sqm_month)}`).join(" · ")}
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={refreshLiving} disabled={loading}>임대주택 최근 실거래 갱신</button>
        <span style={{ fontSize: 12, opacity: 0.72 }}>보증금 환산은 아직 적용하지 않고 실제 월세가 존재하는 거래의 ㎡당 월세 중앙값만 사용합니다.</span>
      </div>

      {message && <p style={{ marginTop: 10 }}>{message}</p>}
    </section>
  );
}
