import type { Metadata } from 'next';

import { OrganizersList } from '@/components/pages/organizers-list';

export const metadata: Metadata = { title: 'Organizers' };

export default function Page() {
  return <OrganizersList />;
}
