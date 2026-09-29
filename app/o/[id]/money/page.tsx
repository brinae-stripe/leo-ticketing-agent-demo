import type { Metadata } from 'next';

import { MoneyOverview } from '@/components/money/money-overview';

export const metadata: Metadata = { title: 'Money' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MoneyOverview accountId={id} />;
}
