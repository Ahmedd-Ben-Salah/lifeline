import { Suspense } from 'react';
import Comms from '@/components/comms/Comms';
export const metadata = { title: 'Comms' };
export default function Page() { return <Suspense><Comms /></Suspense>; }
