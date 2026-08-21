"use client";

import { useEffect, useMemo, useState } from "react";

type FacilityRow = {
  facility_code: string;
  category_code: string;
  category_name: string;
  business_model: string | null;
  legal_status: string;
  selectable: boolean;
  ratio_pct: number;
};

type AllocationResponse = {
  ok: boolean;
  message?: string;
  pnu?: string;
  aboveGroundGfaSqm?: number | null;
  commercialPoolGfaSqm?: number | null;
  totalRatioPct?: number;
  remainingRatioPct?: number;
  allocationComplete?: boolean;
  scenario?: {
    scenario_code: string;
    scenario_name: string;
    public_ratio_pct: number;
    commercial_ratio_pct: number;
  };
  facilities?: FacilityRow[];
};

function readContext() {
  const params = new URLSearchParams(window.location.search);
  const pnu = (params.get("pnus") ?? params.get("pnu") ?? "").split(",")[0]?.trim() ?? "";
  let gfa: number | null = null;

  try {
    const raw = params.get("part1") ?? sessionStorage.getItem("inrealtylab.part1Snapshot") ?? "";
    if (raw) {
      const snapshot = JSON.parse(raw);
      const scenarios = Array.isArray(snapshot?.scenarios) ? snapshot.scenarios : [];
      const statutory = scenarios.find((item: any) => item?.label === "법정 최대") ?? scenarios.at(-1);
      const value = Number(statutory?.grossFloorAreaSqm);
      if (Number.isFinite(value) && value > 0) gfa = value;
    }
  } catch {
    // Keep null if Part 1 snapshot is unavailable.
  }

  return { pnu, gfa };
}

export default function CommercialAllocationTable() {
  const [pnu, setPnu] = useState("");
  const [aboveGroundGfaSqm, setAboveGroundGfaSqm] = useState<number | null>(null);
  const [rows, setRows] = useState<FacilityRow[]>([]);
  const [scenario, setScenario] = useState<AllocationResponse["scenario"]>();
  const [commercialPoolGfaSqm, setCommercialPoolGfaSqm] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const total = useMemo(() => rows.reduce((sum, row) => sum + Number(row.ratio_pct || 0), 0), [rows]);
  const remaining = Math.max(0, 100 - total);
  const complete = Math.abs(total - 100) < 0.000001;

  useEffect(() => {
    const ctx = readContext();
    setPnu(ctx.pnu);
    setAboveGroundGfaSqm(ctx.gfa);

    if (!/^\d{19}$/.test(ctx.pnu)) return;

    const qs = new URLSearchParams({ pnu: ctx.pnu, scenarioCode: "BASE" });
    if (ctx.gfa) qs.set("aboveGroundGfaSqm", String(ctx.gfa));

    setLoading(true);
    fetch(`/api/commercial-allocation?${qs.toString()}`, { cache: "no-store" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) throw new Error(data?.message ?? "수익시설 배분정보를 불러오지 못했습니다.");
        setRows(data.facilities ?? []);
        setScenario(data.scenario);
        setCommercialPoolGfaSqm(data.commercialPoolGfaSqm ?? null);
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : "조회 중 오류가 발생했습니다."))
      .finally(() => setLoading(false));
  }, []);

  function updateRatio(code: string, raw: string) {
    const nextValue = Math.max(0, Math.min(100, Number(raw || 0)));
    const current = rows.find((row) => row.facility_code === code)?.ratio_pct ?? 0;
    const nextTotal = total - current + nextValue;

    if (nextTotal > 100.000001) {
      setMessage(`합계가 100%를 넘을 수 없습니다. 현재 잔여 비율은 ${remaining.toFixed(1)}%입니다.`);
      return;
    }

    setMessage("");
    setRows((currentRows) => currentRows.map((row) =>
      row.facility_code === code ? { ...row, ratio_pct: nextValue } : row
    ));
  }

  async function save() {
    if (!/^\d{19}$/.test(pnu)) {
      setMessage("유효한 PNU가 없습니다.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/commercial-allocation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pnu,
          scenarioCode: "BASE",
          aboveGroundGfaSqm,
          allocations: rows.map((row) => ({
            facility_code: row.facility_code,
            ratio_pct: Number(row.ratio_pct || 0),
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data?.message ?? "저장에 실패했습니다.");
      setMessage(complete ? "수익시설 면적배분이 100%로 확정되었습니다." : `저장되었습니다. 남은 비율 ${remaining.toFixed(1)}%를 배분해 주세요.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  if (!/^\d{19}$/.test(pnu)) return null;

  return (
    <section className="control-section commercial-allocation-section">
      <div className="control-section-title">
        <span>COMMERCIAL PROGRAM</span>
        <strong>수익시설 비율 직접 배분</strong>
      </div>

      <div className="control-policy-card">
        <strong>배분 원칙</strong>
        <p>각 시설은 0%도 가능합니다. 합계는 100%를 넘을 수 없으며, 정확히 100%가 되어야 수익시설 면적배분이 완료됩니다.</p>
      </div>

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <div><span>시나리오</span><strong>{scenario?.scenario_name ?? "균형형"}</strong></div>
        <div><span>수익시설 비중</span><strong>{scenario?.commercial_ratio_pct ?? 60}%</strong></div>
        <div><span>수익시설 Pool</span><strong>{commercialPoolGfaSqm ? `${Math.round(commercialPoolGfaSqm).toLocaleString("ko-KR")}㎡` : "확인 필요"}</strong></div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 10 }}>시설</th>
              <th style={{ textAlign: "center", padding: 10 }}>법적 상태</th>
              <th style={{ textAlign: "right", padding: 10 }}>비율</th>
              <th style={{ textAlign: "right", padding: 10 }}>배분면적</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const area = complete && commercialPoolGfaSqm != null
                ? commercialPoolGfaSqm * Number(row.ratio_pct || 0) / 100
                : null;
              return (
                <tr key={row.facility_code} style={{ opacity: row.selectable ? 1 : 0.45 }}>
                  <td style={{ padding: 10 }}><strong>{row.category_code} · {row.category_name}</strong></td>
                  <td style={{ padding: 10, textAlign: "center" }}>{row.selectable ? (row.legal_status === "CONDITIONAL" ? "조건부" : "가능") : "불가/미확인"}</td>
                  <td style={{ padding: 10, textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={row.ratio_pct}
                      disabled={!row.selectable}
                      onChange={(e) => updateRatio(row.facility_code, e.target.value)}
                      style={{ width: 86, textAlign: "right" }}
                    /> %
                  </td>
                  <td style={{ padding: 10, textAlign: "right" }}>{area == null ? "미확정" : `${Math.round(area).toLocaleString("ko-KR")}㎡`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={`control-policy-card`} style={{ marginTop: 16 }}>
        <strong>합계 {total.toFixed(1)}% · 잔여 {remaining.toFixed(1)}%</strong>
        <p>{complete ? "100% 배분 완료 — 시설별 연면적을 확정할 수 있습니다." : "100%가 되기 전까지 시설별 면적은 확정하지 않습니다."}</p>
        <button type="button" onClick={save} disabled={loading}>{loading ? "저장 중" : "비율 저장"}</button>
      </div>

      {message && <div className="control-warning" style={{ marginTop: 12 }}>{message}</div>}
    </section>
  );
}
