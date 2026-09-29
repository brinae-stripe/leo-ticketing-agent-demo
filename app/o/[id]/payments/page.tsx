import type { Metadata } from 'next';

import { OrganizerDetail } from '@/components/pages/organizer-detail';

export const metadata: Metadata = { title: 'Payments' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizerDetail accountId={id} section="payments" />;
}
