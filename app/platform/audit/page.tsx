import type { Metadata } from 'next';

import { AuditPage } from '@/components/pages/audit-page';

export const metadata: Metadata = {
  title: 'Audit log',
  description: 'Every simulated Stripe call this demo session made.',
};

export default function Page() {
  return <AuditPage />;
}
