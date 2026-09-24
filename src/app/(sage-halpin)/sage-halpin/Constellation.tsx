'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The hero animation. Nodes — people (rings) and agents (diamonds) — join,
 * exchange with one another, contribute to the central line and move on. The
 * line stays, grows, and keeps a mark for every contribution made to it.
 *
 * With reduced motion requested (or before hydration) a static composition is
 * shown instead; it is the same idea held still.
 */

const INK = '#13232B';
const IVORY = '#F5F1E9';
const BRASS = '#B28A56';
const SLATE = '#65737A';

type Kind = 'human' | 'agent';

interface Node {
  kind: Kind;
  born: number;
  // Resting position, and the point on the line it contributes to.
  x: number;
  y: number;
  anchorX: number;
  // Direction it arrives from and leaves towards.
  dx: number;
  dy: number;
  contributed: boolean;
}

interface Exchange {
  a: Node;
  b: Node;
  born: number;
}

const ENTER = 1100;
const CONNECT_AT = 1300;
const PULSE = 900;
const LEAVE_AT = 4600;
const LEAVE = 1300;
const LIFE = LEAVE_AT + LEAVE;
const SPAWN_EVERY = 780;
const MAX_NODES = 9;
const MAX_MARKS = 140;
const GROW_MS = 20000;

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3));

