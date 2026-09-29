import type { Metadata } from 'next';

import { EventsList } from '@/components/pages/events-list';

export const metadata: Metadata = { title: 'Events' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventsList accountId={id} />;
}
