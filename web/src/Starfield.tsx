import { useEffect, useRef } from "react";

// Night Sky 테마의 배경 별밭. 세 겹으로 멀수록 작고 느리게 흐르고, 가끔 유성이 지나간다.
// 상시 띄워 두는 화면이라 30fps로 제한하고, 탭이 가려지면 멈춘다.
const TINTS = ["255,255,255", "255,236,200", "200,215,255", "220,200,255"];
const LAYERS = [
  { density: 5, r: [0.3, 0.8], speed: 2, alpha: 0.6 },
  { density: 1.6, r: [0.6, 1.2], speed: 5, alpha: 0.8 },
  { density: 0.3, r: [1.0, 1.9], speed: 9, alpha: 1 },
];
const FRAME_MS = 1000 / 30;

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  freq: number;
  tint: string;
}

export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let layers: { stars: Star[]; speed: number; alpha: number }[] = [];
    let meteor: { x: number; y: number; life: number } | null = null;
    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;

    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth;
      h = innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const area = (w * h) / 1e4;
      layers = LAYERS.map((L) => ({
        speed: L.speed,
        alpha: L.alpha,
        stars: Array.from({ length: Math.round(area * L.density) }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          r: L.r[0] + Math.random() * (L.r[1] - L.r[0]),
          phase: Math.random() * Math.PI * 2,
          freq: 0.6 + Math.random() * 1.6,
          tint: TINTS[Math.floor(Math.random() * TINTS.length)],
        })),
      }));
    };

    const draw = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      g.clearRect(0, 0, w, h);
      for (const L of layers)
        for (const s of L.stars) {
          if (!still) {
            s.x -= L.speed * dt;
            s.y += L.speed * 0.25 * dt;
            if (s.x < -2) s.x = w + 2;
            if (s.y > h + 2) s.y = -2;
          }
          const twinkle = still ? 0.8 : 0.55 + 0.45 * Math.sin((now / 1000) * s.freq + s.phase);
          g.globalAlpha = L.alpha * twinkle;
          g.fillStyle = `rgb(${s.tint})`;
          g.beginPath();
          g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          g.fill();
          if (s.r > 1.4) {
            g.globalAlpha = L.alpha * twinkle * 0.18;
            g.beginPath();
            g.arc(s.x, s.y, s.r * 3.2, 0, Math.PI * 2);
            g.fill();
          }
        }
      if (!still) {
        if (!meteor && Math.random() < dt / 12) meteor = { x: w * (0.2 + Math.random() * 0.8), y: h * Math.random() * 0.4, life: 0 };
        if (meteor) {
          meteor.life += dt;
          const k = meteor.life / 0.9;
          const x = meteor.x - k * 420;
          const y = meteor.y + k * 180;
          const grad = g.createLinearGradient(x, y, x + 140, y - 60);
          grad.addColorStop(0, "rgba(255,245,220,.9)");
          grad.addColorStop(1, "rgba(255,245,220,0)");
          g.globalAlpha = Math.sin(Math.PI * Math.min(1, k));
          g.strokeStyle = grad;
          g.lineWidth = 1.4;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 140, y - 60);
          g.stroke();
          if (k >= 1) meteor = null;
        }
      }
      g.globalAlpha = 1;
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;
      draw(now);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !still) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    resize();
    draw(performance.now());
    if (!still) raf = requestAnimationFrame(loop);
    addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden />;
}

// 오늘의 달. 2000-01-06 18:14 UTC 삭(新月)에서 삭망월로 월령을 구해 명암 경계를 그린다.
export function MoonIcon() {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14) / 864e5;
  const phase = ((((Date.now() / 864e5 - ref) % synodic) + synodic) % synodic) / synodic;
  const r = 10;
  const k = Math.cos(phase * 2 * Math.PI);
  const waxing = phase < 0.5;
  const lit = `M13,${13 - r} A${r},${r} 0 0 ${waxing ? 1 : 0} 13,${13 + r} A${Math.abs(k * r)},${r} 0 0 ${k > 0 === waxing ? 0 : 1} 13,${13 - r} Z`;
  return (
    <svg className="scope-icon moon-icon" viewBox="0 0 26 26" aria-hidden>
      <circle cx="13" cy="13" r={r} fill="#20264a" />
      <path d={lit} fill="#ffe9b8" />
    </svg>
  );
}
