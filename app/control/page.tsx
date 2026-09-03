"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import PublicAssetDetails from "./PublicAssetDetails";
import SiteProgram from "../components/SiteProgram";
import StructureChoice from "../components/StructureChoice";
import ProgramChoice from "../components/ProgramChoice";
import "./control.css";

type Gate = {
  key: string;
  label: string;
  status: "PASS" | "FAIL" | "REVIEW";
  detail: string;
};

type AssetClassStatus = "ADMINISTRATIVE" | "GENERAL" | "UNKNOWN";

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

type OwnershipAssessment = {
  inScope: boolean;
  readiness: string;
  headline: string;
  summary: string;
  governingRegime?: string;
  ownerClasses: string[];
  ownerTypes: string[];
  assetClass?: AssetClassStatus;
  assetClassBasis?: string;
  gates: Gate[];
  candidateRoutes: string[];
  unresolved: string[];
};

type OwnershipResponse = {
  ok: boolean;
  message?: string;
  pnu?: string;
  records?: OwnershipRecord[];
  assessment?: OwnershipAssessment;
  source?: {
    name: string;
    endpoint: string;
    queriedAt: string;
    totalCount: number;
  };
};

type ParcelResult = {
  pnu: string;
  result: OwnershipResponse;
};

function isValidPnu(value: string) {
  return /^\d{10}[12]\d{8}$/.test(value);
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export default function ControlPage() {
  const [pnu, setPnu] = useState("");
  const [loading, setLoading] = useState(false);
  const [parcelResults, setParcelResults] = useState<ParcelResult[]>([]);
  const [pageError, setPageError] = useState("");

  async function lookupPnus(pnus: string[]) {
    const validPnus = unique(pnus.map((item) => item.trim())).filter(isValidPnu);
    if (!validPnus.length) {
      setPageError("유효한 PNU가 없습니다. 현황분석에서 필지를 다시 선택해 주세요.");
      setParcelResults([]);
      return;
    }

    setLoading(true);
    setPageError("");
    try {
      const responses = await Promise.all(
        validPnus.map(async (item) => {
          try {
            const response = await fetch(`/api/ownership?pnu=${encodeURIComponent(item)}`, { cache: "no-store" });
            const data = (await response.json()) as OwnershipResponse;
            return { pnu: item, result: data };
          } catch (error) {
            return {
              pnu: item,
              result: {
                ok: false,
                message: error instanceof Error ? error.message : "조회 중 오류가 발생했습니다.",
              },
            };
          }
        })
      );
      setParcelResults(responses);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromSite = params.get("pnus") ?? params.get("pnu") ?? "";
    const pnus = fromSite.split(",").map((item) => item.trim()).filter(Boolean);
    if (!pnus.length) return;

    setPnu(pnus[0]);
    void lookupPnus(pnus);
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = pnu.trim();
    if (!isValidPnu(value)) {
      setPageError("PNU는 19자리이며 11번째 자리는 일반필지 1 또는 산 2여야 합니다.");
      setParcelResults([]);
      return;
    }
    void lookupPnus([value]);
  }

  const successful = parcelResults.filter((item) => item.result.ok && item.result.assessment);
  const failures = parcelResults.filter((item) => !item.result.ok);
  const assessments = successful.map((item) => item.result.assessment!);

  const overall = useMemo(() => {
    if (!parcelResults.length) return null;
    if (failures.length) {
      return {
        status: "REVIEW",
        headline: "일부 필지 소유정보 확인 필요",
        summary: `${parcelResults.length}개 필지 중 ${failures.length}개 필지의 소유정보를 확인하지 못했습니다. 모든 필지 확인 전에는 사업추진 가능성을 확정하지 않습니다.`,
      };
    }

    if (assessments.some((item) => item.readiness === "OUT_OF_SCOPE_PRIVATE")) {
      return {
        status: "PRIVATE",
        headline: "민간소유 포함 — 현재 검토대상 제외",
        summary: "선택 필지 중 민간소유가 포함되어 현재 INRealtyLab Part 2 분석대상에서 제외합니다.",
      };
    }

    if (assessments.length && assessments.every((item) => item.inScope)) {
      return {
        status: "PUBLIC",
        headline: "선택 필지 공공소유 확인 — 후속 사업추진 검토 가능",
        summary: `${assessments.length}개 필지 모두 공공소유로 확인되었습니다. 관리주체·재산구분·현재 사용상태·의사결정권자를 추가 확인합니다.`,
      };
    }

    return {
      status: "REVIEW",
      headline: "공공소유 여부 추가 확인 필요",
      summary: "선택 필지 중 소유구분이 명확하지 않은 필지가 있어 후속 사업추진 분석을 보류합니다.",
    };
  }, [parcelResults, failures.length, assessments]);

  const primaryAssessment = successful.find((item) => item.result.assessment?.inScope)?.result.assessment;
  const gates = primaryAssessment?.gates ?? [];
  const candidateRoutes = unique(successful.flatMap((item) => item.result.assessment?.candidateRoutes ?? []));
  const unresolved = unique(successful.flatMap((item) => item.result.assessment?.unresolved ?? []));
  const ownerTypeLabels = unique(successful.flatMap((item) => item.result.records?.map((record) => record.ownerTypeLabel) ?? []));
  const ownerClasses = unique(successful.flatMap((item) => item.result.assessment?.ownerClasses ?? []));

  const projectDirection = useMemo(() => {
    const assetClass = primaryAssessment?.assetClass ?? "UNKNOWN";

    if (assetClass === "ADMINISTRATIVE") {
      return {
        status: "조건부 추진 가능",
        tone: "conditional",
        priority: "기존 공공기능 유지형 복합화·관리위탁·사용허가 구조 우선 검토",
        excluded: "일반재산 위탁개발",
        prerequisites: ["관리권자 확인", "현재 공공기능 유지조건 확인", "사업 의사결정권자 확인", "필요 시 용도변경·용도폐지 가능성 검토"],
      };
    }

    if (assetClass === "GENERAL") {
      return {
        status: "조건부 추진 가능",
        tone: "conditional",
        priority: "일반재산 위탁개발·대부·사용수익 기반 사업구조 우선 검토",
        excluded: "행정재산 전용 관리위탁 구조",
        prerequisites: ["관리권자 확인", "현재 사용·점유 상태 확인", "사업 의사결정권자 확인", "대부·개발 관련 내부절차 확인"],
      };
    }

    return {
      status: "추가 확인 필요",
      tone: "review",
      priority: "재산구분 확인 후 사업구조 판정",
      excluded: "일반재산 위탁개발 확정 판단",
      prerequisites: ["행정재산 / 일반재산 확인", "관리권자 확인", "현재 공공기능 확인", "사업 의사결정권자 확인"],
    };
  }, [primaryAssessment?.assetClass]);

  return (
    <main className="control-shell">
      <header className="control-header">
        <div>
          <div className="product-kicker">INRealtyLab · Part 2</div>
          <h1>소유 · 사업추진 가능성 분석</h1>
          <p>현황분석에서 선택한 필지의 PNU를 자동으로 넘겨 공공소유 여부부터 확인합니다.</p>
        </div>
        <a className="control-back" href="/">현황분석으로</a>
      </header>

      <section className="control-policy-card">
        <strong>현재 분석대상</strong>
        <p>국가 · 지방자치단체 · 공공기관 등 공공소유 부지만 검토합니다. 선택 필지 중 민간소유가 하나라도 확인되면 Part 2 분석을 종료합니다.</p>
      </section>

      <form className="control-search" onSubmit={handleSubmit}>
        <input
          value={pnu}
          onChange={(event) => setPnu(event.target.value.replace(/\D/g, "").slice(0, 19))}
          placeholder="현황분석에서 자동 전달 · 필요 시 PNU 직접 입력"
          inputMode="numeric"
          aria-label="PNU 입력"
        />
        <button disabled={loading} type="submit">{loading ? "자동 조회 중" : "다시 조회"}</button>
      </form>

      {loading && <div className="control-policy-card"><strong>선택 필지 소유정보를 자동 조회하고 있습니다.</strong></div>}
      {pageError && <div className="control-error">{pageError}</div>}

      {overall && (
        <div className="control-layout">
          <section className="control-summary-card">
            <div className="control-summary-head">
              <div>
                <span>OWNERSHIP GATE · {parcelResults.length} PARCELS</span>
                <strong>{overall.headline}</strong>
              </div>
              <span className={`control-badge ${overall.status === "PUBLIC" ? "public" : overall.status === "PRIVATE" ? "private" : "review"}`}>
                {overall.status === "PUBLIC" ? "공공소유 · 후속검토" : overall.status === "PRIVATE" ? "검토대상 제외" : "확인 필요"}
              </span>
            </div>
            <p>{overall.summary}</p>
          </section>

          {/* 2026-09-03: 기존 Part 1의 REGULATION·USE·CAPACITY를 STEP 2로 이관 */}
          <SiteProgram />

          {/* 2026-09-03: 사업방식·사업주체 두 축 선택 */}
          <StructureChoice />

          {/* 2026-09-03: 시설 구성 — 1차 제안 후 사용자 수정 */}
          <ProgramChoice />

          <section className="control-section">
            <div className="control-section-title">
              <span>PARCEL OWNERSHIP</span>
              <strong>필지별 소유확인</strong>
            </div>
            <div className="route-list">
              {parcelResults.map(({ pnu: parcelPnu, result }, index) => {
                const assessment = result.assessment;
                const record = result.records?.[0];
                return (
                  <article key={parcelPnu} style={{ display: "block" }}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{assessment?.ownerClasses.join(", ") || result.message || "확인 필요"}</strong>
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                      PNU {parcelPnu}<br />
                      {record?.legalDong ? `${record.legalDong} ${record.jibun}` : "소재지 정보 확인 필요"}<br />
                      소유주체 유형 {record?.ownerTypeLabel ?? "확인 필요"}
                    </div>
                    {record && (
                      <PublicAssetDetails
                        ownerType={record.ownerType}
                        legalDong={record.legalDong}
                        jibun={record.jibun}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {overall.status === "PUBLIC" && (
            <>
              <section className="control-section">
                <div className="control-section-title">
                  <span>CONTROL CHECK</span>
                  <strong>사업추진 선결조건</strong>
                </div>
                <div className="gate-list">
                  {gates.map((gate) => (
                    <article className="gate-row" key={gate.key}>
                      <div><strong>{gate.label}</strong><p>{gate.detail}</p></div>
                      <span className={`gate-status ${gate.status.toLowerCase()}`}>{gate.status === "PASS" ? "확인" : "확인 필요"}</span>
                    </article>
                  ))}
                </div>
              </section>

              <section className="control-section">
                <div className="control-section-title">
                  <span>DELIVERY OPTIONS</span>
                  <strong>1차 사업추진 방식 후보</strong>
                </div>
                <div className="route-list">
                  {candidateRoutes.map((route, index) => (
                    <article key={route}><span>{String(index + 1).padStart(2, "0")}</span><strong>{route}</strong></article>
                  ))}
                </div>
                <div className="control-warning">관리주체, 재산구분, 현재 사용상태와 권한관계를 확인하기 전에는 실제 추진 가능 방식으로 확정하지 않습니다.</div>
              </section>

              <section className="control-section">
                <div className="control-section-title"><span>NEXT DATA</span><strong>추가 확인 필요정보</strong></div>
                <ul className="unresolved-list">{unresolved.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>

              <section className="project-direction-card">
                <div className="control-section-title">
                  <span>PROJECT DIRECTION</span>
                  <strong>사업추진 방향</strong>
                </div>

                <div className="direction-status-row">
                  <div>
                    <span>현재 판정</span>
                    <strong>{projectDirection.status}</strong>
                  </div>
                  <span className={`direction-badge ${projectDirection.tone}`}>{projectDirection.status}</span>
                </div>

                <div className="direction-grid">
                  <div className="direction-block">
                    <span>현재 확인</span>
                    <ul>
                      <li><strong>공공소유</strong><b>PASS</b></li>
                      <li><strong>소유유형</strong><b>{ownerTypeLabels.join(", ") || "확인 필요"}</b></li>
                      <li><strong>소유구분</strong><b>{ownerClasses.join(", ") || "확인 필요"}</b></li>
                    </ul>
                  </div>

                  <div className="direction-block">
                    <span>핵심 선결조건</span>
                    <ul className="direction-prerequisites">
                      {projectDirection.prerequisites.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                </div>

                <div className="direction-decision-grid">
                  <div className="direction-decision primary">
                    <span>현재 우선 검토 방향</span>
                    <strong>{projectDirection.priority}</strong>
                  </div>
                  <div className="direction-decision excluded">
                    <span>현재 제외</span>
                    <strong>{projectDirection.excluded}</strong>
                  </div>
                </div>

                <p className="direction-note">재산구분·관리권자·현재 공공기능·의사결정권자 정보가 추가되면 이 판정은 자동으로 갱신됩니다.</p>
              </section>
            </>
          )}

          {failures.length > 0 && (
            <section className="out-of-scope-card">
              <strong>조회 실패 필지</strong>
              {failures.map((item) => <p key={item.pnu}>{item.pnu} · {item.result.message}</p>)}
            </section>
          )}

          <section className="source-trace-card">
            <strong>Source Trace</strong>
            <dl>
              <div><dt>출처</dt><dd>VWorld 국토정보 토지소유정보</dd></div>
              <div><dt>조회 필지수</dt><dd>{parcelResults.length}필지</dd></div>
              <div><dt>확인 성공</dt><dd>{successful.length}필지</dd></div>
              <div><dt>조회 실패</dt><dd>{failures.length}필지</dd></div>
            </dl>
            <p>서울 시·도유지인 경우 서울특별시 시유재산 공개자료를 추가 조회해 재산관리관 후보를 표시합니다.</p>
            <p>개인 성명·주민등록번호·상세 거주지 등 개인정보는 표시하지 않습니다.</p>
          </section>
        </div>
      )}
    </main>
  );
}
