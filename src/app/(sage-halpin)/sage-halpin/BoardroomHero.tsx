'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The hero: an oval boardroom table whose twelve seats slowly change between
 * people (green) and AI agents (white), while faded years drift 2020 → 2030 →
 * 2020 behind it. Everything runs off one animation clock that advances only
 * while the hero is on screen, so the pace is constant and the loop never jumps.
 * With reduced motion requested, a single still frame is drawn.
 */

const FIRST = 2020;
const LAST = 2030;
const YEARS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => FIRST + i);
const YEAR_MS = 7000; // one year every 7 seconds
const SWAP_EVERY = 3600; // one seat changes hands every 3.6 seconds
const FADE_MS = 3200;
const EMPTY_MS = 1200;
const SEAT_COUNT = 12;
const PERSON = [127, 182, 146] as const;
const AGENT = [245, 241, 233] as const;
const BRASS = [178, 138, 86] as const;
const INITIAL = [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0];

type Kind = 'person' | 'agent';
interface Seat {
  kind: Kind;
  from: number;
  to: number;
  start: number;
  next: Kind | null;
  refillAt: number;
}

const rgba = (c: readonly number[], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
// Gentle ease for a seat's own fade; the rhythm between seats is fixed.
const soft = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

// Triangle wave: constant speed up to 2030 and back, forever.
const SPAN = LAST - FIRST;
const LEG = SPAN * YEAR_MS;
function yearPosition(clock: number): number {
  const t = clock % (LEG * 2);
  return t < LEG ? (t / LEG) * SPAN : SPAN - ((t - LEG) / LEG) * SPAN;
}

export function BoardroomHero({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const track = trackRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !track || !ctx) return;
    const spans = Array.from(track.children) as HTMLElement[];
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    let shownYear: number | null = null;
    const placeYears = (pos: number) => {
      const [first, second] = spans;
      if (!first || !second) return;
      const step = second.offsetLeft - first.offsetLeft;
      const width = track.parentElement?.getBoundingClientRect().width ?? 0;
      const centre = width * 0.62 - first.offsetWidth / 2;
      track.style.transform = `translate3d(${(centre - pos * step).toFixed(2)}px,0,0)`;
      const year = FIRST + Math.round(pos);
      if (year !== shownYear) {
        if (shownYear !== null) spans[shownYear - FIRST]?.classList.remove('now');
        spans[year - FIRST]?.classList.add('now');
        shownYear = year;
      }
    };

    const seats: Seat[] = INITIAL.map((p) => ({
      kind: p ? 'person' : 'agent',
      from: 1,
      to: 1,
      start: 0,
      next: null,
      refillAt: 0,
    }));
    const level = (seat: Seat, clock: number) => seat.from + (seat.to - seat.from) * soft((clock - seat.start) / FADE_MS);
    const fadeTo = (seat: Seat, to: number, clock: number) => {
      seat.from = level(seat, clock);
      seat.to = to;
      seat.start = clock;
    };

    // Visit every seat once in a shuffled order, then reshuffle: a steady
    // rhythm, no seat left untouched, none changing twice in a row.
    let order: number[] = [];
    let cursor = 0;
    const nextSeat = (): Seat => {
      if (cursor >= order.length) {
        const prev = order[order.length - 1];
        order = seats.map((_, k) => k);
        for (let k = order.length - 1; k > 0; k--) {
          const j = Math.floor(Math.random() * (k + 1));
          [order[k], order[j]] = [order[j]!, order[k]!];
        }
        if (order[0] === prev) order.push(order.shift()!);
        cursor = 0;
      }
      return seats[order[cursor++]!]!;
    };

    let nextSwapAt = 1500;
    const update = (clock: number) => {
      while (clock >= nextSwapAt) {
        const seat = nextSeat();
        // Most changes hand the seat to the other kind of contributor.
        seat.next = Math.random() < 0.7 ? (seat.kind === 'person' ? 'agent' : 'person') : seat.kind;
        seat.refillAt = nextSwapAt + FADE_MS + EMPTY_MS;
        fadeTo(seat, 0, nextSwapAt);
        nextSwapAt += SWAP_EVERY;
      }
      for (const seat of seats) {
        if (seat.next !== null && clock >= seat.refillAt) {
          seat.kind = seat.next;
          seat.next = null;
          fadeTo(seat, 1, seat.refillAt);
        }
      }
    };

    let width = 0;
    let height = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = r.width;
      height = r.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const pill = (x: number, y: number, w: number, h: number) => {
      const r = h / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x + r, y + h);
      ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
    };

    const draw = (clock: number) => {
      ctx.clearRect(0, 0, width, height);
      const cx = width * 0.5;
      const cy = height * 0.5;
      const rx = width * 0.34;
      const ry = rx * 0.42;
      const chairs = seats.map((seat, k) => {
        const ang = -Math.PI / 2 + (k / SEAT_COUNT) * Math.PI * 2 + Math.PI / SEAT_COUNT;
        return { seat, ang, x: cx + Math.cos(ang) * rx * 1.2, y: cy + Math.sin(ang) * ry * 1.42, depth: (Math.sin(ang) + 1) / 2 };
      });
      const chair = (c: (typeof chairs)[number]) => {
        const lvl = level(c.seat, clock);
        const scale = (0.78 + c.depth * 0.42) * (width / 560);
        const w = 30 * scale;
        const h = 20 * scale;
        const col = c.seat.kind === 'person' ? PERSON : AGENT;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.ang + Math.PI / 2);
        pill(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = rgba(AGENT, 0.16);
        ctx.lineWidth = 1;
        ctx.stroke();
        if (lvl > 0.01) {
          ctx.shadowColor = rgba(col, 0.55 * lvl);
          ctx.shadowBlur = 22 * scale;
          pill(-w / 2, -h / 2, w, h);
          ctx.fillStyle = rgba(col, 0.92 * lvl);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.restore();
      };

      // Back chairs, then the table, then front chairs.
      chairs.filter((c) => Math.sin(c.ang) < 0).forEach(chair);
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry * 0.14, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
      g.addColorStop(0, '#24404B');
      g.addColorStop(1, '#172A33');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(BRASS, 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 0.72, ry * 0.66, 0, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(AGENT, 0.08);
      ctx.stroke();
      ctx.strokeStyle = rgba(AGENT, 0.5);
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.36, cy);
      ctx.lineTo(cx + rx * 0.36, cy);
      ctx.stroke();
      chairs.filter((c) => Math.sin(c.ang) >= 0).forEach(chair);
    };

    let clock = 0;
    let last = 0;
    let frame = 0;
    let visible = true;
    const render = () => {
      update(clock);
      placeYears(yearPosition(clock));
      draw(clock);
    };
    const tick = (now: number) => {
      clock += Math.min(50, Math.max(0, now - last)); // capped, so a slow frame never jumps the loop
      last = now;
      render();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (frame || !visible || document.hidden || motion.matches) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const still = () => {
      stop();
      resize();
      placeYears(6);
      draw(0);
    };
    const apply = () => {
      if (motion.matches) still();
      else {
        resize();
        render();
        start();
      }
    };

    const resizer = new ResizeObserver(() => {
      resize();
      if (motion.matches) still();
      else render();
    });
    resizer.observe(canvas);
    const io = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    motion.addEventListener('change', apply);
    void document.fonts?.ready.then(() => (motion.matches ? still() : render()));
    apply();

    return () => {
      stop();
      resizer.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      motion.removeEventListener('change', apply);
    };
  }, []);

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="years" aria-hidden="true">
        <div className="years-track" ref={trackRef}>
          {YEARS.map((y) => (
            <span key={y}>{y}</span>
          ))}
        </div>
      </div>
      <div className="wrap hero-inner">
        {children}
        <div className="stage">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="An oval boardroom table. Its seats slowly change between people, shown green, and AI agents, shown white, as the years pass from 2020 to 2030."
          />
          <div className="legend">
            <span className="chip">
              <span className="dot dot-person" />
              People
            </span>
            <span className="chip">
              <span className="dot dot-agent" />
              AI agents
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
