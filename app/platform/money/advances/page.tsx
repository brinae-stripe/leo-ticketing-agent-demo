import type { Metadata } from 'next';

import { PlatformAdvancesPage } from '@/components/money/platform-money';

export const metadata: Metadata = { title: 'Advances' };

export default function Page() {
  return <PlatformAdvancesPage />;
}