export function Constellation() {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setAnimate(!query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return (
    <div className="sh-constellation" aria-hidden="true">
      {animate ? <MovingConstellation /> : <StillConstellation />}
    </div>
  );
}

function MovingConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    // Positions are stored as fractions of the canvas so a resize keeps the
    // composition rather than scattering it.
    const nodes: Node[] = [];
    const exchanges: Exchange[] = [];
    const marks: { x: number; born: number; kind: Kind }[] = [];
    let clock = 0;
    let last = performance.now();
    let lastSpawn = -SPAWN_EVERY;
    let visible = true;
    let frame = 0;

    const lineStart = 0.05;
    const lineEnd = (t: number) => 0.6 + 0.35 * ease(Math.min(1, t / GROW_MS));
    const lineY = () => height * 0.56;

    const spawn = () => {
      const end = lineEnd(clock);
      const anchorX = lineStart + 0.04 + Math.random() * (end - lineStart - 0.06);
      const above = Math.random() < 0.55;
      const offset = 0.14 + Math.random() * 0.3;
      const n: Node = {
        kind: Math.random() < 0.45 ? 'human' : 'agent',
        born: clock,
        x: Math.min(0.97, Math.max(0.03, anchorX + (Math.random() - 0.5) * 0.16)),
        y: above ? 0.56 - offset : 0.56 + offset * 0.8,
        anchorX,
        dx: (Math.random() - 0.5) * 0.08,
        dy: above ? -0.07 : 0.07,
        contributed: false,
      };
      nodes.push(n);

      // Occasionally a newcomer exchanges with someone already present.
      const peers = nodes.filter((p) => p !== n && clock - p.born > ENTER && clock - p.born < LEAVE_AT);
      if (peers.length && Math.random() < 0.6) {
        exchanges.push({ a: n, b: peers[Math.floor(Math.random() * peers.length)]!, born: clock + ENTER * 0.8 });
      }
    };

    const position = (n: Node) => {
      const age = clock - n.born;
      let x = n.x;
      let y = n.y;
      let alpha = 1;
      if (age < ENTER) {
        const k = 1 - ease(age / ENTER);
        x -= n.dx * k;
        y += n.dy * k;
        alpha = ease(age / ENTER);
      } else if (age > LEAVE_AT) {
        const k = ease((age - LEAVE_AT) / LEAVE);
        x += n.dx * k;
        y += n.dy * k;
        alpha = 1 - k;
      }
      return { x: x * width, y: y * height, alpha };
    };

    const drawNode = (kind: Kind, x: number, y: number, alpha: number) => {
      ctx.globalAlpha = alpha;
      if (kind === 'human') {
        ctx.strokeStyle = IVORY;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.fill();
      } else {
        ctx.fillStyle = BRASS;
        ctx.beginPath();
        ctx.moveTo(x, y - 7);
        ctx.lineTo(x + 7, y);
        ctx.lineTo(x, y + 7);
        ctx.lineTo(x - 7, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const ly = lineY();
      const x0 = lineStart * width;
      const x1 = lineEnd(clock) * width;

      // Exchanges between nodes: a faint thread, briefly.
      for (let i = exchanges.length - 1; i >= 0; i--) {
        const e = exchanges[i]!;
        const age = clock - e.born;
        if (age > 2200 || clock - e.a.born > LIFE || clock - e.b.born > LIFE) {
          exchanges.splice(i, 1);
          continue;
        }
        if (age < 0) continue;
        const a = position(e.a);
        const b = position(e.b);
        const fade = Math.sin(Math.PI * Math.min(1, age / 2200)) * Math.min(a.alpha, b.alpha);
        ctx.strokeStyle = SLATE;
        ctx.globalAlpha = 0.7 * fade;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // Connectors from each node to the line, with a pulse travelling down.
      for (const n of nodes) {
        const age = clock - n.born;
        if (age < CONNECT_AT) continue;
        const p = position(n);
        const ax = n.anchorX * width;
        const reach = ease((age - CONNECT_AT) / 500);
        ctx.strokeStyle = SLATE;
        ctx.globalAlpha = 0.85 * p.alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + (ax - p.x) * reach, p.y + (ly - p.y) * reach);
        ctx.stroke();

        const t = (age - CONNECT_AT - 300) / PULSE;
        if (t > 0 && t < 1) {
          const k = ease(t);
          ctx.fillStyle = n.kind === 'agent' ? BRASS : IVORY;
          ctx.globalAlpha = p.alpha;
          ctx.beginPath();
          ctx.arc(p.x + (ax - p.x) * k, p.y + (ly - p.y) * k, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
        if (t >= 1 && !n.contributed) {
          n.contributed = true;
          marks.push({ x: n.anchorX, born: clock, kind: n.kind });
          if (marks.length > MAX_MARKS) marks.shift();
        }
        ctx.globalAlpha = 1;
      }

      // The line: continuous, growing, carrying every contribution.
      const gradient = ctx.createLinearGradient(x0, 0, x1, 0);
      gradient.addColorStop(0, 'rgba(245,241,233,0.35)');
      gradient.addColorStop(0.5, 'rgba(245,241,233,0.9)');
      gradient.addColorStop(1, 'rgba(245,241,233,1)');
      ctx.strokeStyle = gradient;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, ly);
      ctx.lineTo(x1, ly);
      ctx.stroke();

      for (const m of marks) {
        const age = clock - m.born;
        const flash = Math.max(0, 1 - age / 900);
        const h = 4 + flash * 6;
        ctx.strokeStyle = BRASS;
        ctx.globalAlpha = 0.55 + flash * 0.45;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(m.x * width, ly - h);
        ctx.lineTo(m.x * width, ly + h);
        ctx.stroke();
        if (flash > 0) {
          ctx.globalAlpha = flash * 0.35;
          ctx.fillStyle = BRASS;
          ctx.beginPath();
          ctx.arc(m.x * width, ly, 4 + (1 - flash) * 10, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // The growing end of the line.
      ctx.fillStyle = IVORY;
      ctx.beginPath();
      ctx.arc(x1, ly, 3, 0, Math.PI * 2);
      ctx.fill();

      for (const n of nodes) {
        const p = position(n);
        drawNode(n.kind, p.x, p.y, p.alpha);
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      clock += dt;
      if (clock - lastSpawn > SPAWN_EVERY && nodes.length < MAX_NODES) {
        spawn();
        lastSpawn = clock;
      }
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (clock - nodes[i]!.born > LIFE) nodes.splice(i, 1);
      }
      draw();
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame || !visible || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    // Seed the first moment so the hero is never empty on arrival.
    for (let i = 0; i < 4; i++) {
      spawn();
      nodes[nodes.length - 1]!.born -= 900 * (4 - i);
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      observer.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} className="sh-constellation-canvas" />;
}

// The same idea held still: shown for reduced motion and before hydration.
const STILL_NODES: { kind: Kind; x: number; y: number; ax: number }[] = [
  { kind: 'human', x: 150, y: 90, ax: 190 },
  { kind: 'agent', x: 330, y: 150, ax: 320 },
  { kind: 'human', x: 470, y: 400, ax: 450 },
  { kind: 'agent', x: 600, y: 70, ax: 620 },
  { kind: 'agent', x: 250, y: 420, ax: 270 },
  { kind: 'human', x: 780, y: 130, ax: 760 },
  { kind: 'agent', x: 900, y: 380, ax: 880 },
  { kind: 'human', x: 1050, y: 110, ax: 1020 },
];
const STILL_MARKS = [110, 150, 190, 230, 270, 320, 360, 400, 450, 520, 570, 620, 700, 760, 820, 880, 950, 1020];

function StillConstellation() {
  const ly = 290;
  return (
    <svg className="sh-constellation-still" viewBox="0 0 1200 520" preserveAspectRatio="xMidYMid meet">
      <line x1="330" y1="150" x2="600" y2="70" stroke={SLATE} strokeDasharray="2 4" />
      <line x1="470" y1="400" x2="250" y2="420" stroke={SLATE} strokeDasharray="2 4" />
      {STILL_NODES.map((n, i) => (
        <line key={`c${i}`} x1={n.x} y1={n.y} x2={n.ax} y2={ly} stroke={SLATE} />
      ))}
      <line x1="60" y1={ly} x2="1140" y2={ly} stroke={IVORY} strokeWidth="2" strokeLinecap="round" />
      {STILL_MARKS.map((x) => (
        <line key={x} x1={x} y1={ly - 4} x2={x} y2={ly + 4} stroke={BRASS} strokeWidth="1.2" />
      ))}
      <circle cx="1140" cy={ly} r="3" fill={IVORY} />
      {STILL_NODES.map((n, i) =>
        n.kind === 'human' ? (
          <circle key={`n${i}`} cx={n.x} cy={n.y} r="7" fill={INK} stroke={IVORY} strokeWidth="1.6" />
        ) : (
          <rect key={`n${i}`} x={n.x - 5} y={n.y - 5} width="10" height="10" fill={BRASS} transform={`rotate(45 ${n.x} ${n.y})`} />
        ),
      )}
    </svg>
  );
}
