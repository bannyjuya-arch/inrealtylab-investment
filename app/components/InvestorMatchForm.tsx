'use client';

import { useState } from 'react';
import styles from './InvestorMatchForm.module.css';

const SEOUL_GU = [
  { code: '11110', name: '종로구' }, { code: '11140', name: '중구' },
  { code: '11170', name: '용산구' }, { code: '11200', name: '성동구' },
  { code: '11215', name: '광진구' }, { code: '11230', name: '동대문구' },
  { code: '11260', name: '중랑구' }, { code: '11290', name: '성북구' },
  { code: '11305', name: '강북구' }, { code: '11320', name: '도봉구' },
  { code: '11350', name: '노원구' }, { code: '11380', name: '은평구' },
  { code: '11410', name: '서대문구' }, { code: '11440', name: '마포구' },
  { code: '11470', name: '양천구' }, { code: '11500', name: '강서구' },
  { code: '11530', name: '구로구' }, { code: '11545', name: '금천구' },
  { code: '11560', name: '영등포구' }, { code: '11590', name: '동작구' },
  { code: '11620', name: '관악구' }, { code: '11650', name: '서초구' },
  { code: '11680', name: '강남구' }, { code: '11710', name: '송파구' },
  { code: '11740', name: '강동구' },
] as const;

const FACILITY_OPTIONS = [
  { code: 'C01_OFFICE', label: '업무시설' },
  { code: 'C02_RETAIL', label: '판매시설' },
  { code: 'C03_HOSPITALITY', label: '숙박시설' },
  { code: 'C04_LIVING', label: '주거·생활시설' },
  { code: 'C05_HEALTHCARE', label: '의료시설' },
  { code: 'C06_EDUCATION', label: '교육시설' },
  { code: 'C07_CULTURE_ENTERTAINMENT', label: '문화·엔터테인먼트' },
  { code: 'C08_RND_LAB', label: '연구·R&D' },
  { code: 'C09_LOGISTICS', label: '물류시설' },
  { code: 'C10_DIGITAL_INFRA', label: '데이터센터·디지털인프라' },
] as const;

const OPERATION_MODES = [
  { code: 'LEASE', label: '임대수익형' },
  { code: 'OPERATE', label: '직접운영형' },
  { code: 'MIXED', label: '혼합형' },
] as const;

const STRUCTURE_OPTIONS = [
  { code: 'ANY', label: '아직 미정 (전체 조회)' },
  { code: 'BTO', label: 'BTO' },
  { code: 'BOT', label: 'BOT' },
  { code: 'REIT', label: 'REITs' },
  { code: 'PROJECT_REIT', label: '프로젝트 리츠' },
  { code: 'TRUST_DEVELOPMENT', label: '신탁·위탁개발' },
] as const;

const TENOR_OPTIONS = [30, 40, 50] as const;

export interface InvestorMatchInput {
  regionGu: string[];
  facilityCode: string;
  operationMode: string;
  structureCode: string;
  capexMaxEok: number;
  requiredIrrPct: number;
  debtTenorYears: 30 | 40 | 50;
}

interface Props {
  onSubmit?: (input: InvestorMatchInput) => void;
}

export default function InvestorMatchForm({ onSubmit }: Props) {
  const [regionGu, setRegionGu] = useState<string[]>([]);
  const [facilityCode, setFacilityCode] = useState<string | null>(null);
  const [operationMode, setOperationMode] = useState<string | null>(null);
  const [structureCode, setStructureCode] = useState<string>('ANY');
  const [capexMaxEok, setCapexMaxEok] = useState<string>('');
  const [requiredIrrPct, setRequiredIrrPct] = useState<number>(8);
  const [debtTenorYears, setDebtTenorYears] = useState<30 | 40 | 50>(40);
  const [error, setError] = useState<string | null>(null);

  const toggleGu = (code: string) => {
    setRegionGu((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const handleSubmit = () => {
    if (regionGu.length === 0) { setError('지역을 1개 이상 선택해주세요.'); return; }
    if (!facilityCode) { setError('시설유형을 선택해주세요.'); return; }
    const capex = Number(capexMaxEok);
    if (!capex || capex <= 0) { setError('투자비 상한을 입력해주세요.'); return; }
    setError(null);

    const input: InvestorMatchInput = {
      regionGu, facilityCode, operationMode: operationMode ?? 'LEASE',
      structureCode, capexMaxEok: capex, requiredIrrPct, debtTenorYears,
    };
    sessionStorage.setItem('inrealtylab.investMatchInput', JSON.stringify(input));
    onSubmit?.(input);
  };

  return (
    <div>
      <section className={styles.section}>
        <h3>① 지역</h3>
        <div className={styles.chipGrid}>
          {SEOUL_GU.map((gu) => (
            <button key={gu.code} type="button"
              className={`${styles.chip} ${regionGu.includes(gu.code) ? styles.chipSelected : ''}`}
              onClick={() => toggleGu(gu.code)}>{gu.name}</button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3>② 시설유형</h3>
        <div className={styles.grid}>
          {FACILITY_OPTIONS.map((f) => (
            <button key={f.code} type="button"
              className={`${styles.card} ${facilityCode === f.code ? styles.cardSelected : ''}`}
              onClick={() => setFacilityCode(f.code)}>{f.label}</button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3>③ 이용목적</h3>
        <div className={`${styles.grid} ${styles.grid3}`}>
          {OPERATION_MODES.map((m) => (
            <button key={m.code} type="button"
              className={`${styles.card} ${operationMode === m.code ? styles.cardSelected : ''}`}
              onClick={() => setOperationMode(m.code)}>{m.label}</button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3>④ 사업방식</h3>
        <div className={`${styles.grid} ${styles.grid3}`}>
          {STRUCTURE_OPTIONS.map((s) => (
            <button key={s.code} type="button"
              className={`${styles.card} ${structureCode === s.code ? styles.cardSelected : ''}`}
              onClick={() => setStructureCode(s.code)}>{s.label}</button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3>⑤ 투자비 상한 (억원)</h3>
        <input type="number" min={0} value={capexMaxEok}
          onChange={(e) => setCapexMaxEok(e.target.value)}
          placeholder="예: 500" className={styles.numericInput} />
      </section>

      <section className={styles.section}>
        <h3>⑥ 요구수익률 (%)</h3>
        <div className={styles.sliderRow}>
          <input type="range" min={4} max={15} step={0.5} value={requiredIrrPct}
            onChange={(e) => setRequiredIrrPct(Number(e.target.value))} />
          <span className={styles.sliderValue}>{requiredIrrPct.toFixed(1)}%</span>
        </div>
      </section>

      <section className={styles.section}>
        <h3>⑦ 사업기간</h3>
        <div className={`${styles.grid} ${styles.grid3}`}>
          {TENOR_OPTIONS.map((y) => (
            <button key={y} type="button"
              className={`${styles.card} ${debtTenorYears === y ? styles.cardSelected : ''}`}
              onClick={() => setDebtTenorYears(y)}>{y}년</button>
          ))}
        </div>
      </section>

      {error && <p className={styles.error}>{error}</p>}

      <button type="button" className={styles.submitBtn} onClick={handleSubmit}>
        매칭 부지 조회
      </button>
    </div>
  );
}
