import { Suspense } from 'react';
import Comms from '@/components/comms/Comms';
export const metadata = { title: 'Comms' };
export default async function Page({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  return <Suspense><Comms threadId={threadId} /></Suspense>;
}
