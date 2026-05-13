// ============================================================================
// Apple Game — mobile-first canvas game
// ============================================================================

// ---- DOM handles -----------------------------------------------------------

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D context unavailable");

const hud = {
  score:       document.getElementById("hud-score")       as HTMLElement,
  combo:       document.getElementById("hud-combo")       as HTMLElement,
  hearts:      document.getElementById("hud-hearts")      as HTMLElement,
  mute:        document.getElementById("hud-mute")        as HTMLButtonElement,
  fullscreen:  document.getElementById("hud-fullscreen")  as HTMLButtonElement,
  gameOver:    document.getElementById("game-over")       as HTMLElement,
  finalScore:  document.getElementById("final-score")     as HTMLElement,
  topScores:   document.getElementById("top-scores")      as HTMLElement,
  restart:     document.getElementById("restart-btn")     as HTMLButtonElement,
  clearScores: document.getElementById("clear-scores")    as HTMLButtonElement,
};

// ---- Constants -------------------------------------------------------------

const SCORES_KEY        = "franz-apple-game-scores";
const MUTED_KEY         = "franz-apple-game-muted";
const MAX_LIVES         = 3;
const MAX_MULTIPLIER    = 5;
const PARTICLE_COUNT    = 12;
const PARTICLE_LIFE_MS  = 600;
const PARTICLE_GRAVITY  = 380;
const SHAKE_DURATION_MS = 150;
const SHAKE_AMPLITUDE   = 4;
const WOBBLE_PERIOD_MS  = 440;
const WOBBLE_RADIANS    = (5 * Math.PI) / 180;

// ---- Types -----------------------------------------------------------------

type Particle = {
  x: number; y: number;
  vx: number; vy: number;
  born: number;
  color: string;
};
type ScoreRecord = { score: number; ts: number };

// ---- Mutable state ---------------------------------------------------------

let viewportW = 0;
let viewportH = 0;
let appleSize = 96;
let appleX = 0;
let appleY = 0;
let appleAlive = false;
let particles: Particle[] = [];
let shakeStart = -Infinity;

let score = 0;
let lives = MAX_LIVES;
let multiplier = 1;
let moveIntervalMs = 1200;
let difficultyFactor = 0;
let lastMoveAt = 0;
let gameOver = true;

let muted = localStorage.getItem(MUTED_KEY) === "1";
let audioCtx: AudioContext | null = null;

// ---- Audio (Web Audio API) -------------------------------------------------

function getAudio(): AudioContext | null {
  if (muted) return null;
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function tone(
  freq: number,
  durationMs: number,
  type: OscillatorType = "sine",
  endFreq?: number,
): void {
  const ac = getAudio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime;
  const t1 = t0 + durationMs / 1000;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t1);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t1);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t1 + 0.02);
}

const sfx = {
  hit:      () => tone(880, 200, "sine"),
  miss:     () => tone(220, 150, "square"),
  gameOver: () => tone(523, 500, "sine", 262),
};

// ---- Asset loading ---------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src     = src;
  });
}

// ---- Viewport / canvas sizing ----------------------------------------------

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  viewportW = window.innerWidth;
  viewportH = window.innerHeight;
  canvas.width  = Math.floor(viewportW * dpr);
  canvas.height = Math.floor(viewportH * dpr);
  canvas.style.width  = `${viewportW}px`;
  canvas.style.height = `${viewportH}px`;
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  appleSize = Math.max(60, Math.min(140, Math.min(viewportW, viewportH) * 0.14));
}

// ---- Difficulty ramp -------------------------------------------------------

function applyDifficulty(): void {
  moveIntervalMs = 1200;
  difficultyFactor = 0;
}

// ---- Apple spawning --------------------------------------------------------

function moveApple(): void {
  const margin    = appleSize / 2 + 12;
  const topMargin = Math.max(margin, 110); // keep clear of HUD
  appleX = margin    + Math.random() * Math.max(1, viewportW - margin * 2);
  appleY = topMargin + Math.random() * Math.max(1, viewportH - topMargin - margin);
  appleAlive = true;
}

// ---- Particles -------------------------------------------------------------

function spawnParticles(x: number, y: number, now: number): void {
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + Math.random() * 0.4;
    const speed = 140 + Math.random() * 200;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 60,
      born: now,
      color: i % 2 === 0 ? "#e53935" : "#ffd54f",
    });
  }
}

// ---- HUD updates -----------------------------------------------------------

function bumpCombo(): void {
  hud.combo.classList.remove("bump");
  void hud.combo.offsetWidth; // force reflow so the animation re-fires
  hud.combo.classList.add("bump");
}

function updateHUD(): void {
  hud.score.textContent  = String(score);
  hud.combo.textContent  = `×${multiplier}`;
  hud.hearts.textContent = "❤".repeat(lives) + "♡".repeat(MAX_LIVES - lives);
  hud.mute.textContent   = muted ? "🔇" : "🔊";
}

// ---- Leaderboard (localStorage) --------------------------------------------

function readScores(): ScoreRecord[] {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ScoreRecord =>
        typeof r === "object" && r !== null &&
        typeof (r as ScoreRecord).score === "number" &&
        typeof (r as ScoreRecord).ts === "number",
    );
  } catch { return []; }
}

