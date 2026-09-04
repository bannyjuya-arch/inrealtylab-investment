'use client';

import '../control/control.css';
import InvestorMatchForm from '@/app/components/InvestorMatchForm';

export default function TestInvestPage() {
  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: 24 }}>
      <InvestorMatchForm onSubmit={(input) => console.log('matched input', input)} />
    </main>
  );
}
