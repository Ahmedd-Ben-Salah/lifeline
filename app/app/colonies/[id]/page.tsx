import { Suspense } from 'react';
import ColonyDetail from './ColonyDetail';
export const metadata = { title: 'Colony' };
export default function Page() { return <Suspense><ColonyDetail /></Suspense>; }
