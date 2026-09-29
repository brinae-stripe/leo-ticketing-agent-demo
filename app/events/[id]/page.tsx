import type { Metadata } from 'next';

import { EventDetailPage } from '@/components/pages/event-detail';

export const metadata: Metadata = { title: 'Event overview' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventDetailPage eventId={id} />;
}
