'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ProtocolTag } from '@/components/ui';
import { jdFromDate, lightDelaySec, marsSubsolar } from '@/lib/engine/ephemeris';
import s from './landing.module.css';

const MarsGlobe = dynamic(() => import('@/components/globe/MarsGlobe'), { ssr: false });
const JD = jdFromDate(Date.UTC(2050, 10, 12, 6, 0, 0));
const PINS = [
  { id: 'jezero', lat: 18.44, lon: 77.45, color: '#16A34A', label: 'Jezero Base' },
  { id: 'arcadia', lat: 47, lon: -176, color: '#DC2626', label: 'Arcadia Station', pulse: true },
  { id: 'utopia', lat: 46.7, lon: 117.5, color: '#16A34A', label: 'Utopia Outpost' },
  { id: 'valles', lat: -13.9, lon: -59.2, color: '#D97706', label: 'Valles Hub' },
];
const STEPS = ['WARN', 'NEED', 'TIMEOUT', 'OFFER', 'ACCEPT', 'FAULT', 'ORDER'];
const STEP_TEXT: Record<string, string> = { WARN: 'Weather AI: a storm is coming', NEED: 'Jezero AI: Arcadia will run short', TIMEOUT: 'Arcadia does not answer, so Jezero acts', OFFER: 'Utopia AI: we can share water and air', ACCEPT: 'Deal done, humans are told', FAULT: 'A rover breaks, another takes its load', ORDER: 'Earth supply AI: rockets need a human OK' };

