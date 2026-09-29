import type { Metadata } from 'next';

import { PlatformSettlementsPage } from '@/components/money/platform-money';

export const metadata: Metadata = { title: 'Settlements' };

export default function Page() {
  return <PlatformSettlementsPage />;
}
