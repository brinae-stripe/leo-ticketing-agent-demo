import type { Metadata } from 'next';

import { AskPage } from '@/components/pages/ask-page';

export const metadata: Metadata = {
  title: 'Ask',
  description:
    'Ask an agent about payments across the platform. Simulated demo — no live Stripe connection.',
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  return <AskPage initialQuestion={q} />;
}
