import type { Metadata } from 'next';

import { PlatformCardsPage } from '@/components/money/platform-money';

export const metadata: Metadata = { title: 'Card program' };

export default function Page() {
  return <PlatformCardsPage />;
}
