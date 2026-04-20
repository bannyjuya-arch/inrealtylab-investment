"use client";

import { useMemo, useState } from "react";

type LookupResult = {
  siteName: string;
  address: string;
  officialLandPricePerPyeong: number;
  zoning: string;
  coords: {
    lat: number;
    lng: number;
  };
};

type EligibilityResult = {
  site: {
    address: string;
    area: number;
    landType: string;
    ownerType: string;
    pppEligible: boolean;
  };
  radar: {
    demand: number;
    accessibility: number;
    profitability: number;
    infrastructure: number;
    publicNeed: number;
  };
  facilitySignals: Array<{
    name: string;
    status: string;
    reason: string;
  }>;
  strategyText: string;
};

type CalculateResult = {
  summary: {
    projectIRR: number;
    avgDSCR: number;
    breakEvenYear: number;
    monthlyRent: number;
    totalCost: number;
  };
  cashflows: Array<{
    year: number;
    value: number;
  }>;
  warnings: string[];
};

type PresetKey = "performance" | "office" | "sports";

const presetDefaults: Record<
  PresetKey,
  {
    label: string;
    operationYears: number;
    constructionCostPerPyeong: number;
    occupancyRate: number;
    targetIRR: number;
    seatCount: number;
    interestRate: number;
  }
> = {
  performance: {
    label: "뮤지컬 공연장",
    operationYears: 30,
    constructionCostPerPyeong: 12000000,
    occupancyRate: 0.85,
    targetIRR: 0.07,
    seatCount: 850,
    interestRate: 0.045,
  },
  office: {
    label: "프라임 오피스",
    operationYears: 30,
    constructionCostPerPyeong: 14500000,
    occupancyRate: 0.9,
    targetIRR: 0.068,
    seatCount: 600,
    interestRate: 0.045,
  },
  sports: {
    label: "복합 체육시설",
    operationYears: 35,
    constructionCostPerPyeong: 13500000,
    occupancyRate: 0.78,
    targetIRR: 0.065,
    seatCount: 1200,
    interestRate: 0.045,
  },
};

