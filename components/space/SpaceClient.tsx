'use client';
import dynamic from 'next/dynamic';
const SpaceView = dynamic(() => import('./SpaceView'), { ssr: false, loading: () => <div style={{ position: 'fixed', inset: 0, background: '#020306' }} /> });
export default function SpaceClient() { return <SpaceView />; }
