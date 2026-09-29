'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * "Ask the board": example questions on the left cycle at a steady rhythm; on
 * the table, sparks of reasoning arc between the six seats; the matching answer
 * appears on the right. Clicking a question selects it. Reduced motion gets a
 * still frame and no automatic cycling.
 */

const QUESTIONS = [
  {
    q: 'Should we acquire Calder Sensing for about £9m?',
    label: 'Recommended',
    a: 'Not at £9m by March. Offer £7.5m with a 40% earn-out tied to connected revenue, or license first.',
    by: 'Risk · Commercial · Governance · M&A adviser',
  },
  {
    q: 'How do we lift gross margin from 31% to 35%?',
    label: 'Recommended',
    a: 'Enforce discount policy, add indexation at renewal and pilot a service tier. Change the sales bonus first.',
    by: 'Commercial · Culture · Pricing strategist',
  },
  {
    q: 'Hire an external COO, or promote from within?',
    label: 'Recommended',
    a: 'Promote, with a 12-month scaling adviser and a site-launch lead for the second site.',
    by: 'Culture · Innovation · Independent director',
  },
  {
    q: 'What should we be preparing for over the next three years?',
    label: 'Prepared',
    a: 'Three signals to prepare for: sensor price deflation, customer consolidation and stricter data rules. An options paper is ready for each.',
    by: 'Innovation · Risk · Horizon scanning',
  },
];

const QUESTION_MS = 8000; // each question held for 8 seconds
const SPARK_EVERY = 420; // a new spark every 0.42 seconds
const SPARK_LIFE = 900;
const POS: [number, number][] = [
  [20, 7],
  [34, 13],
  [34, 27],
  [20, 33],
  [6, 27],
  [6, 13],
];
const COLS = ['#7FB692', '#F2EEE4', '#D9A15F', '#6FA8D6', '#E07F6A', '#A99BDA'];

interface Spark {
  a: number;
  b: number;
  born: number;
  seed: number;
}

const jitter = (seed: number, i: number) => {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

export function FlowBoard() {
  const [active, setActive] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The animation loop advances the question; clicks reset its timer.
  const pickRef = useRef<(i: number) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

    // Sparks mostly jump across the table, so they arc through the oval.
    let sparks: Spark[] = [];
    const spawn = (at: number) => {
      const a = Math.floor(Math.random() * 6);
      const b = (a + 2 + Math.floor(Math.random() * 3)) % 6;
      sparks.push({ a, b, born: at, seed: Math.random() * 1000 });
    };

    const draw = (clock: number) => {
      ctx.clearRect(0, 0, width, height);
      const u = (Math.min(width, height) / 40) * 0.94;
      const px = (v: number) => width / 2 + (v - 20) * u;
      const py = (v: number) => height / 2 + (v - 20) * u;

      ctx.beginPath();
      ctx.ellipse(px(20), py(20), 11.5 * u, 7 * u, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245,241,233,0.03)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(245,241,233,0.9)';
      ctx.lineWidth = Math.max(1.5, 0.7 * u);
      ctx.stroke();

      // A jagged path that re-forms as it flickers, then fades.
      const flick = Math.floor(clock / 70);
      sparks = sparks.filter((s) => clock - s.born <= SPARK_LIFE);
      for (const s of sparks) {
        const life = (clock - s.born) / SPARK_LIFE;
        const alpha = life < 0.15 ? life / 0.15 : 1 - (life - 0.15) / 0.85;
        const [ax0, ay0] = POS[s.a]!;
        const [bx0, by0] = POS[s.b]!;
        const ax = px(ax0);
        const ay = py(ay0);
        const bx = px(bx0);
        const by = py(by0);
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        const nx = -dy / len;
        const ny = dx / len;
        const segs = 9;
        const amp = len * 0.07;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          for (let k = 0; k <= segs; k++) {
            const t = k / segs;
            const off = k === 0 || k === segs ? 0 : jitter(s.seed + flick, k) * amp * Math.sin(Math.PI * t);
            const x = ax + dx * t + nx * off;
            const y = ay + dy * t + ny * off;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          if (pass === 0) {
            ctx.strokeStyle = COLS[s.a]!;
            ctx.globalAlpha = 0.35 * alpha;
            ctx.lineWidth = Math.max(3, 0.9 * u);
            ctx.shadowColor = COLS[s.a]!;
            ctx.shadowBlur = 2.5 * u;
          } else {
            ctx.strokeStyle = '#FFFFFF';
            ctx.globalAlpha = 0.9 * alpha;
            ctx.lineWidth = Math.max(1, 0.22 * u);
            ctx.shadowBlur = 0;
          }
          ctx.stroke();
        }
        // A ping where it lands.
        ctx.globalAlpha = 0.5 * alpha;
        ctx.fillStyle = COLS[s.b]!;
        ctx.beginPath();
        ctx.arc(bx, by, (3 + life * 2.2) * u, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // The six seats, drawn last so sparks start and end beneath them.
      POS.forEach(([x, y], i) => {
        ctx.save();
        ctx.shadowColor = COLS[i]!;
        ctx.shadowBlur = 1.8 * u;
        ctx.beginPath();
        ctx.arc(px(x), py(y), 3 * u, 0, Math.PI * 2);
        ctx.fillStyle = COLS[i]!;
        ctx.fill();
        ctx.restore();
      });
    };

    let clock = 0;
    let last = 0;
    let frame = 0;
    let visible = false;
    let nextSpark = 0;
    let nextQuestionAt = QUESTION_MS;
    let current = 0;
    pickRef.current = (i: number) => {
      current = i;
      setActive(i);
      nextQuestionAt = clock + QUESTION_MS;
    };

    const tick = (now: number) => {
      clock += Math.min(50, Math.max(0, now - last));
      last = now;
      while (clock >= nextSpark) {
        spawn(nextSpark);
        nextSpark += SPARK_EVERY;
      }
      if (clock >= nextQuestionAt) {
        current = (current + 1) % QUESTIONS.length;
        setActive(current);
        nextQuestionAt += QUESTION_MS;
      }
      draw(clock);
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
      sparks = [
        { a: 0, b: 3, born: -200, seed: 7 },
        { a: 2, b: 5, born: -300, seed: 3 },
      ];
      draw(0);
    };
    const apply = () => {
      if (motion.matches) still();
      else {
        resize();
        draw(clock);
        start();
      }
    };

    const resizer = new ResizeObserver(() => {
      resize();
      if (motion.matches) still();
      else draw(clock);
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
    <div className="flow-stage">
      <ol className="flow-qs" aria-label="Example questions">
        {QUESTIONS.map((item, i) => (
          <li key={item.q}>
            <button
              type="button"
              className={`flow-q${i === active ? ' is-on' : ''}`}
              aria-pressed={i === active}
              onClick={() => pickRef.current(i)}
            >
              <span className="flow-n">Q</span>
              {item.q}
            </button>
          </li>
        ))}
      </ol>
      <div className="flow-table">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="The board table: sparks of reasoning pass between the six seats as a question is worked."
        />
      </div>
      <div className="flow-as" aria-live="polite">
        {QUESTIONS.map((item, i) => (
          <article key={item.q} className={`flow-a${i === active ? ' is-on' : ''}`} aria-hidden={i !== active}>
            <p className="label">{item.label}</p>
            <p className="flow-a-main">{item.a}</p>
            <p className="flow-a-by">{item.by}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
