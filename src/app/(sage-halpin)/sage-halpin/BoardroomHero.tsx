'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The hero: the Sage Halpin mark, alive. Six seats around one oval table, in
 * the mark's own geometry. People are green; AI agents take the mark's other
 * colours. One seat changes hands at a time at a steady rhythm, while faded
 * years roll forward 2020 → 2030 and on round to 2020, always the same way.
 * One animation clock drives it and advances only while the hero is on screen,
 * so the pace is constant and the loop never jumps. Reduced motion gets a still
 * frame.
 */

const FIRST = 2020;
const LAST = 2030;
const COUNT = LAST - FIRST + 1;
// The decade three times over, so wrapping from 2030 to 2020 lands on an
// identical frame and the loop has no visible seam.
const COPIES = 3;
const STRIP = Array.from({ length: COUNT * COPIES }, (_, i) => FIRST + (i % COUNT));
const YEAR_MS = 14000; // one year every 14 seconds
const SWAP_EVERY = 3600; // one seat changes hands every 3.6 seconds
const FADE_MS = 3200;
const EMPTY_MS = 1200;

const PERSON = '#7FB692';
const AGENTS = ['#F2EEE4', '#D9A15F', '#6FA8D6', '#E07F6A', '#A99BDA'];
const OVAL = 'rgba(245,241,233,0.9)';

// The mark's geometry, in its 40-unit grid (see Mark.tsx).
const CENTRE = 20;
const RX = 11.5;
const RY = 7;
const DOT = 3;
const POSITIONS: [number, number][] = [
  [20, 7],
  [34, 13],
  [34, 27],
  [20, 33],
  [6, 27],
  [6, 13],
];
// Start as the logo: one person at the head of the table, five agents.
const START = [PERSON, ...AGENTS];

interface Seat {
  colour: string;
  person: boolean;
  from: number;
  to: number;
  start: number;
  next: boolean | null;
  refillAt: number;
}

// Gentle ease for a seat's own fade; the rhythm between seats is fixed.
const soft = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
// Constant forward motion through the decade, wrapping at the end.
const yearPosition = (clock: number) => (clock / YEAR_MS) % COUNT;

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

    let shown: number | null = null;
    const placeYears = (pos: number) => {
      const index = COUNT + pos; // always within the middle copy
      const i = Math.floor(index);
      const here = spans[i];
      const after = spans[i + 1];
      if (!here || !after) return;
      // Interpolate between measured positions, so the copies line up exactly
      // whatever the width of each numeral.
      const x = here.offsetLeft + (after.offsetLeft - here.offsetLeft) * (index - i);
      const width = track.parentElement?.getBoundingClientRect().width ?? 0;
      const centre = width * 0.62 - here.offsetWidth / 2;
      track.style.transform = `translate3d(${(centre - x).toFixed(2)}px,0,0)`;
      const now = Math.round(index);
      if (now !== shown) {
        if (shown !== null) spans[shown]?.classList.remove('now');
        spans[now]?.classList.add('now');
        shown = now;
      }
    };

    const seats: Seat[] = START.map((colour) => ({
      colour,
      person: colour === PERSON,
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

    // An agent joining takes a colour not already at the table where possible.
    const agentColour = () => {
      const used = new Set(seats.map((s) => s.colour));
      const free = AGENTS.filter((c) => !used.has(c));
      const pool = free.length ? free : AGENTS;
      return pool[Math.floor(Math.random() * pool.length)]!;
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
        seat.next = Math.random() < 0.7 ? !seat.person : seat.person;
        seat.refillAt = nextSwapAt + FADE_MS + EMPTY_MS;
        fadeTo(seat, 0, nextSwapAt);
        nextSwapAt += SWAP_EVERY;
      }
      for (const seat of seats) {
        if (seat.next !== null && clock >= seat.refillAt) {
          seat.person = seat.next;
          seat.next = null;
          seat.colour = seat.person ? PERSON : agentColour();
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

    const draw = (clock: number) => {
      ctx.clearRect(0, 0, width, height);
      const u = (Math.min(width, height) / 40) * 0.92; // one unit of the mark's grid
      const px = (v: number) => width / 2 + (v - CENTRE) * u;
      const py = (v: number) => height / 2 + (v - CENTRE) * u;

      ctx.beginPath();
      ctx.ellipse(px(CENTRE), py(CENTRE), RX * u, RY * u, 0, 0, Math.PI * 2);
      ctx.strokeStyle = OVAL;
      ctx.lineWidth = Math.max(1.5, (1.6 * u) / 2.2);
      ctx.stroke();

      seats.forEach((seat, k) => {
        const [sx, sy] = POSITIONS[k]!;
        const x = px(sx);
        const y = py(sy);
        const r = DOT * u;
        const lvl = level(seat, clock);
        // The empty seat is always faintly there.
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(245,241,233,0.16)';
        ctx.lineWidth = 1;
        ctx.stroke();
        if (lvl > 0.01) {
          ctx.save();
          ctx.globalAlpha = lvl;
          ctx.shadowColor = seat.colour;
          ctx.shadowBlur = r * 0.9;
          ctx.beginPath();
          ctx.arc(x, y, r * (0.86 + 0.14 * lvl), 0, Math.PI * 2);
          ctx.fillStyle = seat.colour;
          ctx.fill();
          ctx.restore();
        }
      });
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
          {STRIP.map((y, i) => (
            <span key={i}>{y}</span>
          ))}
        </div>
      </div>
      <div className="wrap hero-inner">
        {children}
        <div className="stage">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="The Sage Halpin mark as a boardroom: six seats around an oval table slowly change between people, shown green, and AI agents in other colours, as the years roll on from 2020 to 2030 and round again."
          />
          <div className="legend">
            <span className="chip">
              <span className="dot dot-person" />
              People
            </span>
            <span className="chip">
              <span className="dots" aria-hidden="true">
                {AGENTS.map((c) => (
                  <span key={c} className="dot" style={{ background: c }} />
                ))}
              </span>
              AI agents
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
