"use client";

import { FormEvent, useState } from "react";
import "./control.css";

type Gate = {
  key: string;
  label: string;
  status: "PASS" | "FAIL" | "REVIEW";
  detail: string;
};

type OwnershipRecord = {
  pnu: string;
  legalDong: string;
  jibun: string;
  landCategory: string;
  areaSqm: number | null;
  officialLandPrice: number | null;
  ownerClass: string;
  ownerSector: "PUBLIC" | "PRIVATE" | "UNKNOWN";
  ownerType: string;
  ownerTypeLabel: string;
  nationalInstitutionClass: string | null;
  ownershipChangeCause: string | null;
  ownershipChangeDate: string | null;
  coOwnerCount: number;
  dataDate: string | null;
};

type OwnershipResponse = {
  ok: boolean;
  message?: string;
  pnu?: string;
  records?: OwnershipRecord[];
  assessment?: {
    inScope: boolean;
    readiness: string;
    headline: string;
    summary: string;
    governingRegime?: string;
    ownerClasses: string[];
    ownerTypes: string[];
    gates: Gate[];
    candidateRoutes: string[];
    unresolved: string[];
  };
  source?: {
    name: string;
    endpoint: string;
    queriedAt: string;
    totalCount: number;
  };
};

export default function ControlPage() {
  const [pnu, setPnu] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OwnershipResponse | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{19}$/.test(pnu.trim())) {
      setResult({ ok: false, message: "19자리 PNU를 입력해 주세요." });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/ownership?pnu=${encodeURIComponent(pnu.trim())}`);
      const data = (await response.json()) as OwnershipResponse;
      setResult(data);
    } catch (error) {
      setResult({ ok: false, message: error instanceof Error ? error.message : "조회 중 오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  }

  const assessment = result?.assessment;
  const firstRecord = result?.records?.[0];

  return (
    <main className="control-shell">
      <header className="control-header">
        <div>
          <div className="product-kicker">INRealtyLab · Part 2</div>
          <h1>소유 · 사업추진 가능성 분석</h1>
          <p>공공소유 여부를 먼저 확인하고, 관리주체·재산구분·현재 사용상태를 거쳐 사업추진 구조를 검토합니다.</p>
        </div>
        <a className="control-back" href="/">현황분석으로</a>
      </header>

      <section className="control-policy-card">
        <strong>현재 분석대상</strong>
        <p>국가 · 지방자치단체 · 공공기관 등 공공소유 부지만 검토합니다. 민간소유가 확인되면 Part 2 분석을 종료합니다.</p>
      </section>

      <form className="control-search" onSubmit={handleSubmit}>
        <input
          value={pnu}
          onChange={(event) => setPnu(event.target.value.replace(/\D/g, "").slice(0, 19))}
          placeholder="19자리 PNU 입력"
          inputMode="numeric"
          aria-label="PNU 입력"
        />
        <button disabled={loading} type="submit">{loading ? "조회 중" : "소유 확인"}</button>
      </form>

      {result && !result.ok && <div className="control-error">{result.message}</div>}

      {result?.ok && assessment && (
        <div className="control-layout">
          <section className="control-summary-card">
            <div className="control-summary-head">
              <div>
                <span>OWNERSHIP GATE</span>
                <strong>{assessment.headline}</strong>
              </div>
              <StatusBadge inScope={assessment.inScope} readiness={assessment.readiness} />
            </div>
            <p>{assessment.summary}</p>

            <div className="control-metrics">
              <Metric label="소유구분" value={assessment.ownerClasses.join(", ") || "확인 필요"} />
              <Metric label="소유주체 유형" value={firstRecord?.ownerTypeLabel ?? "확인 필요"} />
              <Metric label="법정동" value={firstRecord?.legalDong ?? "-"} />
              <Metric label="지번" value={firstRecord?.jibun ?? "-"} />
              <Metric label="지목" value={firstRecord?.landCategory ?? "-"} />
              <Metric label="공유인수" value={firstRecord ? `${firstRecord.coOwnerCount.toLocaleString("ko-KR")}명` : "-"} />
            </div>
          </section>

          {assessment.inScope ? (
            <>
              <section className="control-section">
                <div className="control-section-title">
                  <span>CONTROL CHECK</span>
                  <strong>사업추진 선결조건</strong>
                </div>
                <div className="gate-list">
                  {assessment.gates.map((gate) => (
                    <article className="gate-row" key={gate.key}>
                      <div>
                        <strong>{gate.label}</strong>
                        <p>{gate.detail}</p>
                      </div>
                      <span className={`gate-status ${gate.status.toLowerCase()}`}>{gate.status === "PASS" ? "확인" : gate.status === "FAIL" ? "제외" : "확인 필요"}</span>
                    </article>
                  ))}
                </div>
              </section>

              <section className="control-section">
                <div className="control-section-title">
                  <span>DELIVERY OPTIONS</span>
                  <strong>검토 가능한 사업추진 방식</strong>
                </div>
                {assessment.governingRegime && <div className="regime-note">{assessment.governingRegime}</div>}
                <div className="route-list">
                  {assessment.candidateRoutes.map((route, index) => (
                    <article key={route}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{route}</strong>
                    </article>
                  ))}
                </div>
                <div className="control-warning">
                  위 사업방식은 소유구분만으로 도출한 1차 후보입니다. 관리주체, 재산구분, 현재 사용상태와 권한관계를 확인하기 전에는 실제 추진 가능 방식으로 확정하지 않습니다.
                </div>
              </section>

              <section className="control-section">
                <div className="control-section-title">
                  <span>NEXT DATA</span>
                  <strong>추가 확인 필요정보</strong>
                </div>
                <ul className="unresolved-list">
                  {assessment.unresolved.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
            </>
          ) : (
            <section className="out-of-scope-card">
              <strong>{assessment.readiness === "OUT_OF_SCOPE_PRIVATE" ? "민간소유 부지는 현재 분석하지 않습니다." : "공공소유 확인이 필요합니다."}</strong>
              <p>공공소유 부지만 관리주체·재산구분·PPP/위탁개발 등 후속 분석으로 진행합니다.</p>
            </section>
          )}

          <section className="source-trace-card">
            <strong>Source Trace</strong>
            <dl>
              <div><dt>출처</dt><dd>{result.source?.name}</dd></div>
              <div><dt>PNU</dt><dd>{result.pnu}</dd></div>
              <div><dt>데이터 기준일</dt><dd>{firstRecord?.dataDate ?? "응답값 없음"}</dd></div>
              <div><dt>조회시각</dt><dd>{result.source?.queriedAt ? new Date(result.source.queriedAt).toLocaleString("ko-KR") : "-"}</dd></div>
            </dl>
            <p>개인 성명·주민등록번호·상세 거주지 등 개인정보는 표시하지 않습니다.</p>
          </section>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function StatusBadge({ inScope, readiness }: { inScope: boolean; readiness: string }) {
  const label = inScope ? "공공소유 · 후속검토" : readiness === "OUT_OF_SCOPE_PRIVATE" ? "검토대상 제외" : "소유 확인 필요";
  return <span className={`control-badge ${inScope ? "public" : readiness === "OUT_OF_SCOPE_PRIVATE" ? "private" : "review"}`}>{label}</span>;
}
