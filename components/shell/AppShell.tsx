'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import CommandPalette from './CommandPalette';
import DemoPanel from './DemoPanel';
import { LiveProvider } from '@/lib/client/live';
import { ToastProvider } from '@/lib/client/toast';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [cmdk, setCmdk] = useState(false);
  const path = usePathname();
  const fullBleed = path.startsWith('/app/traffic');
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk(o => !o); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <LiveProvider>
      <ToastProvider>
        {fullBleed ? children : (
          <div className="app">
            <Sidebar />
            <div className="main">
              <Topbar onSearch={() => setCmdk(true)} />
              {children}
            </div>
          </div>
        )}
        <CommandPalette open={cmdk} onClose={() => setCmdk(false)} />
        <DemoPanel />
      </ToastProvider>
    </LiveProvider>
  );
}
