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

// 2026-09-05: updateTerminology() 를 삭제했다.
// (1) 바꾸려던 문자열("지상 개발가능 GFA", "총 공사 GFA", "지상 GFA")은 page.tsx 에서 이미
//     한글로 바뀌어 더 이상 존재하지 않는다.
// (2) 남은 한 가지 동작이 위험했다 — "건축HUB"가 들어간 .report-note 를 통째로 고정문구로
//     덮어써서, 건축HUB에서 실제로 읽어온 기존 건축물 지하비율(예: 38.2%)이 화면에서 사라졌다.
// 용어 교정은 이제 page.tsx 소스에서 직접 한다. 이 브리지는 지하비율 선택 버튼만 담당한다.

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
