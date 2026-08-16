"use client";

import { useState } from "react";

function isValidPnu(value: string) {
  return /^\d{10}[12]\d{8}$/.test(value);
}

function readPnusFromSite() {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".parcel-card"));
  const pnus = cards
    .map((card) => {
      const rows = Array.from(card.querySelectorAll("dl > div"));
      const pnuRow = rows.find((row) => row.querySelector("dt")?.textContent?.trim() === "PNU");
      return pnuRow?.querySelector("dd")?.textContent?.trim() ?? "";
    })
    .filter(isValidPnu);

  return [...new Set(pnus)];
}

function afterReactPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export default function Part2Launcher() {
  const [message, setMessage] = useState("");

  async function openControl() {
    setMessage("");

    let uniquePnus = readPnusFromSite();

    if (!uniquePnus.length) {
      const siteButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".analysis-tabs button"))
        .find((button) => button.textContent?.trim() === "SITE");

      if (siteButton && !siteButton.disabled) {
        siteButton.click();
        await afterReactPaint();
        uniquePnus = readPnusFromSite();
      }
    }

    if (!uniquePnus.length) {
      setMessage("선택된 필지의 PNU를 읽지 못했습니다. 지도에서 필지를 다시 선택해 주세요.");
      return;
    }

    const params = new URLSearchParams({ pnus: uniquePnus.join(",") });
    window.location.href = `/control?${params.toString()}`;
  }

  return (
    <section style={{ maxWidth: 1440, margin: "0 auto 32px", padding: "0 20px" }}>
      <div className="next-step-card">
        <span>PART 2</span>
        <strong>소유 · 사업추진 가능성 분석</strong>
        <p>현재 선택된 필지의 PNU를 그대로 넘겨 공공소유 여부를 자동 확인합니다. SITE·REGULATION·CAPACITY 어느 탭에서도 실행할 수 있습니다.</p>
        <button type="button" onClick={openControl}>소유 · 사업추진 분석</button>
        {message && <div className="analysis-alert error" style={{ marginTop: 12 }}>{message}</div>}
      </div>
    </section>
  );
}
