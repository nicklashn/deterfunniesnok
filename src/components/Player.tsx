import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ordersAt, standingsAt, valueAt, type RaceData, type RaceEvent } from '../lib/race';
import { fmtClock, fmtDay, fmtInt, fmtKr } from '../lib/format';
import { isOpen, nextOpening } from '../lib/hours';
import { canRecord, captureTab, type Recording } from '../lib/record';
import { Summary } from './Summary';
import type { RaceSettings } from './SetupScreen';

// Three.js is split into its own chunk so the start page stays light
const WarehouseView = lazy(() => import('./warehouse/WarehouseView'));

interface Props {
  data: RaceData;
  settings: RaceSettings;
  onSettings: (s: RaceSettings) => void;
  onExit: () => void;
}

const SPEEDS = [0.5, 1, 2];
const NOTICE_MS = 3000;

/**
 * The player only owns "where is the playhead". Every number shown is looked up from the
 * precomputed RaceData at the playhead time, so pausing, seeking or changing speed can never
 * change the result.
 */
export function Player({ data, settings, onSettings, onExit }: Props) {
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [finished, setFinished] = useState(false);
  const [intro, setIntro] = useState(true);
  const root = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const [seekId, setSeekId] = useState(0);
  const progressRef = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  /** Number of events already announced; -1 = re-sync silently after a seek. */
  const passedRef = useRef(0);
  const [notice, setNotice] = useState<{ ev: RaceEvent; at: number } | null>(null);
  // Video export: the whole run (intro → finale) is recorded from this tab in the projector layout
  const [recording, setRecording] = useState(false);
  const recRef = useRef<Recording | null>(null);
  const [runKey, setRunKey] = useState(0);

  const span = data.end - data.start;
  const t = data.start + progress * span;

  // Playback loop
  useEffect(() => {
    if (!playing || finished || intro) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      const next = Math.min(1, progressRef.current + (dt * speedRef.current) / (settings.durationSec * 1000));
      progressRef.current = next;
      setProgress(next);
      if (next >= 1) {
        setPlaying(false);
        window.setTimeout(() => setFinished(true), 900);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, finished, intro, settings.durationSec]);

  const seek = useCallback((p: number) => {
    const clamped = Math.max(0, Math.min(1, p));
    progressRef.current = clamped;
    setProgress(clamped);
    setFinished(false);
    setSeekId((n) => n + 1);
    passedRef.current = -1;
  }, []);

  const restart = useCallback(() => {
    seek(0);
    passedRef.current = 0;
    setNotice(null);
    setPlaying(true);
  }, [seek]);

  const togglePlay = useCallback(() => {
    if (intro) return setIntro(false);
    if (progressRef.current >= 1) return restart();
    setPlaying((p) => !p);
  }, [restart, intro]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.current?.requestFullscreen().catch(() => {});
  }, []);
  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const startRecording = useCallback(async () => {
    const name = ['lagerforloeb', settings.company, new Date(data.start).toLocaleDateString('sv-SE')]
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9æøå-]+/g, '-');
    const rec = await captureTab(name, () => {
      recRef.current = null;
      setRecording(false);
    });
    if (!rec) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    recRef.current = rec;
    setRecording(true);
    // Let the projector layout settle, then record from the very start of the intro
    window.setTimeout(() => {
      rec.start();
      setSpeed(1);
      setNotice(null);
      setRunKey((k) => k + 1);
      setIntro(true);
      seek(0);
      passedRef.current = 0;
      setPlaying(true);
    }, 400);
  }, [data.start, settings.company, seek]);
  const stopRecording = useCallback(() => recRef.current?.stop(), []);
  useEffect(() => {
    document.documentElement.classList.toggle('recording', recording);
    return () => document.documentElement.classList.remove('recording');
  }, [recording]);
  // Leaving the player mid-recording still saves what was recorded
  useEffect(() => () => recRef.current?.stop(), []);

  // Keyboard: space = play/pause (or skip the intro), R = restart, F = full screen, Esc = stop recording
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (recRef.current) {
        if (e.key === 'Escape') stopRecording();
        return; // no seeking or pausing while recording
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'r' || e.key === 'R') {
        setIntro(false);
        restart();
      } else if (e.key === 'f' || e.key === 'F') toggleFull();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, restart, toggleFull, stopRecording]);

  // Exact state at the playhead
  const standings = useMemo(() => standingsAt(data, t), [data, t]);
  const orders = ordersAt(data, t);
  const units = valueAt(data.units, t);
  const revenue = data.revenue ? valueAt(data.revenue, t) : null;

  // Events crossed by the playhead (announced as toasts)
  const passedCount = useMemo(() => {
    let n = 0;
    while (n < data.events.length && data.events[n].time <= t) n++;
    return n;
  }, [data.events, t]);
  useEffect(() => {
    if (passedRef.current === -1) {
      passedRef.current = passedCount;
      return;
    }
    if (passedCount > passedRef.current) setNotice({ ev: data.events[passedCount - 1], at: performance.now() });
    passedRef.current = passedCount;
  }, [passedCount, data.events]);
  const noticeVisible = notice && performance.now() - notice.at < NOTICE_MS;

  const multiDay = span > 26 * 3_600_000;
  const shown = Math.min(t, data.end - 1);

  return (
    <section className={`player ${full || recording ? 'full' : ''} ${recording ? 'rec' : ''} ${intro ? 'in-intro' : ''} ${finished ? 'finished' : ''}`} ref={root}>
      <div className="player-head">
        {finished ? (
          <div className="clock">
            <span className="clock-time ended">Perioden er slut</span>
            <span className="clock-day">{fmtDay(data.start)} – {fmtDay(data.end - 1)}</span>
          </div>
        ) : (
          <div className="clock">
            <span className="clock-time">{fmtClock(shown)}</span>
            <span className="clock-day">
              {fmtDay(multiDay ? shown : data.start)}
              {!intro && !isOpen(settings.hours, shown) && (
                <span className="closed-tag" title="Uden for åbningstid: ordrerne venter til næste morgen">
                  <span aria-hidden>☾</span> Lukket · åbner kl. {fmtClock(nextOpening(settings.hours, shown))}
                </span>
              )}
            </span>
          </div>
        )}
        {!finished && (
          <div className="kpis">
            <Kpi label="Ordrer" value={fmtInt(orders)} />
            <Kpi label="Solgte varer" value={fmtInt(units)} />
            {settings.showRevenue && revenue !== null && <Kpi label="Omsætning" value={fmtKr(revenue)} />}
          </div>
        )}
      </div>

      <div className="stage">
        <Suspense fallback={<div className="warehouse loading">Indlæser lager…</div>}>
          <WarehouseView
            key={runKey}
            data={data}
            t={t}
            standings={standings}
            playing={playing && !intro}
            speed={speed}
            durationSec={settings.durationSec}
            staff={settings.staff}
            company={settings.company}
            logo={settings.logo}
            hours={settings.hours}
            intro={intro}
            onIntroDone={() => setIntro(false)}
            seek={seekId}
            hud={full || recording}
          />
        </Suspense>
        {intro && !recording && (
          <button className="skip" onClick={() => setIntro(false)}>Spring intro over <kbd>mellemrum</kbd></button>
        )}
        {noticeVisible && (
          <div className="notice" key={notice.at}>
            <time>{fmtClock(notice.ev.time)}</time>
            <EventText ev={notice.ev} data={data} />
          </div>
        )}
        {finished && (
          <Summary
            data={data}
            showRevenue={settings.showRevenue}
            company={settings.company}
            logo={settings.logo}
            onReplay={restart}
            onExit={onExit}
            onDone={() => window.setTimeout(stopRecording, 2500)}
            onToggleRevenue={data.revenue ? () => onSettings({ ...settings, showRevenue: !settings.showRevenue }) : undefined}
          />
        )}
      </div>

      <Timeline data={data} progress={progress} onSeek={recording ? () => {} : seek} />

      <div className="controls">
        <button className="ctl play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Afspil'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="ctl" onClick={restart} title="Genstart (R)">Genstart</button>
        <div className="seg">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
              {s.toLocaleString('da-DK')}×
            </button>
          ))}
        </div>
        <span className="muted small hide-sm">{settings.durationSec} sek. ved 1× · mellemrum = pause · F = fuld skærm</span>
        <span className="spacer" />
        {canRecord() && !full && (
          <button
            className="ctl"
            onClick={startRecording}
            title="Optager hele forløbet fra intro til finale som video, direkte i browseren. Bliv på fanen, mens den optager."
          >
            Gem som video
          </button>
        )}
        <button className="ctl" onClick={toggleFull}>{full ? 'Afslut fuld skærm' : 'Fuld skærm'}</button>
        {!full && <button className="ctl" onClick={onExit}>Skift periode</button>}
      </div>

    </section>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi">
      <span className="kpi-value">{value}</span>
      <span className="kpi-label">{label}</span>
    </div>
  );
}