function formatWon(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function statusColor(status: string) {
  if (status === "green") return "#28A745";
  if (status === "yellow") return "#D4AF37";
  return "#DC3545";
}

function buildRadarPoints(values: number[], size = 260) {
  const center = size / 2;
  const radius = 88;
  const angleStep = (Math.PI * 2) / values.length;

  return values
    .map((value, i) => {
      const ratio = value / 100;
      const angle = -Math.PI / 2 + i * angleStep;
      const x = center + Math.cos(angle) * radius * ratio;
      const y = center + Math.sin(angle) * radius * ratio;
      return `${x},${y}`;
    })
    .join(" ");
}

function buildRadarAxes(size = 260) {
  const center = size / 2;
  const radius = 88;
  const labels = ["수요", "접근성", "수익성", "인프라", "공공성"];
  const angleStep = (Math.PI * 2) / labels.length;

  return labels.map((label, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    const textX = center + Math.cos(angle) * (radius + 26);
    const textY = center + Math.sin(angle) * (radius + 26);
    return { label, x, y, textX, textY };
  });
}

function buildCashflowBars(cashflows: Array<{ year: number; value: number }>) {
  if (!cashflows.length) return [];
  const maxAbs = Math.max(...cashflows.map((c) => Math.abs(c.value)), 1);

  return cashflows.map((cf) => {
    const heightPct = Math.max(6, (Math.abs(cf.value) / maxAbs) * 100);
    let color = "#28A745";
    if (cf.year <= 3) color = "#DC3545";
    else if (cf.year >= 31) color = "#D4AF37";

    return { ...cf, heightPct, color };
  });
}

export default function Page() {
  const [query, setQuery] = useState("행당중학교");
  const [preset, setPreset] = useState<PresetKey>("performance");

  const [operationYears, setOperationYears] = useState(
    presetDefaults.performance.operationYears
  );
  const [constructionCostPerPyeong, setConstructionCostPerPyeong] = useState(
    presetDefaults.performance.constructionCostPerPyeong
  );
  const [occupancyRate, setOccupancyRate] = useState(
    presetDefaults.performance.occupancyRate
  );
  const [targetIRR, setTargetIRR] = useState(
    presetDefaults.performance.targetIRR
  );
  const [seatCount, setSeatCount] = useState(
    presetDefaults.performance.seatCount
  );
  const [interestRate, setInterestRate] = useState(
    presetDefaults.performance.interestRate
  );

  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [calc, setCalc] = useState<CalculateResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [savedScenarioId, setSavedScenarioId] = useState("");

  const radarValues = useMemo(() => {
    if (!eligibility) return [0, 0, 0, 0, 0];
    return [
      eligibility.radar.demand,
      eligibility.radar.accessibility,
      eligibility.radar.profitability,
      eligibility.radar.infrastructure,
      eligibility.radar.publicNeed,
    ];
  }, [eligibility]);

  const radarPoints = useMemo(() => buildRadarPoints(radarValues), [radarValues]);
  const radarAxes = useMemo(() => buildRadarAxes(), []);
  const bars = useMemo(() => buildCashflowBars(calc?.cashflows ?? []), [calc]);

  function applyPreset(nextPreset: PresetKey) {
    setPreset(nextPreset);
    const defaults = presetDefaults[nextPreset];
    setOperationYears(defaults.operationYears);
    setConstructionCostPerPyeong(defaults.constructionCostPerPyeong);
    setOccupancyRate(defaults.occupancyRate);
    setTargetIRR(defaults.targetIRR);
    setSeatCount(defaults.seatCount);
    setInterestRate(defaults.interestRate);
  }

  async function runSiteLookup() {
    setLoading("lookup");
    try {
      const res = await fetch("/api/site-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setLookup(data);
    } finally {
      setLoading(null);
    }
  }

  async function runEligibility() {
    setLoading("eligibility");
    try {
      const res = await fetch("/api/site-eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setEligibility(data);
    } finally {
      setLoading(null);
    }
  }

  async function runCalculate() {
    setLoading("calculate");
    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: {
            operationYears,
            constructionCostPerPyeong,
            occupancyRate,
            targetIRR,
            seatCount,
            interestRate,
            preset,
          },
        }),
      });
      const data = await res.json();
      setCalc(data);
    } finally {
      setLoading(null);
    }
  }

  async function saveScenario() {
    if (!calc) {
      setSaveMessage("먼저 수익성 계산을 실행하세요.");
      return;
    }

    setLoading("save");
    setSaveMessage("");

    try {
      const res = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: `${query} 프로젝트`,
          siteName: lookup?.siteName ?? `${query} 부지`,
          address: lookup?.address ?? query,
          scenarioName: `${presetDefaults[preset].label} 시나리오`,
          mode: preset,
          siteJson: {
            lookup,
            eligibility,
          },
          inputJson: {
            query,
            preset,
            operationYears,
            constructionCostPerPyeong,
            occupancyRate,
            targetIRR,
            seatCount,
            interestRate,
          },
          summaryJson: calc.summary,
          cashflowJson: calc.cashflows,
          sensitivityJson: eligibility?.radar ?? null,
          comparisonJson: null,
          warningsJson: calc.warnings,
        }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        setSavedScenarioId(data.scenario.id);
        setSaveMessage("시나리오가 DB에 저장되었습니다.");
      } else {
        setSaveMessage(`저장 실패: ${data?.message ?? "서버 응답 오류"}`);
      }
    } catch (error) {
      setSaveMessage(
        `시나리오 저장 중 오류: ${
          error instanceof Error ? error.message : "알 수 없음"
        }`
      );
    } finally {
      setLoading(null);
    }
  }

  function openPdf() {
    if (!savedScenarioId) {
      setSaveMessage("먼저 시나리오를 저장하세요.");
      return;
    }
    window.open(`/api/reports/${savedScenarioId}`, "_blank");
  }

  return (
    <main style={styles.page}>
      <div style={styles.sampleBadge}>SAMPLE</div>

      <div style={styles.shell}>
        <section style={styles.hero}>
          <div style={styles.badge}>IN-REALTY LAB · PF ANALYTICS</div>
          <h1 style={styles.heroTitle}>BOT / PF 시뮬레이터</h1>
          <p style={styles.heroDesc}>
            부지 조회, PPP 적격성, 장기 BOT 수익성, 전략 문구 생성을 한 화면에서
            검토하는 샘플 버전입니다.
          </p>
          <p style={styles.heroNotice}>
            현재 화면은 샘플 시연용 버전입니다. 실거래/실투자 판단 전 검토가 필요합니다.
          </p>
        </section>

        <section style={styles.layout}>
          <aside style={styles.sidebar}>
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>입력 패널</h2>
              <p style={styles.cardSub}>주소와 시나리오 조건을 설정합니다.</p>

              <label style={styles.label}>학교명 / 주소</label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={styles.input}
              />

              <div style={styles.buttonRow}>
                <button style={styles.button} onClick={runSiteLookup}>
                  {loading === "lookup" ? "조회 중..." : "부지 조회"}
                </button>
                <button style={styles.button} onClick={runEligibility}>
                  {loading === "eligibility" ? "분석 중..." : "적격성 분석"}
                </button>
              </div>

              <div style={styles.sectionDivider} />

              <label style={styles.label}>시설 프리셋</label>
              <div style={styles.presetRow}>
                {(["performance", "office", "sports"] as PresetKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => applyPreset(key)}
                    style={{
                      ...styles.presetButton,
                      ...(preset === key ? styles.presetButtonActive : {}),
                    }}
                  >
                    {presetDefaults[key].label}
                  </button>
                ))}
              </div>

              <div style={styles.sliderGroup}>
                <label style={styles.label}>
                  운영 기간: <strong>{operationYears}년</strong>
                </label>
                <input
                  type="range"
                  min={30}
                  max={40}
                  step={1}
                  value={operationYears}
                  onChange={(e) => setOperationYears(Number(e.target.value))}
                  style={styles.range}
                />
              </div>

              <div style={styles.sliderGroup}>
                <label style={styles.label}>
                  평당 공사비:{" "}
                  <strong>
                    {Math.round(constructionCostPerPyeong / 10000).toLocaleString(
                      "ko-KR"
                    )}
                    만 원
                  </strong>
                </label>
                <input
                  type="range"
                  min={12000000}
                  max={18000000}
                  step={100000}
                  value={constructionCostPerPyeong}
                  onChange={(e) =>
                    setConstructionCostPerPyeong(Number(e.target.value))
                  }
                  style={styles.range}
                />
              </div>

              <div style={styles.sliderGroup}>
                <label style={styles.label}>
                  가동률: <strong>{Math.round(occupancyRate * 100)}%</strong>
                </label>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={occupancyRate}
                  onChange={(e) => setOccupancyRate(Number(e.target.value))}
                  style={styles.range}
                />
              </div>

              <label style={styles.label}>목표 IRR</label>
              <input
                type="number"
                step="0.001"
                value={targetIRR}
                onChange={(e) => setTargetIRR(Number(e.target.value))}
                style={styles.input}
              />

              <label style={styles.label}>금리</label>
              <input
                type="number"
                step="0.001"
                value={interestRate}
                onChange={(e) => setInterestRate(Number(e.target.value))}
                style={styles.input}
              />

              <label style={styles.label}>좌석 수 / 수용량</label>
              <input
                type="number"
                value={seatCount}
                onChange={(e) => setSeatCount(Number(e.target.value))}
                style={styles.input}
              />

              <div style={styles.buttonRow}>
                <button style={styles.goldButton} onClick={runCalculate}>
                  {loading === "calculate" ? "계산 중..." : "수익성 계산"}
                </button>
              </div>

              <div style={styles.buttonRow}>
                <button style={styles.saveButton} onClick={saveScenario}>
                  {loading === "save" ? "저장 중..." : "시나리오 저장"}
                </button>
              </div>

              <div style={styles.buttonRow}>
                <button style={styles.button} onClick={openPdf}>
                  PDF 생성
                </button>
              </div>

              {saveMessage ? <p style={styles.saveMessage}>{saveMessage}</p> : null}
            </div>
          </aside>

          <section style={styles.main}>
            <div style={styles.kpiGrid}>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Project IRR</div>
                <div style={{ ...styles.kpiValue, color: "#D4AF37" }}>
                  {calc ? formatPercent(calc.summary.projectIRR) : "-"}
                </div>
              </div>

              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Avg. DSCR</div>
                <div
                  style={{
                    ...styles.kpiValue,
                    color:
                      calc && calc.summary.avgDSCR < 1.2 ? "#DC3545" : "#28A745",
                  }}
                >
                  {calc ? calc.summary.avgDSCR.toFixed(2) : "-"}
                </div>
              </div>

              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Break-even Year</div>
                <div style={styles.kpiValue}>
                  {calc ? `${calc.summary.breakEvenYear}Y` : "-"}
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <div>
                  <h2 style={styles.cardTitle}>40년 Cash Flow</h2>
                  <p style={styles.cardSub}>
                    건설기 / 운영기 / 수익 극대화 구간을 막대 시각화로 표시합니다.
                  </p>
                </div>
              </div>

              <div style={styles.chartWrap}>
                {bars.length > 0 ? (
                  <div style={styles.barChart}>
                    {bars.map((bar) => (
                      <div key={bar.year} style={styles.barItem}>
                        <div
                          title={`${bar.year}년 / ${bar.value.toLocaleString("ko-KR")}원`}
                          style={{
                            ...styles.bar,
                            height: `${bar.heightPct}%`,
                            background: bar.color,
                          }}
                        />
                        <div style={styles.barLabel}>{bar.year}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={styles.emptyBlock}>아직 계산 결과가 없습니다.</div>
                )}
              </div>

              {calc?.warnings?.length ? (
                <div style={styles.warningBox}>{calc.warnings.join(", ")}</div>
              ) : (
                <div style={styles.okBox}>현재 시나리오 기준 경고 없음</div>
              )}
            </div>
          </section>

          <aside style={styles.insight}>
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>부지 스펙</h2>
              <p style={styles.cardSub}>조회된 기본 부지 정보입니다.</p>

              {lookup ? (
                <div style={styles.detailList}>
                  <div><strong>부지명:</strong> {lookup.siteName}</div>
                  <div><strong>주소:</strong> {lookup.address}</div>
                  <div>
                    <strong>공시지가:</strong>{" "}
                    {lookup.officialLandPricePerPyeong.toLocaleString("ko-KR")}원 / 평
                  </div>
                  <div><strong>용도지역:</strong> {lookup.zoning}</div>
                  <div><strong>좌표:</strong> {lookup.coords.lat}, {lookup.coords.lng}</div>
                </div>
              ) : (
                <div style={styles.emptyBlock}>부지 조회 전입니다.</div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>PPP 적격성</h2>
              <p style={styles.cardSub}>공공성/적격성 요약입니다.</p>

              {eligibility ? (
                <>
                  <div
                    style={{
                      ...styles.badgeBox,
                      background: eligibility.site.pppEligible
                        ? "rgba(40,167,69,0.15)"
                        : "rgba(220,53,69,0.15)",
                      color: eligibility.site.pppEligible ? "#28A745" : "#DC3545",
                    }}
                  >
                    {eligibility.site.pppEligible ? "PPP 적격" : "PPP 검토 필요"}
                  </div>

                  <div style={styles.detailList}>
                    <div><strong>주소:</strong> {eligibility.site.address}</div>
                    <div><strong>면적:</strong> {eligibility.site.area}</div>
                    <div><strong>지목:</strong> {eligibility.site.landType}</div>
                    <div><strong>소유자 유형:</strong> {eligibility.site.ownerType}</div>
                  </div>
                </>
              ) : (
                <div style={styles.emptyBlock}>적격성 분석 전입니다.</div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>레이다 차트</h2>
              <p style={styles.cardSub}>수요, 접근성, 수익성, 인프라, 공공성</p>

              {eligibility ? (
                <div style={styles.radarWrap}>
                  <svg width="260" height="260" viewBox="0 0 260 260">
                    <circle cx="130" cy="130" r="88" fill="none" stroke="#314154" />
                    <circle cx="130" cy="130" r="66" fill="none" stroke="#314154" />
                    <circle cx="130" cy="130" r="44" fill="none" stroke="#314154" />
                    <circle cx="130" cy="130" r="22" fill="none" stroke="#314154" />

                    {radarAxes.map((axis) => (
                      <g key={axis.label}>
                        <line x1="130" y1="130" x2={axis.x} y2={axis.y} stroke="#314154" />
                        <text
                          x={axis.textX}
                          y={axis.textY}
                          fill="#cbd5e1"
                          fontSize="12"
                          textAnchor="middle"
                        >
                          {axis.label}
                        </text>
                      </g>
                    ))}

                    <polygon
                      points={radarPoints}
                      fill="rgba(212,175,55,0.24)"
                      stroke="#D4AF37"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
              ) : (
                <div style={styles.emptyBlock}>분석 결과가 없습니다.</div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>시설 적합성 신호등</h2>
              <p style={styles.cardSub}>시설별 도입 적정성 결과</p>

              {eligibility ? (
                <div style={styles.signalList}>
                  {eligibility.facilitySignals.map((item) => (
                    <div key={item.name} style={styles.signalItem}>
                      <div style={styles.signalHead}>
                        <span
                          style={{
                            ...styles.signalDot,
                            background: statusColor(item.status),
                          }}
                        />
                        <strong>{item.name}</strong>
                      </div>
                      <div style={styles.signalReason}>{item.reason}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={styles.emptyBlock}>신호등 결과가 없습니다.</div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>공공 기여 전략</h2>
              <p style={styles.cardSub}>자동 생성 협상 문구</p>

              {eligibility ? (
                <div style={styles.strategyBox}>{eligibility.strategyText}</div>
              ) : (
                <div style={styles.emptyBlock}>전략 문구가 없습니다.</div>
              )}
            </div>

            <div style={styles.card}>
              <h2 style={styles.cardTitle}>재무 요약</h2>
              <p style={styles.cardSub}>협상용 핵심 숫자</p>

              {calc ? (
                <div style={styles.detailList}>
                  <div><strong>IRR:</strong> {formatPercent(calc.summary.projectIRR)}</div>
                  <div><strong>Avg. DSCR:</strong> {calc.summary.avgDSCR.toFixed(2)}</div>
                  <div><strong>BEP:</strong> {calc.summary.breakEvenYear}년</div>
                  <div><strong>월 임대료:</strong> {formatWon(calc.summary.monthlyRent)}</div>
                  <div><strong>총사업비:</strong> {formatWon(calc.summary.totalCost)}</div>
                </div>
              ) : (
                <div style={styles.emptyBlock}>수익성 계산 전입니다.</div>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(86,169,255,0.12), transparent 22%), radial-gradient(circle at top right, rgba(212,175,55,0.10), transparent 18%), linear-gradient(180deg, #0d141c 0%, #101720 100%)",
    color: "#f3f6fa",
    padding: "20px",
    fontFamily: "Arial, sans-serif",
  },
  shell: {
    maxWidth: 1600,
    margin: "0 auto",
  },
  hero: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.05))",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 24,
    padding: 24,
    marginBottom: 18,
  },
  badge: {
    display: "inline-block",
    padding: "8px 12px",
    borderRadius: 999,
    background: "rgba(212,175,55,0.15)",
    color: "#D4AF37",
    fontSize: 12,
    fontWeight: 800,
    marginBottom: 12,
  },
  heroTitle: {
    margin: "0 0 8px",
    fontSize: 38,
  },
  heroDesc: {
    margin: 0,
    color: "#9ba7b5",
  },
  heroNotice: {
    marginTop: 12,
    color: "#fbbf24",
    fontWeight: 800,
    fontSize: 14,
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "330px minmax(0, 1fr) 330px",
    gap: 18,
    alignItems: "start",
  },
  sidebar: {},
  main: {
    minWidth: 0,
  },
  insight: {},
  card: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.05))",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 22,
    padding: 18,
    marginBottom: 16,
  },
  cardTitle: {
    margin: "0 0 4px",
    fontSize: 20,
  },
  cardSub: {
    margin: "0 0 14px",
    color: "#9ba7b5",
    fontSize: 13,
  },
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    alignItems: "flex-start",
  },
  label: {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 8,
    marginTop: 10,
    color: "#dce5ef",
  },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
  },
  buttonRow: {
    display: "flex",
    gap: 10,
    marginTop: 12,
    flexWrap: "wrap",
  },
  button: {
    flex: 1,
    minWidth: 120,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
  },
  goldButton: {
    width: "100%",
    padding: "13px 16px",
    borderRadius: 12,
    border: "1px solid #D4AF37",
    background: "#D4AF37",
    color: "#101720",
    cursor: "pointer",
    fontWeight: 800,
  },
  saveButton: {
    width: "100%",
    padding: "13px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
  },
  saveMessage: {
    marginTop: 12,
    color: "#cbd5e1",
    fontSize: 13,
  },
  sectionDivider: {
    borderTop: "1px solid rgba(255,255,255,0.08)",
    marginTop: 18,
  },
  presetRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  presetButton: {
    flex: 1,
    minWidth: 88,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#9ba7b5",
    cursor: "pointer",
    fontWeight: 700,
  },
  presetButtonActive: {
    background: "rgba(212,175,55,0.16)",
    border: "1px solid rgba(212,175,55,0.34)",
    color: "#D4AF37",
  },
  sliderGroup: {
    marginTop: 14,
  },
  range: {
    width: "100%",
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 14,
    marginBottom: 16,
  },
  kpiCard: {
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.05))",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 22,
    padding: 18,
  },
  kpiLabel: {
    fontSize: 13,
    color: "#9ba7b5",
    marginBottom: 8,
  },
  kpiValue: {
    fontSize: 38,
    fontWeight: 900,
    lineHeight: 1,
  },
  chartWrap: {
    background: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    padding: 16,
  },
  barChart: {
    height: 280,
    display: "flex",
    alignItems: "flex-end",
    gap: 6,
    overflowX: "auto",
    paddingBottom: 8,
  },
  barItem: {
    width: 18,
    minWidth: 18,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    height: "100%",
  },
  bar: {
    width: "100%",
    borderRadius: 6,
    minHeight: 10,
  },
  barLabel: {
    fontSize: 10,
    color: "#94a3b8",
  },
  warningBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(220,53,69,0.12)",
    color: "#ffd3d8",
    border: "1px solid rgba(220,53,69,0.3)",
    fontSize: 13,
  },
  okBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(40,167,69,0.12)",
    color: "#d7ffe0",
    border: "1px solid rgba(40,167,69,0.3)",
    fontSize: 13,
  },
  detailList: {
    display: "grid",
    gap: 8,
    color: "#dbe4ee",
    fontSize: 14,
  },
  emptyBlock: {
    color: "#94a3b8",
    fontSize: 14,
    padding: "10px 0",
  },
  badgeBox: {
    display: "inline-block",
    padding: "8px 12px",
    borderRadius: 999,
    fontWeight: 800,
    marginBottom: 12,
  },
  radarWrap: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
  },
  signalList: {
    display: "grid",
    gap: 10,
  },
  signalItem: {
    padding: 12,
    borderRadius: 12,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  signalHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  signalDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
    display: "inline-block",
  },
  signalReason: {
    fontSize: 13,
    color: "#cbd5e1",
  },
  strategyBox: {
    color: "#dbe4ee",
    lineHeight: 1.6,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 14,
  },
  sampleBadge: {
    position: "fixed",
    top: 16,
    right: 16,
    zIndex: 9999,
    background:
      "linear-gradient(135deg, #b88d14 0%, #d4af37 45%, #f3dc86 100%)",
    color: "#101720",
    padding: "10px 16px",
    borderRadius: 999,
    fontWeight: 900,
    fontSize: 12,
    letterSpacing: "0.08em",
    boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.25)",
  },
};