function saveScore(s: number): void {
  try {
    const all = readScores();
    all.push({ score: s, ts: Date.now() });
    all.sort((a, b) => b.ts - a.ts);
    localStorage.setItem(SCORES_KEY, JSON.stringify(all.slice(0, 10)));
  } catch { /* localStorage unavailable */ }
}

function topThree(): ScoreRecord[] {
  return [...readScores()].sort((a, b) => b.score - a.score).slice(0, 3);
}

// ---- Game logic ------------------------------------------------------------

function handleHit(now: number): void {
  multiplier = Math.min(MAX_MULTIPLIER, multiplier + 1);
  score += 10 * multiplier * (1 + difficultyFactor);
  spawnParticles(appleX, appleY, now);
  sfx.hit();
  appleAlive = false;
  applyDifficulty();
  moveApple();
  lastMoveAt = now;
  bumpCombo();
  updateHUD();
}

function handleMiss(now: number): void {
  multiplier = 1;
  lives -= 1;
  shakeStart = now;
  sfx.miss();
  updateHUD();
  if (lives <= 0) endGame();
}

function endGame(): void {
  gameOver = true;
  appleAlive = false;
  saveScore(score);
  sfx.gameOver();
  hud.finalScore.textContent = String(score);
  const top = topThree();
  hud.topScores.innerHTML = top.length
    ? top.map((s, i) => `<li>#${i + 1} — <strong>${s.score}</strong></li>`).join("")
    : `<li>#1 — <strong>${score}</strong></li>`;
  hud.gameOver.classList.remove("hidden");
}

function startGame(): void {
  score = 0;
  lives = MAX_LIVES;
  multiplier = 1;
  particles = [];
  gameOver = false;
  applyDifficulty();
  hud.gameOver.classList.add("hidden");
  moveApple();
  lastMoveAt = performance.now();
  updateHUD();
}

// ---- Input (touch + mouse via Pointer Events) ------------------------------

function onPointerDown(event: PointerEvent): void {
  getAudio(); // unlock audio on first user gesture
  if (gameOver || !appleAlive) return;
  const dx = event.clientX - appleX;
  const dy = event.clientY - appleY;
  const r  = appleSize / 2;
  if (dx * dx + dy * dy <= r * r) {
    handleHit(performance.now());
  }
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("resize",            resizeCanvas);
window.addEventListener("orientationchange", resizeCanvas);

hud.mute.addEventListener("click", () => {
  muted = !muted;
  localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  if (muted && audioCtx) void audioCtx.suspend();
  updateHUD();
});

hud.fullscreen.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => { /* user declined */ });
  } else {
    document.exitFullscreen?.().catch(() => { /* ignore */ });
  }
});

hud.restart.addEventListener("click", () => {
  getAudio();
  startGame();
});

hud.clearScores.addEventListener("click", () => {
  localStorage.removeItem(SCORES_KEY);
  hud.topScores.innerHTML = "";
});

// ---- Render loop -----------------------------------------------------------

function renderFrame(now: number, bg: HTMLImageElement, apple: HTMLImageElement): void {
  // Tick: did the player run out of time on the current apple?
  if (!gameOver && now - lastMoveAt >= moveIntervalMs) {
    if (appleAlive) handleMiss(now);
    if (!gameOver) {
      moveApple();
      lastMoveAt = now;
    }
  }

  // Particle physics
  const dt = 1 / 60;
  particles = particles.filter((p) => now - p.born < PARTICLE_LIFE_MS);
  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += PARTICLE_GRAVITY * dt;
  }

  // Render with optional screen-shake transform
  ctx!.save();
  let sx = 0, sy = 0;
  const sinceShake = now - shakeStart;
  if (sinceShake < SHAKE_DURATION_MS) {
    const remaining = 1 - sinceShake / SHAKE_DURATION_MS;
    const amp = SHAKE_AMPLITUDE * remaining;
    sx = (Math.random() - 0.5) * amp * 2;
    sy = (Math.random() - 0.5) * amp * 2;
  }
  ctx!.translate(sx, sy);

  // Background — fill viewport
  ctx!.drawImage(bg, 0, 0, viewportW, viewportH);

  // Apple — idle wobble ±5° sine
  if (appleAlive && !gameOver) {
    const wobble = Math.sin((now * Math.PI * 2) / WOBBLE_PERIOD_MS) * WOBBLE_RADIANS;
    ctx!.save();
    ctx!.translate(appleX, appleY);
    ctx!.rotate(wobble);
    ctx!.drawImage(apple, -appleSize / 2, -appleSize / 2, appleSize, appleSize);
    ctx!.restore();
  }

  // Particles — fade with age
  for (const p of particles) {
    const age = (now - p.born) / PARTICLE_LIFE_MS;
    ctx!.globalAlpha = Math.max(0, 1 - age);
    ctx!.fillStyle = p.color;
    ctx!.beginPath();
    ctx!.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx!.fill();
  }
  ctx!.globalAlpha = 1;
  ctx!.restore();

  requestAnimationFrame((t) => renderFrame(t, bg, apple));
}

// ---- Bootstrap -------------------------------------------------------------

async function main(): Promise<void> {
  resizeCanvas();
  updateHUD();
  const [bg, apple] = await Promise.all([
    loadImage("/bg.png"),
    loadImage("/apple.png"),
  ]);
  startGame();
  requestAnimationFrame((t) => renderFrame(t, bg, apple));
}

void main();
