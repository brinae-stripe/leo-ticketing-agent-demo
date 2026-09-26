import type { Metadata } from 'next';

import { HostDetail } from '@/components/pages/host-detail';

export const metadata: Metadata = { title: 'Host' };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <HostDetail accountId={id} />;
}
