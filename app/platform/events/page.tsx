import type { Metadata } from 'next';

import { EventsList } from '@/components/pages/events-list';

export const metadata: Metadata = { title: 'Events' };

export default function Page() {
  return <EventsList />;
}
