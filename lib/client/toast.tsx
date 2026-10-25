'use client';
import { createContext, useCallback, useContext, useState } from 'react';
const T = createContext<(msg: string, err?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ msg: string; err?: boolean; id: number } | null>(null);
  const show = useCallback((msg: string, err?: boolean) => { const id = Date.now(); setT({ msg, err, id }); setTimeout(() => setT(x => (x?.id === id ? null : x)), 4200); }, []);
  return <T.Provider value={show}>{children}{t && <div role="status" className={`toast fade-in${t.err ? ' err' : ''}`}>{t.msg}</div>}</T.Provider>;
}
export const useToast = () => useContext(T);
