import { useEffect, useMemo, useRef, useState } from 'react';
import { standingsAt, type RaceData } from '../lib/race';
import { fmtClock, fmtDay, fmtInt, fmtKr, fmtRange, hueFor } from '../lib/format';

interface Props {
  data: RaceData;
  showRevenue: boolean;
  company: string;
  logo: string | null;
  onReplay: () => void;
  onExit: () => void;
  onToggleRevenue?: () => void;
  /** Called once the finale has reached its overview. */
  onDone?: () => void;
}

/**
 * The finale is a short sequence, so a room watching a projector gets one moment at a time:
 * the total counts up, then the key facts, then the podium (3rd, 2nd, pause, 1st with confetti),
 * and finally an overview with the buttons. Click or space skips to the next step.
 */
type Phase = 'total' | 'facts' | 'podium' | 'done';
const COUNT_FROM = 0.6;
const COUNT_SEC = 4;
const FACT_GAP = 1.2;
const T_FACTS = COUNT_FROM + COUNT_SEC + 1.7;
const PODIUM_STEPS = [0.3, 1.3, 4.3]; // 3rd, 2nd, (1.5 s pause), 1st — relative to the podium phase
const T_DONE_AFTER = 5.8;
const DAY = 24 * 3_600_000;

const productColor = (name: string) => `hsl(${hueFor(name)}, 45%, 55%)`;

