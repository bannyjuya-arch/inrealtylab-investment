"use client";

export default function ReportLauncher() {
  function openReport() {
    const params = new URLSearchParams(window.location.search);
    const pnus = params.get("pnus") ?? params.get("pnu") ?? "";
    const part1 = params.get("part1") ?? "";

    if (part1) {
      try {
        sessionStorage.setItem("inrealtylab.part1Snapshot", part1);
      } catch {
        // Continue even if browser storage is unavailable.
      }
    }

    const next = new URLSearchParams();
    if (pnus) next.set("pnus", pnus);
    if (part1) next.set("part1", part1);
    window.location.href = `/report?${next.toString()}`;
  }

  return (
    <section style={{ maxWidth: 1180, margin: "0 auto 40px", padding: "0 20px" }}>
      <div className="project-direction-card" style={{ marginTop: 20 }}>
        <div className="control-section-title">
          <span>PART 3 · EXECUTIVE REPORT</span>
          <strong>수요 · 사업성 · 사업추진 약식검토</strong>
        </div>
        <p className="direction-note">
          Part 1의 개발가능 규모와 Part 2의 소유·협의대상 정보를 이어 받아 수요 프로그램과 BTO/BOT·REITs 사업성을 30·40·50년으로 비교합니다.
        </p>
        <button type="button" className="control-back" onClick={openReport} style={{ cursor: "pointer", marginTop: 12 }}>
          3장 약식보고서 만들기
        </button>
      </div>
    </section>
  );
}
