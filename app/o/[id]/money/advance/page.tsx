import type { Metadata } from 'next';

import { EventAdvancePage } from '@/components/money/event-advance';

export const metadata: Metadata = { title: 'Event Advance' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventAdvancePage accountId={id} />;
}
