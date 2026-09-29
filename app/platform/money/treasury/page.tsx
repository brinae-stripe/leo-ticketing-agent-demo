import type { Metadata } from 'next';

import { PlatformTreasuryPage } from '@/components/money/platform-money';

export const metadata: Metadata = { title: 'Stored balances' };

export default function Page() {
  return <PlatformTreasuryPage />;
}
