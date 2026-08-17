"use client";

import { useState } from "react";

type NeedResult = {
  facilityId: string;
  facilityName: string;
  facilityClass: "P-NR" | "P-R";
  sector: string;
  calcMethod: "ACCESS" | "RATIO" | "AREA" | "CAPACITY";
  targetDemand: number;
  effectiveDemand: number;
  existingSupply: number;
  unservedDemand: number;
  coverageRate: number;
  requiredUnits: number;
  unitDeficit: number;
  requiredCapacity: number;
  capacityDeficit: number;
  requiredArea: number;
  areaDeficit: number;
  requiredNfa: number;
  requiredGfa: number;
  needScore: number;
  needLevel: string;
  smartInfra: boolean;
  seniorFacility: boolean;
};

type DemandResponse = {
  ok: boolean;
  dataMode: "REQUEST" | "SAMPLE";
  summary: {
    facilityCount: number;
    highNeedCount: number;
    totalRequiredGfa: number;
    publicNonRevenueGfa: number;
    publicRevenueGfa: number;
  };
  results: NeedResult[];
};

const fmt = (value: number, digits = 0) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(value);

function levelLabel(level: string) {
  if (level === "VERY_HIGH") return "매우 높음";
  if (level === "HIGH") return "높음";
  if (level === "MEDIUM") return "보통";
  if (level === "LOW") return "낮음";
  return "매우 낮음";
}

function scoreColor(score: number) {
  if (score >= 80) return "#ef4444";
  if (score >= 60) return "#f59e0b";
  if (score >= 40) return "#d4af37";
  return "#22c55e";
}

export default function Part3DemandModule() {
  const [data, setData] = useState<DemandResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runDemandAnalysis() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/facility-demand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as DemandResponse;
      if (!res.ok || !json.ok) throw new Error("수요 분석 API 오류");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "수요 분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={styles.section}>
      <div style={styles.headerRow}>
        <div>
          <div style={styles.eyebrow}>PART 3 · DEMAND → FACILITY NEED</div>
          <h2 style={styles.title}>근린생활권 기반 공공시설 수요 분석</h2>
          <p style={styles.desc}>
            생활권 수요, 기존 공급, 접근성 및 시설별 공급기준을 결합해 부족 Capacity와
            필요 연면적을 산정합니다.
          </p>
        </div>
        <button style={styles.runButton} onClick={runDemandAnalysis} disabled={loading}>
          {loading ? "분석 중..." : "수요 분석 실행"}
        </button>
      </div>

      {error ? <div style={styles.error}>{error}</div> : null}

      {!data ? (
        <div style={styles.empty}>
          API 연결 전에는 샘플 입력값을 사용합니다. 실제 운영에서는 주민등록·SGIS·시설
          OpenAPI 데이터를 동일 스키마로 전달하면 됩니다.
        </div>
      ) : (
        <>
          <div style={styles.kpiGrid}>
            <Kpi label="분석 시설" value={`${data.summary.facilityCount}개`} />
            <Kpi label="수요 높음 이상" value={`${data.summary.highNeedCount}개`} />
            <Kpi
              label="총 필요 GFA"
              value={`${fmt(data.summary.totalRequiredGfa)}㎡`}
              accent
            />
            <Kpi
              label="P-NR 필요 GFA"
              value={`${fmt(data.summary.publicNonRevenueGfa)}㎡`}
            />
            <Kpi
              label="P-R 필요 GFA"
              value={`${fmt(data.summary.publicRevenueGfa)}㎡`}
            />
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>시설</th>
                  <th style={styles.th}>구분</th>
                  <th style={styles.th}>계산</th>
                  <th style={styles.th}>Target Demand</th>
                  <th style={styles.th}>충족률</th>
                  <th style={styles.th}>부족량</th>
                  <th style={styles.th}>필요 GFA</th>
                  <th style={styles.th}>Need</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.facilityId}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 800 }}>{r.facilityName}</div>
                      <div style={styles.tags}>
                        <span style={styles.tag}>{r.sector}</span>
                        {r.seniorFacility ? <span style={styles.tag}>SENIOR</span> : null}
                        {r.smartInfra ? <span style={styles.tag}>SMART</span> : null}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={r.facilityClass === "P-R" ? styles.prBadge : styles.pnrBadge}>
                        {r.facilityClass}
                      </span>
                    </td>
                    <td style={styles.td}>{r.calcMethod}</td>
                    <td style={styles.td}>{fmt(r.targetDemand)}</td>
                    <td style={styles.td}>{(r.coverageRate * 100).toFixed(1)}%</td>
                    <td style={styles.td}>{fmt(r.unservedDemand, 1)}</td>
                    <td style={styles.td}>{fmt(r.requiredGfa)}㎡</td>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 900, color: scoreColor(r.needScore) }}>
                        {r.needScore}
                      </div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        {levelLabel(r.needLevel)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.logicBox}>
            <strong>Calculation Engine</strong>
            <span>ACCESS · RATIO · AREA · CAPACITY</span>
            <span>API Data + Facility Standard DB → Facility Need</span>
          </div>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={styles.kpi}>
      <div style={styles.kpiLabel}>{label}</div>
      <div style={{ ...styles.kpiValue, ...(accent ? { color: "#D4AF37" } : {}) }}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  section: {
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 24,
    background: "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.05))",
    padding: 24,
    marginBottom: 18,
    color: "#f3f6fa",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  eyebrow: {
    color: "#D4AF37",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.08em",
    marginBottom: 8,
  },
  title: { margin: "0 0 8px", fontSize: 26 },
  desc: { margin: 0, color: "#9ba7b5", maxWidth: 820, lineHeight: 1.6 },
  runButton: {
    border: "1px solid rgba(212,175,55,0.55)",
    background: "linear-gradient(135deg,#b88d14,#d4af37,#f3dc86)",
    color: "#101720",
    borderRadius: 14,
    padding: "12px 18px",
    fontWeight: 900,
    cursor: "pointer",
  },
  empty: {
    marginTop: 18,
    padding: 18,
    borderRadius: 16,
    background: "rgba(255,255,255,0.04)",
    color: "#9ba7b5",
  },
  error: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    background: "rgba(239,68,68,0.12)",
    color: "#fecaca",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
    gap: 12,
    marginTop: 20,
  },
  kpi: {
    padding: 16,
    borderRadius: 16,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  kpiLabel: { fontSize: 12, color: "#9ba7b5", marginBottom: 8 },
  kpiValue: { fontSize: 24, fontWeight: 900 },
  tableWrap: { overflowX: "auto", marginTop: 18 },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 900 },
  th: {
    textAlign: "left",
    padding: "10px 8px",
    fontSize: 12,
    color: "#94a3b8",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
  },
  td: {
    padding: "12px 8px",
    fontSize: 13,
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    verticalAlign: "top",
  },
  tags: { display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 },
  tag: {
    fontSize: 10,
    color: "#cbd5e1",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 999,
    padding: "3px 6px",
  },
  pnrBadge: {
    color: "#93c5fd",
    background: "rgba(59,130,246,.12)",
    borderRadius: 999,
    padding: "4px 7px",
    fontSize: 11,
    fontWeight: 800,
  },
  prBadge: {
    color: "#fde68a",
    background: "rgba(212,175,55,.12)",
    borderRadius: 999,
    padding: "4px 7px",
    fontSize: 11,
    fontWeight: 800,
  },
  logicBox: {
    marginTop: 16,
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
    padding: 14,
    borderRadius: 14,
    background: "rgba(16,23,32,.55)",
    color: "#94a3b8",
    fontSize: 12,
  },
};
