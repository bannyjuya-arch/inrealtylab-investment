"use client";

import { useEffect } from "react";

const BASEMENT_RATIOS = [30, 35, 40, 45, 50] as const;
const DEFAULT_BASEMENT_RATIO = 40;

function setReactInputValue(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, String(value));
  else input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function findBasementInput() {
  const labels = Array.from(document.querySelectorAll<HTMLLabelElement>(".report-field label"));
  const label = labels.find((item) => item.textContent?.trim() === "지하/지상 비율 %" || item.textContent?.trim() === "지하 연면적 비율");
  if (!label) return null;
  const field = label.closest<HTMLElement>(".report-field");
  const input = field?.querySelector<HTMLInputElement>("input");
  return field && input ? { field, label, input } : null;
}

function updateTerminology() {
  const replacements = new Map([
    ["지상 개발가능 GFA", "지상 연면적"],
    ["지하 GFA", "지하 연면적"],
    ["총 공사 GFA", "전체 연면적"],
    ["지상 GFA", "지상 연면적"],
  ]);

  document.querySelectorAll<HTMLElement>("td, th").forEach((cell) => {
    const text = cell.textContent?.trim();
    const replacement = text ? replacements.get(text) : undefined;
    if (replacement) cell.textContent = replacement;
  });

  document.querySelectorAll<HTMLElement>(".report-note").forEach((note) => {
    if (note.textContent?.includes("건축HUB") || note.textContent?.includes("지하 GFA")) {
      note.textContent = "지하 연면적은 DB·건축HUB 조회값을 사용하지 않습니다. 30~50% 범위에서 5% 단위로 선택한 지하 개발비율을 지상 연면적에 적용해 산정합니다.";
    }
  });
}

function installStyles() {
  if (document.getElementById("inrealtylab-basement-ratio-style")) return;
  const style = document.createElement("style");
  style.id = "inrealtylab-basement-ratio-style";
  style.textContent = `
    .inrealtylab-basement-ratio-buttons {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .inrealtylab-basement-ratio-buttons button {
      border: 1px solid #d0d5dd;
      background: #fff;
      color: #344054;
      border-radius: 10px;
      padding: 10px 8px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    .inrealtylab-basement-ratio-buttons button[data-active="true"] {
      background: #111827;
      border-color: #111827;
      color: #fff;
    }
    .inrealtylab-basement-ratio-buttons + input {
      display: none !important;
    }
    @media (max-width: 720px) {
      .inrealtylab-basement-ratio-buttons {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }
  `;
  document.head.appendChild(style);
}

function applyBasementSelector() {
  installStyles();
  updateTerminology();

  const target = findBasementInput();
  if (!target) return false;

  target.label.textContent = "지하 연면적 비율";

  let buttons = target.field.querySelector<HTMLElement>(".inrealtylab-basement-ratio-buttons");
  if (!buttons) {
    buttons = document.createElement("div");
    buttons.className = "inrealtylab-basement-ratio-buttons";
    buttons.setAttribute("role", "group");
    buttons.setAttribute("aria-label", "지하 연면적 비율 선택");

    BASEMENT_RATIOS.forEach((ratio) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${ratio}%`;
      button.dataset.ratio = String(ratio);
      button.addEventListener("click", () => {
        setReactInputValue(target.input, ratio);
        buttons?.querySelectorAll<HTMLButtonElement>("button").forEach((item) => {
          item.dataset.active = item.dataset.ratio === String(ratio) ? "true" : "false";
        });
      });
      buttons?.appendChild(button);
    });

    target.input.before(buttons);
  }

  const current = Number(target.input.value);
  const validCurrent = BASEMENT_RATIOS.includes(current as (typeof BASEMENT_RATIOS)[number]);
  const selected = validCurrent ? current : DEFAULT_BASEMENT_RATIO;

  if (!validCurrent) setReactInputValue(target.input, DEFAULT_BASEMENT_RATIO);

  buttons.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.dataset.active = button.dataset.ratio === String(selected) ? "true" : "false";
  });

  return true;
}

export default function BasementRatioBridge() {
  useEffect(() => {
    let timer = window.setTimeout(() => applyBasementSelector(), 0);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => applyBasementSelector(), 20);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    applyBasementSelector();

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