function EventText({ ev, data }: { ev: RaceEvent; data: RaceData }) {
  const name = (id: number) => data.products[id].name;
  switch (ev.kind) {
    case 'first':
      return <span>Første ordre ({ev.orderId}): <b>{name(ev.productId)}</b></span>;
    case 'lead':
      return <span>Ny førende vare: <b>{name(ev.productId)}</b> overhaler {name(ev.prevId)} ({fmtInt(ev.units)} mod {fmtInt(ev.prevUnits)} stk.)</span>;
    case 'busiest':
      return <span>Travleste time begynder: {fmtClock(ev.time)}–{fmtClock(ev.end)} med <b>{fmtInt(ev.orders)}</b> ordrer</span>;
  }
}

function Timeline({ data, progress, onSeek }: { data: RaceData; progress: number; onSeek: (p: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...data.hourly.map((h) => h.orders));
  const span = data.end - data.start;

  const fromEvent = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onSeek((e.clientX - r.left) / r.width);
  };

  return (
    <div
      ref={ref}
      className="timeline"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && fromEvent(e)}
      role="slider"
      aria-label="Tidslinje"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
    >
      {data.hourly.map((h) => {
        const left = ((Math.max(h.start, data.start) - data.start) / span) * 100;
        const width = ((Math.min(h.start + 3_600_000, data.end) - Math.max(h.start, data.start)) / span) * 100;
        const past = h.start < data.start + progress * span;
        return (
          <span
            key={h.start}
            className={`tl-bar ${past ? 'past' : ''} ${data.busiest?.start === h.start ? 'busiest' : ''}`}
            style={{ left: `${left}%`, width: `${width}%`, height: `${(h.orders / max) * 100}%` }}
            title={`${fmtClock(h.start)}: ${h.orders} ordrer`}
          />
        );
      })}
      {data.events
        .filter((e) => e.kind === 'lead')
        .map((e) => (
          <span key={e.time} className="tl-mark" style={{ left: `${((e.time - data.start) / span) * 100}%` }} />
        ))}
      <span className="tl-head" style={{ left: `${progress * 100}%` }} />
    </div>
  );
}
