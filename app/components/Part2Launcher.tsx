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

function numberFromText(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function afterReactPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function waitForCapacity(timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".scenario-card"));
    if (cards.length >= 3) return cards;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  return Array.from(document.querySelectorAll<HTMLElement>>(".scenario-card"));
}

function readPart1Snapshot(pnus: string[]) {
  const summaries = Array.from(document.querySelectorAll<HTMLElement>(".analysis-summary"));
  const areaSummary = summaries.find((item) => item.querySelector("span")?.textContent?.trim() === "통합 대지면적");
  const siteAreaSqm = numberFromText(areaSummary?.querySelector("strong")?.textContent);

  const capacityBasis = document.querySelector<HTMLElement>(".capacity-basis");
  const basisText = capacityBasis?.textContent ?? "";
  const farMatch = basisText.match(/FAR\s*([0-9,.]+)%/i);
  const bcrMatch = basisText.match(/BCR\s*([0-9,.]+)%/i);

  const scenarios = Array.from(document.querySelectorAll<HTMLElement>(".scenario-card")).map((card) => {
    const label = card.querySelector(".scenario-head strong")?.textContent?.trim() ?? "";
    const rows = Array.from(card.querySelectorAll("dl > div"));
    const valueOf = (key: string) => {
      const row = rows.find((item) => item.querySelector("dt")?.textContent?.trim() === key);
      return numberFromText(row?.querySelector("dd")?.textContent);
    };
    return {
      label,
      bcrPct: valueOf("건폐율"),
      farPct: valueOf("용적률"),
      footprintSqm: valueOf("건축면적"),
      grossFloorAreaSqm: valueOf("연면적"),
    };
  });

  return {
    capturedAt: new Date().toISOString(),
    pnus,
    siteAreaSqm,
    primaryZone: capacityBasis?.querySelector("strong")?.textContent?.trim() ?? null,
    statutoryFarMaxPct: farMatch ? Number(farMatch[1].replace(/,/g, "")) : null,
    statutoryBcrMaxPct: bcrMatch ? Number(bcrMatch[1].replace(/,/g, "")) : null,
    scenarios,
  };
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

    const capacityButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".analysis-tabs button"))
      .find((button) => button.textContent?.trim() === "CAPACITY");

    if (capacityButton && !capacityButton.disabled) {
      capacityButton.click();
      await waitForCapacity();
    }

    const snapshot = readPart1Snapshot(uniquePnus);
    const serializedSnapshot = JSON.stringify(snapshot);

    try {
      sessionStorage.setItem("inrealtylab.part1Snapshot", serializedSnapshot);
    } catch {
      // The analysis still continues if browser storage is unavailable.
    }

    const params = new URLSearchParams({
      pnus: uniquePnus.join(","),
      part1: serializedSnapshot,
    });
    window.location.href = `/control?${params.toString()}`;
  }

  return (
    <section style={{ maxWidth: 1440, margin: "0 auto 32px", padding: "0 20px" }}>
      <div className="next-step-card">
        <span>PART 2</span>
        <strong>소유 · 사업추진 가능성 분석</strong>
        <p>현재 선택된 필지의 PNU와 Part 1 개발가능규모를 함께 넘겨 공공소유 여부와 후속 사업검토에 연결합니다.</p>
        <button type="button" onClick={openControl}>소유 · 사업추진 분석</button>
        {message && <div className="analysis-alert error" style={{ marginTop: 12 }}>{message}</div>}
      </div>
    </section>
  );
}
