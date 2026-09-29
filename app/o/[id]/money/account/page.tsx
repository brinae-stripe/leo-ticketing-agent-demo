import type { Metadata } from 'next';

import { EventAccountPage } from '@/components/money/event-account';

export const metadata: Metadata = { title: 'Event Account' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventAccountPage accountId={id} />;
}
