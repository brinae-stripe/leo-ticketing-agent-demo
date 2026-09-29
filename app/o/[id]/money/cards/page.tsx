import type { Metadata } from 'next';

import { ProductionCardsPage } from '@/components/money/production-cards';

export const metadata: Metadata = { title: 'Production Cards' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductionCardsPage accountId={id} />;
}