/** Counts up to the exact target; the last frame always shows the real number. */
function useCountUp(target: number, delaySec: number, durSec: number, skip: boolean): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (skip || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setV(target);
    let raf = 0;
    const t0 = performance.now() + delaySec * 1000;
    const tick = (now: number) => {
      const k = Math.max(0, Math.min(1, (now - t0) / (durSec * 1000)));
      const e = 1 - (1 - k) ** 4;
      setV(k >= 1 ? target : Math.floor(target * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    setV(0);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, delaySec, durSec, skip]);
  return v;
}

/** The busiest calendar day by orders, computed from the exact hourly buckets. */
function bestDay(data: RaceData) {
  const byDay = new Map<number, number>();
  for (const h of data.hourly) {
    const d = new Date(h.start);
    d.setHours(0, 0, 0, 0);
    byDay.set(d.getTime(), (byDay.get(d.getTime()) ?? 0) + h.orders);
  }
  let best: { day: number; orders: number } | null = null;
  for (const [day, orders] of byDay) if (!best || orders > best.orders) best = { day, orders };
  return byDay.size > 1 ? best : null;
}

export function Summary({ data, showRevenue, company, logo, onReplay, onExit, onToggleRevenue, onDone }: Props) {
  const final = useMemo(() => standingsAt(data, data.end).filter((s) => s.units > 0), [data]);
  const leadChanges = data.events.filter((e) => e.kind === 'lead').length;
  const { totals, busiest } = data;
  const withRevenue = showRevenue && totals.revenue !== null;
  const top = useMemo(() => bestDay(data), [data]);
  const multiDay = data.end - data.start > DAY;

  const facts = [
    busiest && {
      label: 'Travleste time',
      value: `${multiDay ? `${fmtDay(busiest.start)} ` : ''}kl. ${fmtClock(busiest.start)}–${fmtClock(busiest.start + 3_600_000)}`,
      sub: `${fmtInt(busiest.orders)} ordrer på én time`,
    },
    top && multiDay && { label: 'Bedste dag', value: fmtDay(top.day), sub: `${fmtInt(top.orders)} ordrer` },
    { label: 'Skift på førstepladsen', value: fmtInt(leadChanges), sub: leadChanges === 1 ? 'gang i løbet af perioden' : 'gange i løbet af perioden' },
  ].filter(Boolean) as { label: string; value: string; sub: string }[];

  // Phase timeline; each step can be skipped
  const [phase, setPhase] = useState<Phase>('total');
  const [skipCount, setSkipCount] = useState(false);
  const [podiumStep, setPodiumStep] = useState(0);
  const tFacts = T_FACTS;
  useEffect(() => {
    const at = (sec: number, f: () => void) => window.setTimeout(f, sec * 1000);
    const ids =
      phase === 'total' ? [at(tFacts, () => setPhase('facts'))]
      : phase === 'facts' ? [at(facts.length * FACT_GAP + 1.2, () => setPhase('podium'))]
      : phase === 'podium' ? [...PODIUM_STEPS.map((s, i) => at(s, () => setPodiumStep(i + 1))), at(T_DONE_AFTER, () => setPhase('done'))]
      : [];
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [phase, tFacts, facts.length]);

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (phase === 'done') onDoneRef.current?.();
  }, [phase]);

  const next = () => {
    if (phase === 'total') {
      setSkipCount(true);
      setPhase('facts');
    } else if (phase === 'facts') setPhase('podium');
    else if (phase === 'podium') {
      setPodiumStep(3);
      setPhase('done');
    }
  };
  const nextRef = useRef(next);
  nextRef.current = next;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    // Capture phase on window runs before the player's own key handler
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current === 'done' || (e.code !== 'Space' && e.key !== 'Enter' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      nextRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const headline = withRevenue ? Math.round(totals.revenue!) : totals.units;
  const big = useCountUp(headline, COUNT_FROM, COUNT_SEC, skipCount);
  // Secondary numbers land before the headline so the big number is the last to settle
  const orders = useCountUp(totals.orders, COUNT_FROM, COUNT_SEC * 0.7, skipCount);
  const units = useCountUp(totals.units, COUNT_FROM, COUNT_SEC * 0.7, skipCount);
  const headlineText = withRevenue ? fmtKr(big) : `${fmtInt(big)} varer`;

  const podium = [
    { place: 2, cls: 'silver', h: 120, step: 2 },
    { place: 1, cls: 'gold', h: 170, step: 3 },
    { place: 3, cls: 'bronze', h: 84, step: 1 },
  ];
  const winnerColors = useMemo(() => final.slice(0, 3).map((s) => productColor(data.products[s.productId].name)), [final, data]);
  const confettiFire = podiumStep >= 3 ? 1 : 0;

  return (
    <div className={`finale phase-${phase}`} onClick={phase !== 'done' ? next : undefined}>
      <Confetti fire={confettiFire} colors={winnerColors} />
      <header className="finale-head">
        {logo && <img className="finale-logo" src={logo} alt="" />}
        <p className="kicker">
          {company && <b>{company} · </b>}
          {fmtRange(data.start, data.end)}
        </p>
      </header>

      {phase === 'total' && (
        <section className="finale-stage total" key="total">
          <span className="finale-label">{withRevenue ? 'I nåede at omsætte for' : 'I nåede at sælge'}</span>
          <span className={`finale-big ${big === headline ? 'done' : ''}`}>{headlineText}</span>
          <div className="finale-sub">
            <span><b>{fmtInt(orders)}</b> ordrer</span>
            {withRevenue && <span><b>{fmtInt(units)}</b> solgte varer</span>}
          </div>
          {withRevenue && totals.linesWithoutAmount > 0 && (
            <p className="muted small">* {fmtInt(totals.linesWithoutAmount)} ordrelinjer uden gyldigt beløb indgår ikke</p>
          )}
        </section>
      )}

      {phase === 'facts' && (
        <section className="finale-stage facts" key="facts">
          {facts.map((f, i) => (
            <div key={f.label} className="fact" style={{ animationDelay: `${0.2 + i * FACT_GAP}s` }}>
              <span className="fact-label">{f.label}</span>
              <span className="fact-value">{f.value}</span>
              <span className="fact-sub">{f.sub}</span>
            </div>
          ))}
        </section>
      )}

      {(phase === 'podium' || phase === 'done') && (
        <section className={`finale-stage podium-stage ${phase === 'done' ? 'compact' : ''}`} key="podium">
          {phase === 'done' && (
            <p className="finale-recap">
              <b>{withRevenue ? fmtKr(totals.revenue!) : `${fmtInt(totals.units)} varer`}</b>
              <span>{fmtInt(totals.orders)} ordrer</span>
              {withRevenue && <span>{fmtInt(totals.units)} solgte varer</span>}
            </p>
          )}
          <div className="podium">
            {podium.map(({ place, cls, h, step }) => {
              const s = final[place - 1];
              if (!s) return <div key={place} className="step empty" />;
              const p = data.products[s.productId];
              return (
                <div key={place} className={`step ${cls} ${podiumStep >= step ? 'shown' : ''}`}>
                  <span className="step-swatch" style={{ background: productColor(p.name) }}>
                    {p.imageUrl && <img src={p.imageUrl} alt="" referrerPolicy="no-referrer" onError={(e) => e.currentTarget.remove()} />}
                  </span>
                  <span className="step-name">{p.name}</span>
                  <span className="step-units">
                    {fmtInt(s.units)} stk.{withRevenue && <span className="step-rev"> · {fmtKr(p.revenue)}</span>}
                  </span>
                  <div className="block" style={{ height: h }}>
                    <span>{place}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {phase === 'done' && (
            <>
              {final.length > 3 && (
                <ol className="rest" start={4}>
                  {final.slice(3, 10).map((s) => (
                    <li key={s.productId}>
                      <span>{data.products[s.productId].name}</span>
                      <span>{fmtInt(s.units)}</span>
                    </li>
                  ))}
                </ol>
              )}
              <div className="actions">
                <button className="ghost" onClick={onExit}>Skift periode</button>
                {onToggleRevenue && (
                  <button className="ghost" onClick={onToggleRevenue}>
                    {showRevenue ? 'Skjul omsætning' : 'Vis omsætning'}
                  </button>
                )}
                <button className="primary" onClick={onReplay}>Afspil igen</button>
              </div>
            </>
          )}
        </section>
      )}

      {phase !== 'done' && <span className="finale-hint">Klik eller tryk mellemrum for at gå videre</span>}
    </div>
  );
}

const BASE_CONFETTI = ['#e0b84c', '#f3f4f6', '#f2d27a'];

/** A one-off confetti burst from the winner's podium (no library). */
function Confetti({ fire, colors }: { fire: number; colors: string[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!fire || !c || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const palette = [...BASE_CONFETTI, ...colors];
    const ctx = c.getContext('2d')!;
    const w = (c.width = c.clientWidth * devicePixelRatio);
    const h = (c.height = c.clientHeight * devicePixelRatio);
    const s = devicePixelRatio;
    const bits = Array.from({ length: 150 }, (_, i) => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const v = (10 + Math.random() * 11) * s;
      return {
        x: w / 2 + (Math.random() - 0.5) * w * 0.12, y: h * 0.62, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, size: (6 + Math.random() * 7) * s,
        color: palette[i % palette.length],
      };
    });
    let raf = 0;
    let frames = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const b of bits) {
        b.vy += 0.3 * s;
        b.vx *= 0.985;
        b.vy *= 0.985;
        b.x += b.vx;
        b.y += b.vy;
        b.r += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.r);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = Math.max(0, 1 - frames / 260);
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      }
      if (++frames < 260) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fire, colors]);
  return <canvas ref={ref} className="confetti" aria-hidden />;
}