export default function Landing() {
  // pick the hour of the scenario day when the Sun stands over ~160°E, so the colonies face the camera in daylight
  const sub = useMemo(() => { let best = marsSubsolar(JD); for (let h = 0; h < 25; h += 0.25) { const p = marsSubsolar(JD + h / 24); if (Math.abs(((p.lon - 165 + 540) % 360) - 180) < Math.abs(((best.lon - 165 + 540) % 360) - 180)) best = p; } return best; }, []);
  const ld = lightDelaySec(JD);
  return (
    <div className={s.root}>
      <header className={s.nav}>
        <Link href="/" className={s.brand}><svg width="34" height="21" viewBox="0 0 64 40" aria-hidden="true"><circle cx="11" cy="24" r="6" fill="#fff" /><circle cx="52" cy="24" r="8" fill="#fff" /><path d="M17 24 H25 L30 12 L35 34 L39 24 H44" fill="none" stroke="#2F6FEB" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>lifeline</Link>
        <nav className={`${s.navR}`} aria-label="Site">
          <span className={s.navLinks}><a href="#problem">Problem</a><a href="#how">How it works</a><a href="#real">What&apos;s real</a></span>
          <Link href="/login" className={s.signin}>Sign in</Link>
        </nav>
      </header>

      <section className={s.hero} aria-label="Lifeline">
        <div className={s.heroText}>
          <span className={s.eyebrowDark}>Mars · 2050</span>
          <h1 className={s.h1}>The supply chain between worlds.</h1>
          <p className={s.lead}>Lifeline keeps people on Mars alive. It spots danger early and moves air, water and food to where they are needed, before anyone runs out.</p>
          <div className={s.ctas}>
            <Link href="/login" className={`${s.cta} ${s.ctaMain}`}>Try the demo →</Link>
            <a href="#how" className={`${s.cta} ${s.ctaGhost}`}>How it works</a>
          </div>
          <div className={s.heroStats}>
            <div><b>4</b><span>colonies · 170 people</span></div>
            <div><b>300</b><span>simulations per storm forecast</span></div>
            <div><b>{Math.round(ld / 60)} min</b><span>for a message to reach Earth</span></div>
          </div>
        </div>
        <div className={s.stars} aria-hidden="true" /><div className={s.globe}><MarsGlobe hiRes pins={PINS} subsolar={sub} focus={{ lat: 26, lon: 120 }} zoom={1.0} /></div>
        <div className={`ring lift ${s.floating}`}>
          <div className="in">
            <div className="head"><b>Dust storm</b><span className="chip chip-crit" style={{ marginLeft: 'auto' }}><span className="d" />Coming</span></div>
            <div className="body">
              <div className="kv"><span className="k">Heading to</span><span className="ln" /><span className="v">Arcadia</span></div>
              <div className="kv"><span className="k">Chance</span><span className="ln" /><span className="v">78%</span></div>
              <div className="kv"><span className="k">Arrives in</span><span className="ln" /><span className="v">8–14 days</span></div>
            </div>
            <div className="sect"><span className="k">A rover is already on its way with water and air.</span></div>
          </div>
        </div>
        <div className={s.globeNote}>Real NASA images of Mars · real day and night</div>
      </section>

      <section id="problem" className={s.sec}>
        <div className={s.secHead}>
          <span className="eyebrow">The problem</span>
          <h2>Help from Earth takes years, not days.</h2>
          <p>A Mars colony has to order what it needs up to two years ahead. Today each colony only watches itself, Earth is too far to react in time, and nobody re-plans when a rover breaks.</p>
        </div>
        <div className={s.grid4}>
          <div className={s.stat}><b>26<small> months</small></b><p>Rockets can only leave Earth for Mars once every 26 months.</p></div>
          <div className={s.stat}><b>6–9<small> months</small></b><p>The trip from Earth to Mars takes this long.</p></div>
          <div className={s.stat}><b>3–22<small> min</small></b><p>for a message to travel between Mars and Earth.</p></div>
          <div className={s.stat}><b>2<small> weeks</small></b><p>with no radio at all when the Sun is between the planets.</p></div>
        </div>
        <div className={s.quote}><b>645 → 22 Wh</b><p>In 2018 a dust storm covered all of Mars. The Opportunity rover lost almost all its solar power in a week and never woke up. Now imagine four towns of people there.</p></div>
      </section>

      <section className={s.sec} style={{ paddingTop: 0 }}>
        <div className={s.secHead}><span className="eyebrow">What Lifeline does</span><h2>Forecast. Coordinate. Deliver.</h2></div>
        <div className={s.grid3}>
          <div className={`card ${s.job}`} style={{ padding: 20 }}>
            <div className={s.jobVisual}>
              <svg width="260" height="120" viewBox="0 0 260 120" aria-hidden="true"><path d="M30 100 L150 20 L210 50 Z" fill="#F0A35C" opacity=".25" /><path d="M30 100 L165 30 L195 45 Z" fill="#F0A35C" opacity=".4" stroke="#B45309" strokeDasharray="4 3" /><circle cx="30" cy="100" r="7" fill="#FCE3C4" stroke="#B45309" /><circle cx="182" cy="38" r="7" fill="#fff" stroke="#DC2626" strokeWidth="3" /><text x="196" y="30" fontSize="11" fill="#B91C1C" fontFamily="var(--font)">Arcadia</text></svg>
            </div>
            <h3>Forecast</h3>
            <p>A weather app for Mars dust storms. It shows where a storm will go and when, like a hurricane forecast, so colonies can prepare.</p>
          </div>
          <div className={`card ${s.job}`} style={{ padding: 20 }}>
            <div className={s.jobVisual}><div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>{['WARN', 'NEED', 'TIMEOUT', 'OFFER'].map(k => <span key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}><ProtocolTag kind={k} /><span className="muted">{STEP_TEXT[k].split(':')[0]}</span></span>)}</div></div>
            <h3>Coordinate</h3>
            <p>Each colony has an AI helper. They warn each other, ask for help, share spare supplies, and act on their own if a colony stops answering.</p>
          </div>
          <div className={`card ${s.job}`} style={{ padding: 20 }}>
            <div className={s.jobVisual}>
              <svg width="240" height="120" viewBox="0 0 240 120" aria-hidden="true"><circle cx="120" cy="60" r="10" fill="#F4E3BD" /><circle cx="120" cy="60" r="34" fill="none" stroke="#D7DBE1" /><circle cx="120" cy="60" r="52" fill="none" stroke="#D7DBE1" /><path d="M88 72 C 80 20, 150 4, 170 40" fill="none" stroke="#2F6FEB" strokeWidth="2" strokeDasharray="5 4" /><circle cx="88" cy="72" r="5" fill="#3A6EA5" /><circle cx="171" cy="42" r="5" fill="#B5583B" /></svg>
            </div>
            <h3>Deliver</h3>
            <p>Rovers carry supplies between colonies and find a new road if one breaks down. For bigger needs, Lifeline plans the next rockets from Earth.</p>
          </div>
        </div>
      </section>

      <section id="how" className={s.sec} style={{ paddingTop: 0 }}>
        <div className={s.secHead}>
          <span className="eyebrow">How it works</span>
          <h2>The math decides. The AI explains. People approve.</h2>
          <p>A calculator built on real space science works out every number. The AI helpers only read those numbers and talk; they cannot make numbers up. Big decisions, like ordering rockets from Earth, need two people to say OK.</p>
        </div>
        <div className={s.flow} role="list" aria-label="Agent protocol">
          {STEPS.map((k, i) => (
            <span key={k} role="listitem" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}><ProtocolTag kind={k} /><span className="faint" style={{ fontSize: 11.5, maxWidth: 130 }}>{STEP_TEXT[k]}</span></span>
              {i < STEPS.length - 1 && <span className={s.arrow}>→</span>}
            </span>
          ))}
        </div>
        <div className={s.layers}>
          <div className={s.layer}><span className={s.k}>01 · MATH</span><b>Real space science</b><p>Where the planets are, when rockets can launch, where storms go, how many days of air are left. Same question, same answer, every time.</p></div>
          <div className={s.layer}><span className={s.k}>02 · AI</span><b>Helpers that talk</b><p>The AI helpers (Claude) explain what is happening and ask the math for every number. If they ever get it wrong, a safe ready-made message is used instead.</p></div>
          <div className={s.layer}><span className={s.k}>03 · PEOPLE</span><b>Humans say OK</b><p>You choose what the AI may do alone. Earth orders need two people, and an OK sent from Mars takes minutes to reach Earth.</p></div>
        </div>
      </section>

      <section id="real" className={s.sec} style={{ paddingTop: 0 }}>
        <div className={s.secHead}><span className="eyebrow">Honest</span><h2>What&apos;s real, and what&apos;s made up.</h2></div>
        <div className={s.real}>
          <section className="card"><div className="card-h"><h3>Real</h3><span className="chip chip-ok" style={{ marginLeft: 'auto' }}><span className="d" />real data</span></div>
            <ul className={s.list}>
              <li><span className="dot dot-ok" style={{ marginTop: 6 }} /><div>Where Earth and Mars are<small>NASA data</small></div></li>
              <li><span className="dot dot-ok" style={{ marginTop: 6 }} /><div>When rockets can launch and how long they fly<small>real orbit math</small></div></li>
              <li><span className="dot dot-ok" style={{ marginTop: 6 }} /><div>How long messages take, Mars seasons and days</div></li>
              <li><span className="dot dot-ok" style={{ marginTop: 6 }} /><div>The Mars map, hills and valleys, day and night<small>NASA images</small></div></li>
              <li><span className="dot dot-ok" style={{ marginTop: 6 }} /><div>How much air, water and food a person needs<small>NASA numbers</small></div></li>
            </ul>
          </section>
          <section className="card"><div className="card-h"><h3>Simulated</h3><span className="chip chip-neutral" style={{ marginLeft: 'auto' }}>a 2050 story</span></div>
            <ul className={s.list}>
              <li><span className="dot dot-off" style={{ marginTop: 6 }} /><div>The four colonies and their supplies</div></li>
              <li><span className="dot dot-off" style={{ marginTop: 6 }} /><div>The rovers and rocket sizes</div></li>
              <li><span className="dot dot-off" style={{ marginTop: 6 }} /><div>The dust storm in the story</div></li>
              <li><span className="dot dot-off" style={{ marginTop: 6 }} /><div>Planet sizes in 3D<small>made bigger so you can see them</small></div></li>
            </ul>
          </section>
        </div>
        <div className={s.chips} style={{ marginTop: 20 }}>
          {['Next.js', 'three.js', 'Claude AI', 'Vercel'].map(t => <span key={t} className="chip chip-neutral">{t}</span>)}
        </div>
      </section>

      <section className={s.band}>
        <div className={s.sec}>
          <h2>On Earth, a late delivery is annoying. On Mars, it is fatal.</h2>
          <Link href="/login" className={`${s.cta} ${s.ctaMain}`} style={{ marginLeft: 'auto' }}>Try the demo →</Link>
        </div>
      </section>
      <footer className={s.foot}><span>© 2050 Lifeline</span><span>IEEE Lumen 2.0 · Beyond 2030</span><span style={{ marginLeft: 'auto' }}>Images: NASA</span></footer>
    </div>
  );
}
