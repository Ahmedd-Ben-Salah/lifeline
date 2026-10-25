import Link from 'next/link';
export const metadata = { title: 'Not found' };
export default function NotFound() {
  return (
    <main className="dots-bg" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="ring lift" style={{ width: 'min(420px,100%)' }}>
        <div className="in">
          <div className="head"><b>Signal lost</b><span className="chip chip-crit" style={{ marginLeft: 'auto' }}><span className="d" />404</span></div>
          <div className="body">
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>This page never reached Mars. It may have moved, or the link is wrong.</p>
            <div className="kv"><span className="k">Last known position</span><span className="ln" /><span className="v">unknown</span></div>
          </div>
          <div className="sect" style={{ flexDirection: 'row', gap: 8 }}>
            <Link className="btn btn-sm btn-dark" href="/app">Mission control</Link>
            <Link className="btn btn-sm" href="/">Home</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
