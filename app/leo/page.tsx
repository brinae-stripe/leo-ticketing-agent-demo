import type { Metadata } from 'next';

import { LeoPage } from '@/components/pages/leo-page';
import { AGENT, LENS } from '@/lib/brand';

export const metadata: Metadata = {
  title: AGENT,
  description: `Ask ${AGENT} about payments across every event organizer on the platform. ${LENS.platform.label} — simulated demo, no live Stripe connection.`,
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <LeoPage initialQuestion={q} />;
}
