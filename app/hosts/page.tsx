import type { Metadata } from 'next';

import { HostsList } from '@/components/pages/hosts-list';

export const metadata: Metadata = { title: 'Hosts' };

export default function Page() {
  return <HostsList />;
}
