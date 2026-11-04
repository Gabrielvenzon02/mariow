import { useEffect, useRef, useState, useCallback } from "react";
import { createLevel1, createLevel2, TILE, T, type LevelData } from "./game/levels";
import { sfx, startMusic, stopMusic, setMuted as setAudioMuted } from "./game/audio";

const VIEW_W = 960;
const VIEW_H = 480;
const GRAVITY = 0.55;
const MAX_FALL = 13;

type PlayerState = "small" | "big" | "fire";
type GamePhase = "title" | "intro" | "playing" | "paused" | "dead" | "complete" | "gameover" | "win";

interface Player {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  onGround: boolean; facing: 1 | -1;
  state: PlayerState;
  anim: number; coyote: number; jumpBuf: number;
  invuln: number; star: number; dead: boolean; deadVy: number;
  skid: boolean; crouch: boolean;
  flagMode: boolean;
}
interface Enemy {
  id: number; type: "goomba" | "koopa" | "piranha" | "beetle";
  x: number; y: number; w: number; h: number;
  vx: number; vy: number; dir: 1 | -1;
  alive: boolean; squashed: number; // timer
  shell: "none" | "still" | "moving";
  active: boolean; onGround: boolean;
  pipeX: number; pipeY: number; pTimer: number; pUp: number; // piranha offset
  anim: number;
}
interface Powerup {
  x: number; y: number; w: number; h: number;
  vx: number; vy: number; type: "mushroom" | "fire" | "star";
  alive: boolean; emerging: number; // >0 emerging from block
  dir: 1 | -1; onGround: boolean; anim: number;
}
interface Fireball { x: number; y: number; vx: number; vy: number; alive: boolean; anim: number; }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number; grav: number; }
interface Floater { x: number; y: number; text: string; life: number; color: string; }
interface CoinEnt { x: number; y: number; taken: boolean; phase: number; }

interface World {
  level: LevelData;
  tiles: number[][];
  player: Player;
  enemies: Enemy[];
  powerups: Powerup[];
  fireballs: Fireball[];
  particles: Particle[];
  floaters: Floater[];
  coins: CoinEnt[];
  cameraX: number;
  timeLeft: number;
  timeAcc: number;
  score: number; coinCount: number; lives: number;
  flagTouched: boolean; flagY: number; winStep: number; winTimer: number;
  bump: Map<string, number>;
  shake: number;
  deadTimer: number;
  invulnFlash: number;
  shootCooldown: number;
  enemyId: number;
  castleWalkX: number;
}

function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function isSolidTile(t: number) {
  return t === T.GROUND || t === T.BRICK || t === T.Q_COIN || t === T.Q_MUSHROOM || t === T.Q_FIRE || t === T.Q_STAR || t === T.USED || t === T.PIPE || t === T.STAIR || t === T.HARD;
}
function tileAt(w: World, tx: number, ty: number): number {
  if (tx < 0 || tx >= w.level.width) return T.HARD;
  if (ty < 0 || ty >= w.level.height) return T.EMPTY;
  return w.tiles[ty][tx];
}
function solidAt(w: World, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= w.level.width) return true;
  if (ty < 0) return false;
  if (ty >= w.level.height) return false;
  return isSolidTile(w.tiles[ty][tx]);
}

function makePlayer(sx: number, sy: number): Player {
  return {
    x: sx * TILE + 4, y: sy * TILE, w: 22, h: 28,
    vx: 0, vy: 0, onGround: false, facing: 1,
    state: "small", anim: 0, coyote: 0, jumpBuf: 0,
    invuln: 0, star: 0, dead: false, deadVy: 0,
    skid: false, crouch: false, flagMode: false,
  };
}

function loadWorld(levelIndex: number, prev?: { score: number; coinCount: number; lives: number }): World {
  const level = levelIndex === 0 ? createLevel1() : createLevel2();
  const tiles = level.tiles.map(r => [...r]);
  const enemies: Enemy[] = level.enemies.map((e, i) => {
    const isPiranha = e.type === "piranha";
    const w = isPiranha ? 28 : 28;
    const h = e.type === "koopa" ? 36 : e.type === "piranha" ? 36 : 24;
    return {
      id: i, type: e.type,
      x: e.x * TILE + 2, y: e.y * TILE + (32 - h),
      w, h, vx: 0, vy: 0, dir: -1,
      alive: true, squashed: 0, shell: "none" as const,
      active: false, onGround: false,
      pipeX: e.pipeX ?? e.x, pipeY: e.pipeY ?? e.y,
      pTimer: Math.random() * 3, pUp: 0, anim: Math.random() * 10,
    };
  });
  return {
    level, tiles,
    player: makePlayer(level.playerStart.x, level.playerStart.y),
    enemies, powerups: [], fireballs: [], particles: [], floaters: [],
    coins: level.coins.map(c => ({ x: c.x * TILE + 8, y: c.y * TILE + 6, taken: false, phase: Math.random() * Math.PI * 2 })),
    cameraX: 0,
    timeLeft: level.time, timeAcc: 0,
    score: prev?.score ?? 0, coinCount: prev?.coinCount ?? 0, lives: prev?.lives ?? 3,
    flagTouched: false, flagY: 2 * TILE, winStep: 0, winTimer: 0,
    bump: new Map(), shake: 0, deadTimer: 0, invulnFlash: 0,
    shootCooldown: 0, enemyId: enemies.length, castleWalkX: 0,
  };
}

function addScore(w: World, n: number, x: number, y: number, label?: string) {
  w.score += n;
  w.floaters.push({ x, y, text: label ?? `+${n}`, life: 1, color: "#fff" });
}
function burst(w: World, x: number, y: number, color: string, n = 8, speed = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = (0.5 + Math.random()) * speed;
    w.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 0.5 + Math.random() * 0.5, maxLife: 1, color, size: 3 + Math.random() * 4, grav: 0.25 });
  }
}
function brickDebris(w: World, tx: number, ty: number) {
  const x = tx * TILE, y = ty * TILE;
  const cols = ["#c84c0c", "#e86a2c", "#8a2f0a", "#f09050"];
  for (let i = 0; i < 4; i++) {
    w.particles.push({
      x: x + 4 + (i % 2) * 14, y: y + 4 + Math.floor(i / 2) * 14,
      vx: (i % 2 === 0 ? -1 : 1) * (1.5 + Math.random() * 2), vy: -6 - Math.random() * 3,
      life: 1.2, maxLife: 1.2, color: cols[i], size: 12, grav: 0.45,
    });
  }
  w.shake = 6;
}

// Tile collision move for entity (player/enemy/powerup)
function moveEntity(w: World, e: { x: number; y: number; w: number; h: number; vx: number; vy: number; onGround: boolean }, dt: number, isPlayer = false): { hitWall: boolean; hitHead: number[] | null; hitGround: boolean } {
  let hitWall = false;
  let hitHead: number[] | null = null;
  let hitGround = false;
  const step = dt * 60;

  // X axis
  e.x += e.vx * step;
  {
    const top = Math.floor(e.y / TILE), bot = Math.floor((e.y + e.h - 1) / TILE);
    if (e.vx > 0) {
      const tx = Math.floor((e.x + e.w) / TILE);
      for (let ty = top; ty <= bot; ty++) if (solidAt(w, tx, ty)) { e.x = tx * TILE - e.w - 0.01; hitWall = true; e.vx = 0; break; }
    } else if (e.vx < 0) {
      const tx = Math.floor(e.x / TILE);
      for (let ty = top; ty <= bot; ty++) if (solidAt(w, tx, ty)) { e.x = (tx + 1) * TILE + 0.01; hitWall = true; e.vx = 0; break; }
    }
  }
  // Y axis
  e.y += e.vy * step;
  e.onGround = false;
  {
    const left = Math.floor(e.x / TILE), right = Math.floor((e.x + e.w - 1) / TILE);
    if (e.vy > 0) {
      const ty = Math.floor((e.y + e.h) / TILE);
      for (let tx = left; tx <= right; tx++) if (solidAt(w, tx, ty)) { e.y = ty * TILE - e.h; hitGround = true; e.onGround = true; e.vy = 0; break; }
    } else if (e.vy < 0) {
      const ty = Math.floor(e.y / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (solidAt(w, tx, ty)) {
          e.y = (ty + 1) * TILE + 0.01;
          if (isPlayer) hitHead = [tx, ty];
          e.vy = 0;
          break;
        }
      }
    }
  }
  return { hitWall, hitHead, hitGround };
}

function growPlayer(w: World, toFire = false) {
  const p = w.player;
  if (p.state === "small") {
    p.state = toFire ? "fire" : "big";
    p.h = 42; p.y -= 14;
  } else if (toFire) {
    p.state = "fire";
  }
}
function shrinkPlayer(w: World) {
  const p = w.player;
  if (p.state !== "small") {
    p.state = "small"; p.h = 28; p.y += 14; p.invuln = 2.2;
  }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World>(loadWorld(0));
  const keysRef = useRef({ left: false, right: false, jump: false, run: false, shoot: false });
  const prevJumpRef = useRef(false);
  const prevShootRef = useRef(false);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(performance.now());
  const phaseRef = useRef<GamePhase>("title");
  const levelIndexRef = useRef(0);
  const introTimerRef = useRef(0);
  const mutedRef = useRef(false);
  const touchRef = useRef({ left: false, right: false, jump: false, run: false, shoot: false });

  const [phase, setPhase] = useState<GamePhase>("title");
  const [hud, setHud] = useState({ score: 0, coins: 0, lives: 3, time: 300, level: 0, worldName: "WORLD 1-1" });
  const [muted, setMutedState] = useState(false);
  const [highScore, setHighScore] = useState(() => {
    try { return Number(localStorage.getItem("mario-high") || 0); } catch { return 0; }
  });
  const [showTouch, setShowTouch] = useState(false);
  const [levelCompleteInfo, setLevelCompleteInfo] = useState({ score: 0, timeBonus: 0 });

  const setPhaseBoth = useCallback((p: GamePhase) => { phaseRef.current = p; setPhase(p); }, []);

  const syncHud = useCallback(() => {
    const w = worldRef.current;
    setHud(prev => {
      const next = { score: w.score, coins: w.coinCount, lives: w.lives, time: Math.max(0, Math.ceil(w.timeLeft)), level: levelIndexRef.current, worldName: w.level.name };
      if (prev.score === next.score && prev.coins === next.coins && prev.lives === next.lives && prev.time === next.time && prev.level === next.level) return prev;
      return next;
    });
  }, []);

  const startGame = useCallback((levelIdx: number, fresh = true) => {
    levelIndexRef.current = levelIdx;
    const prev = fresh ? undefined : { score: worldRef.current.score, coinCount: worldRef.current.coinCount, lives: worldRef.current.lives };
    // if continuing to next level keep score
    worldRef.current = loadWorld(levelIdx, prev);
    introTimerRef.current = 2.2;
    setPhaseBoth("intro");
    syncHud();
    try { acResume(); } catch {}
    startMusic();
  }, [setPhaseBoth, syncHud]);

  function acResume() {
    // ensure audio context resumes on user gesture via sfx call
    sfx.pause();
  }

  const toggleMute = useCallback(() => {
    const m = !mutedRef.current;
    mutedRef.current = m;
    setMutedState(m);
    setAudioMuted(m);
  }, []);

  const pauseGame = useCallback(() => {
    if (phaseRef.current === "playing") { setPhaseBoth("paused"); stopMusic(); sfx.pause(); }
    else if (phaseRef.current === "paused") { setPhaseBoth("playing"); startMusic(); }
  }, [setPhaseBoth]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.code;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(k)) e.preventDefault();
      if (k === "ArrowLeft" || k === "KeyA") keysRef.current.left = true;
      if (k === "ArrowRight" || k === "KeyD") keysRef.current.right = true;
      if (k === "ArrowUp" || k === "KeyW" || k === "Space") keysRef.current.jump = true;
      if (k === "ShiftLeft" || k === "ShiftRight" || k === "KeyL") keysRef.current.run = true;
      if (k === "KeyX" || k === "KeyK" || k === "ControlLeft") keysRef.current.shoot = true;
      if (k === "KeyP" || k === "Escape") pauseGame();
      if (k === "KeyM") toggleMute();
      if (k === "Enter") {
        if (phaseRef.current === "title" || phaseRef.current === "gameover" || phaseRef.current === "win") startGame(levelIndexRef.current, true);
        else if (phaseRef.current === "complete") {
          const next = levelIndexRef.current + 1;
          if (next < 2) startGame(next, false);
          else { setPhaseBoth("win"); sfx.win(); }
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.code;
      if (k === "ArrowLeft" || k === "KeyA") keysRef.current.left = false;
      if (k === "ArrowRight" || k === "KeyD") keysRef.current.right = false;
      if (k === "ArrowUp" || k === "KeyW" || k === "Space") keysRef.current.jump = false;
      if (k === "ShiftLeft" || k === "ShiftRight" || k === "KeyL") keysRef.current.run = false;
      if (k === "KeyX" || k === "KeyK" || k === "ControlLeft") keysRef.current.shoot = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [pauseGame, toggleMute, startGame, setPhaseBoth]);

  // Detect touch
  useEffect(() => {
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) setShowTouch(true);
  }, []);

  // Main loop
  useEffect(() => {
    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - lastRef.current) / 1000);
      lastRef.current = now;
      update(dt);
      render();
      syncHud();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getInput() {
    return {
      left: keysRef.current.left || touchRef.current.left,
      right: keysRef.current.right || touchRef.current.right,
      jump: keysRef.current.jump || touchRef.current.jump,
      run: keysRef.current.run || touchRef.current.run,
      shoot: keysRef.current.shoot || touchRef.current.shoot,
    };
  }

  function hurtPlayer(w: World) {
    const p = w.player;
    if (p.invuln > 0 || p.star > 0 || p.dead) return;
    if (p.state !== "small") {
      shrinkPlayer(w);
      sfx.powerdown();
      w.shake = 8;
      burst(w, p.x + p.w / 2, p.y + p.h / 2, "#ff4444", 10, 4);
    } else {
      killPlayer(w, false);
    }
  }
  function killPlayer(w: World, pit: boolean) {
    const p = w.player;
    if (p.dead) return;
    p.dead = true;
    p.deadVy = pit ? 0 : -9;
    p.vx = 0;
    w.deadTimer = 2.4;
    stopMusic();
    sfx.death();
    setPhaseBoth("dead");
  }
  function respawn(w: World) {
    w.lives -= 1;
    if (w.lives < 0) {
      setPhaseBoth("gameover");
      sfx.gameover();
      if (w.score > highScore) {
        setHighScore(w.score);
        try { localStorage.setItem("mario-high", String(w.score)); } catch {}
      }
      return;
    }
    const score = w.score, coins = w.coinCount, lives = w.lives;
    worldRef.current = loadWorld(levelIndexRef.current, { score, coinCount: coins, lives });
    introTimerRef.current = 1.6;
    setPhaseBoth("intro");
    startMusic();
  }

  function hitBlock(w: World, tx: number, ty: number) {
    const t = tileAt(w, tx, ty);
    const p = w.player;
    const key = `${tx},${ty}`;
    if (t === T.Q_COIN) {
      w.tiles[ty][tx] = T.USED;
      w.bump.set(key, 1);
      w.coinCount += 1;
      addScore(w, 200, tx * TILE + 16, ty * TILE - 10, "+200");
      sfx.coin();
      burst(w, tx * TILE + 16, ty * TILE, "#ffd700", 8, 2.5);
      if (w.coinCount >= 100) { w.coinCount -= 100; w.lives += 1; sfx.oneUp(); w.floaters.push({ x: p.x, y: p.y - 20, text: "1UP!", life: 1.2, color: "#00ff88" }); }
    } else if (t === T.Q_MUSHROOM || t === T.Q_FIRE || t === T.Q_STAR) {
      w.tiles[ty][tx] = T.USED;
      w.bump.set(key, 1);
      const type = t === T.Q_MUSHROOM ? "mushroom" : t === T.Q_FIRE ? "fire" : "star";
      w.powerups.push({
        x: tx * TILE + 4, y: ty * TILE - 24, w: 24, h: 24,
        vx: 0, vy: 0, type, alive: true, emerging: 0.6, dir: 1, onGround: false, anim: 0,
      });
      sfx.powerup();
    } else if (t === T.BRICK) {
      if (p.state !== "small") {
        w.tiles[ty][tx] = T.EMPTY;
        brickDebris(w, tx, ty);
        addScore(w, 50, tx * TILE + 16, ty * TILE, "+50");
        sfx.brick();
      } else {
        w.bump.set(key, 1);
        sfx.bump();
      }
    } else if (isSolidTile(t)) {
      w.bump.set(key, 1);
      sfx.bump();
    }
  }

  function update(dt: number) {
    const w = worldRef.current;
    const ph = phaseRef.current;
    const input = getInput();

    // Title: slow camera pan
    if (ph === "title") {
      w.cameraX = (w.cameraX + dt * 40) % (w.level.width * TILE - VIEW_W);
      // animate coins phase
      w.coins.forEach(c => c.phase += dt * 4);
      return;
    }
    if (ph === "intro") {
      introTimerRef.current -= dt;
      w.coins.forEach(c => c.phase += dt * 4);
      if (introTimerRef.current <= 0) setPhaseBoth("playing");
      return;
    }
    if (ph === "paused" || ph === "gameover" || ph === "win") return;

    if (ph === "dead") {
      const p = w.player;
      w.deadTimer -= dt;
      if (!p.deadVy || p.y < w.level.height * TILE) {
        p.vy += GRAVITY * dt * 60 * 0.6;
        p.y += p.vy * dt * 60;
      }
      if (w.deadTimer <= 0) respawn(w);
      return;
    }
    if (ph === "complete") {
      w.winTimer -= dt;
      const p = w.player;
      // walk to castle
      if (w.winStep === 1) {
        p.vx = 1.6; p.x += p.vx * dt * 60; p.anim += dt * 10;
        if (p.x >= w.level.castleX * TILE - 40) { w.winStep = 2; w.winTimer = 1.2; }
      } else if (w.winStep === 2) {
        // enter castle fade
        if (w.winTimer <= 0) {
          const next = levelIndexRef.current + 1;
          if (next < 2) startGame(next, false);
          else { setPhaseBoth("win"); sfx.win(); if (w.score > highScore) { setHighScore(w.score); try { localStorage.setItem("mario-high", String(w.score)); } catch {} } }
        }
      }
      updateParticles(w, dt);
      return;
    }

    // ---- PLAYING ----
    const p = w.player;
    const jumpPressed = input.jump && !prevJumpRef.current;
    const shootPressed = input.shoot && !prevShootRef.current;
    if (jumpPressed) p.jumpBuf = 0.12;
    else p.jumpBuf = Math.max(0, p.jumpBuf - dt);
    prevJumpRef.current = input.jump;
    prevShootRef.current = input.shoot;

    // Flag sequence
    if (w.flagTouched) {
      p.flagMode = true;
      p.vx = 0;
      // slide down
      if (w.winStep === 0) {
        p.y += 2.2 * dt * 60;
        w.flagY = p.y;
        const groundY = 13 * TILE - p.h;
        if (p.y >= groundY) { p.y = groundY; w.winStep = 1; w.winTimer = 0.4; sfx.flag(); }
      } else if (w.winStep === 1) {
        w.winTimer -= dt;
        if (w.winTimer <= 0) {
          p.facing = 1;
          // time bonus
          const bonus = Math.ceil(w.timeLeft) * 50;
          w.score += bonus;
          setLevelCompleteInfo({ score: w.score, timeBonus: bonus });
          setPhaseBoth("complete");
          w.winStep = 1;
          sfx.win();
        }
      }
      updateParticles(w, dt);
      updateCamera(w, dt);
      return;
    }

    // Timer
    w.timeAcc += dt;
    if (w.timeAcc >= 1) { w.timeAcc -= 1; w.timeLeft -= 1; if (w.timeLeft <= 0) { w.timeLeft = 0; killPlayer(w, false); return; } }

    // Player movement
    const running = input.run;
    const maxSpeed = running ? 5.4 : 3.1;
    const accel = p.onGround ? 0.55 : 0.35;
    const friction = p.onGround ? 0.5 : 0.08;

    if (input.left && !input.right) {
      p.facing = -1;
      p.vx = Math.max(-maxSpeed, p.vx - accel);
      p.skid = p.vx > 1.5;
    } else if (input.right && !input.left) {
      p.facing = 1;
      p.vx = Math.min(maxSpeed, p.vx + accel);
      p.skid = p.vx < -1.5;
    } else {
      if (Math.abs(p.vx) <= friction) p.vx = 0;
      else p.vx -= Math.sign(p.vx) * friction;
      p.skid = false;
    }

    // Jump
    if (p.jumpBuf > 0 && (p.onGround || p.coyote > 0)) {
      p.vy = p.state === "small" ? -12.2 : -12.8;
      p.onGround = false; p.coyote = 0; p.jumpBuf = 0;
      sfx.jump(p.state !== "small");
      burst(w, p.x + p.w / 2, p.y + p.h, "#ffffff", 4, 1.2);
    }
    // Variable jump height
    if (!input.jump && p.vy < -5) p.vy = -5;

    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt * 60);
    const wasGround = p.onGround;
    const res = moveEntity(w, p, dt, true);
    if (res.hitHead) hitBlock(w, res.hitHead[0], res.hitHead[1]);
    if (p.onGround) p.coyote = 0.1; else p.coyote = Math.max(0, p.coyote - dt);
    if (!wasGround && p.onGround) burst(w, p.x + p.w / 2, p.y + p.h, "#d9b48a", 3, 1);

    // Anim
    if (Math.abs(p.vx) > 0.3 && p.onGround) p.anim += dt * (Math.abs(p.vx) * 2.2);
    else if (!p.onGround) p.anim = 0;

    // Shoot
    w.shootCooldown = Math.max(0, w.shootCooldown - dt);
    if (shootPressed && p.state === "fire" && w.shootCooldown <= 0 && w.fireballs.filter(f => f.alive).length < 2) {
      w.fireballs.push({ x: p.x + p.w / 2 + p.facing * 14, y: p.y + 10, vx: p.facing * 7, vy: -1, alive: true, anim: 0 });
      w.shootCooldown = 0.35;
      sfx.shoot();
    }

    // Invuln / star timers
    if (p.invuln > 0) p.invuln -= dt;
    if (p.star > 0) { p.star -= dt; if (Math.random() < 0.3) burst(w, p.x + p.w / 2, p.y + p.h / 2, ["#ffd700", "#ff6bff", "#00e5ff"][Math.floor(Math.random() * 3)], 1, 1); }
    w.invulnFlash += dt;

    // Pit death
    if (p.y > w.level.height * TILE + 60) { killPlayer(w, true); return; }

    // Flag touch
    const flagPx = w.level.flagX * TILE;
    if (p.x + p.w >= flagPx && !w.flagTouched) {
      w.flagTouched = true;
      w.winStep = 0;
      p.vx = 0; p.vy = 0;
      p.x = flagPx - p.w - 2;
      // flag score based on height
      const hBonus = Math.max(0, Math.floor((13 * TILE - p.y) / TILE)) * 100;
      w.score += hBonus + 1000;
      w.floaters.push({ x: flagPx, y: p.y - 30, text: `+${hBonus + 1000}`, life: 1.4, color: "#ffd700" });
      stopMusic();
      sfx.flag();
    }

    // Coins
    w.coins.forEach(c => {
      c.phase += dt * 5;
      if (!c.taken && overlap(p, { x: c.x - 6, y: c.y - 6, w: 20, h: 20 })) {
        c.taken = true;
        w.coinCount += 1;
        addScore(w, 200, c.x, c.y - 10);
        sfx.coin();
        burst(w, c.x + 8, c.y + 8, "#ffd700", 6, 2);
        if (w.coinCount >= 100) { w.coinCount -= 100; w.lives += 1; sfx.oneUp(); w.floaters.push({ x: p.x, y: p.y - 24, text: "1UP!", life: 1.2, color: "#00ff88" }); }
      }
    });

    // Powerups
    w.powerups.forEach(pu => {
      if (!pu.alive) return;
      pu.anim += dt * 6;
      if (pu.emerging > 0) {
        pu.emerging -= dt;
        pu.y -= 28 * dt;
        if (pu.emerging <= 0) { pu.vx = pu.dir * 1.2; }
        return;
      }
      if (pu.type === "fire") {
        // bob in place, no gravity after emerge (sit on ground)
        pu.vy = Math.min(8, pu.vy + GRAVITY * dt * 60);
        const r = moveEntity(w, pu, dt);
        if (r.hitWall) pu.dir = (pu.dir * -1) as 1 | -1;
        pu.vx = 0;
      } else {
        pu.vy = Math.min(MAX_FALL, pu.vy + GRAVITY * dt * 60);
        const speed = pu.type === "star" ? 2.2 : 1.2;
        pu.vx = pu.dir * speed;
        const r = moveEntity(w, pu, dt);
        if (r.hitWall) pu.dir = (pu.dir * -1) as 1 | -1;
        if (pu.type === "star" && r.hitGround) pu.vy = -7;
      }
      if (overlap(p, pu)) {
        pu.alive = false;
        if (pu.type === "mushroom") {
          if (p.state === "small") growPlayer(w, false);
          else addScore(w, 1000, pu.x, pu.y, "+1000");
          sfx.powerup();
        } else if (pu.type === "fire") {
          growPlayer(w, true);
          sfx.powerup();
        } else if (pu.type === "star") {
          p.star = 9;
          sfx.powerup();
        }
        addScore(w, 1000, pu.x, pu.y - 10, "+1000");
        burst(w, pu.x + 12, pu.y + 12, "#ffffff", 10, 3);
      }
    });
    w.powerups = w.powerups.filter(x => x.alive && x.y < w.level.height * TILE + 100);

    // Fireballs
    w.fireballs.forEach(f => {
      if (!f.alive) return;
      f.anim += dt * 12;
      f.vy = Math.min(8, f.vy + 0.25 * dt * 60);
      f.x += f.vx * dt * 60;
      f.y += f.vy * dt * 60;
      // tile collision
      const tx = Math.floor((f.x + 6) / TILE), ty = Math.floor((f.y + 6) / TILE);
      if (solidAt(w, tx, ty)) {
        // bounce if hitting ground from above
        if (f.vy > 0) { f.y = ty * TILE - 12; f.vy = -4.5; }
        else { f.alive = false; burst(w, f.x, f.y, "#ff8c00", 6, 2); }
      }
      if (f.y > w.level.height * TILE) f.alive = false;
      // hit enemies
      w.enemies.forEach(e => {
        if (!e.alive || e.squashed > 0) return;
        if (overlap({ x: f.x, y: f.y, w: 12, h: 12 }, e)) {
          f.alive = false;
          killEnemy(w, e, false);
        }
      });
    });
    w.fireballs = w.fireballs.filter(f => f.alive);

    // Enemies
    w.enemies.forEach(e => {
      if (!e.alive) return;
      if (e.squashed > 0) { e.squashed -= dt; if (e.squashed <= 0) e.alive = false; return; }
      e.anim += dt * 6;
      // activation
      if (!e.active) {
        if (e.x < w.cameraX + VIEW_W + 80 && e.x + e.w > w.cameraX - 80) e.active = true;
        else return;
      }
      if (e.type === "piranha") {
        e.pTimer += dt;
        // cycle: 0-2 hidden, 2-3.5 up, 3.5-4.5 down
        const cyc = e.pTimer % 5;
        const target = cyc < 2 ? 0 : cyc < 3.5 ? 1 : cyc < 4.5 ? Math.max(0, 1 - (cyc - 3.5)) : 0;
        e.pUp += (target - e.pUp) * dt * 6;
        e.x = e.pipeX * TILE + 2;
        e.y = (e.pipeY + 1) * TILE - 36 - e.pUp * 36 + 8;
        // don't hurt when hidden
        if (e.pUp < 0.4) return;
      } else {
        // gravity + patrol
        const speed = e.shell === "moving" ? 5.5 : e.type === "beetle" ? 1.1 : e.type === "koopa" ? 0.7 : 0.85;
        e.vx = e.dir * speed;
        e.vy = Math.min(MAX_FALL, e.vy + GRAVITY * dt * 60);
        // shell still: no move
        if (e.shell === "still") e.vx = 0;
        const r = moveEntity(w, e, dt);
        if (r.hitWall) e.dir = (e.dir * -1) as 1 | -1;
        if (e.y > w.level.height * TILE + 80) { e.alive = false; return; }
        // shell moving kills enemies
        if (e.shell === "moving") {
          w.enemies.forEach(o => {
            if (o === e || !o.alive || o.squashed > 0) return;
            if (overlap(e, o)) killEnemy(w, o, true);
          });
        }
      }

      // Player collision
      if (!overlap(p, e)) return;
      // Star kills
      if (p.star > 0) { killEnemy(w, e, true); return; }
      // Stomp check
      const stomping = p.vy > 1 && (p.y + p.h - e.y) < 18;
      if (stomping) {
        if (e.type === "koopa" && e.shell === "none") {
          e.shell = "still"; e.h = 20; e.y += 16; e.vx = 0;
          p.vy = input.jump ? -11 : -8;
          sfx.stomp(); addScore(w, 100, e.x, e.y, "+100");
          burst(w, e.x + 14, e.y, "#ffffff", 5, 2);
        } else if (e.type === "koopa" && e.shell === "still") {
          e.shell = "moving"; e.dir = p.facing; e.h = 20;
          p.vy = -7; sfx.kick(); addScore(w, 100, e.x, e.y, "+100");
        } else if (e.type === "koopa" && e.shell === "moving") {
          e.shell = "still"; e.vx = 0;
          p.vy = input.jump ? -11 : -8; sfx.stomp();
        } else {
          killEnemy(w, e, false);
          p.vy = input.jump ? -11 : -8;
        }
      } else {
        // side contact
        if (e.type === "koopa" && e.shell === "still") {
          e.shell = "moving"; e.dir = p.x < e.x ? 1 : -1; sfx.kick();
        } else if (e.type === "koopa" && e.shell === "moving") {
          hurtPlayer(w);
        } else {
          hurtPlayer(w);
        }
      }
    });

    updateParticles(w, dt);
    updateCamera(w, dt);

    // bump anim decay
    w.bump.forEach((v, k) => { const nv = v - dt * 4; if (nv <= 0) w.bump.delete(k); else w.bump.set(k, nv); });
    if (w.shake > 0) w.shake = Math.max(0, w.shake - dt * 20);
  }

  function killEnemy(w: World, e: Enemy, flip: boolean) {
    if (e.type === "koopa" && e.shell === "none" && !flip) {
      // shouldn't happen, but treat as shell
    }
    e.squashed = 0.5;
    e.alive = true; // will die after timer
    // mark dead after squash: set a flag via squashed; alive stays until timer ends in update
    // For flip kills (fireball/shell/star), make them flip: use squashed longer + particles
    if (flip) {
      e.squashed = 0.6;
      burst(w, e.x + 14, e.y + 10, "#ffcc00", 10, 3);
      addScore(w, 200, e.x, e.y, "+200");
      sfx.stomp();
    } else {
      addScore(w, 100, e.x, e.y, "+100");
      sfx.stomp();
      burst(w, e.x + 14, e.y + 12, "#ffffff", 6, 2);
    }
    // Actually remove immediately for flip, squash for stomp
    if (flip) e.alive = false;
  }

  function updateParticles(w: World, dt: number) {
    w.particles.forEach(pt => {
      pt.life -= dt;
      pt.vy += pt.grav * dt * 60;
      pt.x += pt.vx * dt * 60;
      pt.y += pt.vy * dt * 60;
    });
    w.particles = w.particles.filter(p => p.life > 0);
    w.floaters.forEach(f => { f.life -= dt; f.y -= 30 * dt; });
    w.floaters = w.floaters.filter(f => f.life > 0);
  }
  function updateCamera(w: World, dt: number) {
    const target = clamp(w.player.x - VIEW_W * 0.38, 0, w.level.width * TILE - VIEW_W);
    w.cameraX += (target - w.cameraX) * Math.min(1, dt * 8);
  }

  // ---------- RENDER ----------
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = worldRef.current;
    const camX = w.cameraX + (w.shake > 0 ? (Math.random() - 0.5) * w.shake : 0);
    const theme = w.level.theme;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    if (theme === "day") { sky.addColorStop(0, "#5c94fc"); sky.addColorStop(0.6, "#7ec8ff"); sky.addColorStop(1, "#aee6ff"); }
    else if (theme === "dusk") { sky.addColorStop(0, "#2b1b5e"); sky.addColorStop(0.5, "#7b2d8b"); sky.addColorStop(1, "#ff8c5a"); }
    else { sky.addColorStop(0, "#0a0a2e"); sky.addColorStop(1, "#1a1a4a"); }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // Sun / moon
    if (theme === "day") {
      ctx.fillStyle = "#fff3a0";
      ctx.beginPath(); ctx.arc(820 - (camX * 0.02 % 100), 70, 28, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,243,160,0.25)";
      ctx.beginPath(); ctx.arc(820 - (camX * 0.02 % 100), 70, 44, 0, Math.PI * 2); ctx.fill();
    } else if (theme === "dusk") {
      ctx.fillStyle = "#ffd9a0";
      ctx.beginPath(); ctx.arc(780, 90, 30, 0, Math.PI * 2); ctx.fill();
    }

    // Clouds parallax
    ctx.fillStyle = theme === "dusk" ? "rgba(255,180,180,0.5)" : "rgba(255,255,255,0.9)";
    for (let i = 0; i < 14; i++) {
      const cx = ((i * 340 - camX * 0.3) % (VIEW_W + 300) + VIEW_W + 300) % (VIEW_W + 300) - 150;
      const cy = 40 + (i % 4) * 36;
      drawCloud(ctx, cx, cy, 1 + (i % 3) * 0.3);
    }
    // Hills parallax
    ctx.fillStyle = theme === "dusk" ? "rgba(60,30,90,0.55)" : "rgba(0,168,0,0.35)";
    for (let i = 0; i < 10; i++) {
      const hx = ((i * 420 - camX * 0.5) % (VIEW_W + 500) + VIEW_W + 500) % (VIEW_W + 500) - 250;
      ctx.beginPath();
      ctx.moveTo(hx, 416);
      ctx.quadraticCurveTo(hx + 110, 300, hx + 220, 416);
      ctx.closePath(); ctx.fill();
    }
    // Bushes
    ctx.fillStyle = theme === "dusk" ? "rgba(80,40,110,0.6)" : "rgba(0,200,80,0.5)";
    for (let i = 0; i < 12; i++) {
      const bx = ((i * 300 - camX * 0.7) % (VIEW_W + 300) + VIEW_W + 300) % (VIEW_W + 300) - 150;
      ctx.beginPath(); ctx.arc(bx, 416, 26, Math.PI, 0); ctx.arc(bx + 30, 416, 20, Math.PI, 0); ctx.fill();
    }

    // Tiles
    const startTx = Math.max(0, Math.floor(camX / TILE) - 1);
    const endTx = Math.min(w.level.width - 1, Math.ceil((camX + VIEW_W) / TILE) + 1);
    for (let ty = 0; ty < w.level.height; ty++) {
      for (let tx = startTx; tx <= endTx; tx++) {
        const t = w.tiles[ty][tx];
        if (t === T.EMPTY) continue;
        const sx = tx * TILE - camX;
        let sy = ty * TILE;
        const bumpV = w.bump.get(`${tx},${ty}`);
        if (bumpV) sy -= Math.sin(bumpV * Math.PI) * 8;
        drawTile(ctx, t, sx, sy, tx, ty, w);
      }
    }

    // Flagpole
    drawFlag(ctx, w, camX);

    // Castle
    drawCastle(ctx, w, camX);

    // Coins
    w.coins.forEach(c => {
      if (c.taken) return;
      const sx = c.x - camX, sy = c.y + Math.sin(c.phase) * 3;
      if (sx < -40 || sx > VIEW_W + 40) return;
      const sq = Math.abs(Math.cos(c.phase * 0.7));
      ctx.save();
      ctx.translate(sx + 8, sy + 8);
      ctx.scale(Math.max(0.15, sq), 1);
      ctx.fillStyle = "#ffd700";
      ctx.strokeStyle = "#b8860b";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff2a0";
      ctx.beginPath(); ctx.ellipse(-2, -3, 3, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });

    // Powerups
    w.powerups.forEach(pu => {
      if (!pu.alive) return;
      drawPowerup(ctx, pu, camX);
    });

    // Enemies
    w.enemies.forEach(e => {
      if (!e.alive) return;
      const sx = e.x - camX;
      if (sx < -60 || sx > VIEW_W + 60) return;
      drawEnemy(ctx, e, sx);
    });

    // Fireballs
    w.fireballs.forEach(f => {
      const sx = f.x - camX;
      ctx.fillStyle = "#ff6a00";
      ctx.beginPath(); ctx.arc(sx + 6, f.y + 6, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd23f";
      ctx.beginPath(); ctx.arc(sx + 6, f.y + 6, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(sx + 4, f.y + 4, 2, 0, Math.PI * 2); ctx.fill();
    });

    // Player
    if (!(w.player.dead && w.player.y > w.level.height * TILE)) {
      // invuln flash
      const flash = w.player.invuln > 0 && Math.floor(w.invulnFlash * 12) % 2 === 0;
      if (!flash) drawPlayer(ctx, w, camX);
    }

    // Particles
    w.particles.forEach(pt => {
      const a = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - camX, pt.y, pt.size, pt.size);
      ctx.globalAlpha = 1;
    });

    // Floaters
    ctx.textAlign = "center";
    w.floaters.forEach(f => {
      ctx.globalAlpha = clamp(f.life, 0, 1);
      ctx.font = "bold 13px 'Press Start 2P', monospace";
      ctx.fillStyle = "#000";
      ctx.fillText(f.text, f.x - camX + 2, f.y + 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x - camX, f.y);
      ctx.globalAlpha = 1;
    });

    // Vignette / scanlines subtle
    ctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let y = 0; y < VIEW_H; y += 4) ctx.fillRect(0, y, VIEW_W, 1);
  }

  function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
    ctx.beginPath();
    ctx.arc(x, y, 16 * s, 0, Math.PI * 2);
    ctx.arc(x + 20 * s, y - 6 * s, 20 * s, 0, Math.PI * 2);
    ctx.arc(x + 44 * s, y, 16 * s, 0, Math.PI * 2);
    ctx.arc(x + 22 * s, y + 6 * s, 18 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTile(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, tx: number, ty: number, w: World) {
    const S = TILE;
    if (t === T.GROUND) {
      const isTop = !isSolidTile(tileAt(w, tx, ty - 1));
      ctx.fillStyle = "#c84c0c";
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = "#e86a2c";
      ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      // speckles
      ctx.fillStyle = "#8a2f0a";
      ctx.fillRect(x + 6, y + 10, 4, 4); ctx.fillRect(x + 20, y + 18, 4, 4); ctx.fillRect(x + 10, y + 24, 4, 4);
      if (isTop) {
        ctx.fillStyle = "#00a800";
        ctx.fillRect(x, y, S, 10);
        ctx.fillStyle = "#3ddc3d";
        ctx.fillRect(x, y, S, 5);
        ctx.fillStyle = "#007800";
        for (let i = 0; i < 4; i++) ctx.fillRect(x + 4 + i * 8, y + 8, 3, 4);
      }
    } else if (t === T.BRICK) {
      ctx.fillStyle = "#c84c0c"; ctx.fillRect(x, y, S, S);
      ctx.fillStyle = "#e86a2c"; ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
      ctx.strokeStyle = "#7a2a08"; ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
      ctx.beginPath();
      ctx.moveTo(x, y + 10); ctx.lineTo(x + S, y + 10);
      ctx.moveTo(x, y + 21); ctx.lineTo(x + S, y + 21);
      ctx.moveTo(x + 16, y); ctx.lineTo(x + 16, y + 10);
      ctx.moveTo(x + 8, y + 10); ctx.lineTo(x + 8, y + 21);
      ctx.moveTo(x + 24, y + 10); ctx.lineTo(x + 24, y + 21);
      ctx.moveTo(x + 16, y + 21); ctx.lineTo(x + 16, y + S);
      ctx.stroke();
    } else if (t === T.Q_COIN || t === T.Q_MUSHROOM || t === T.Q_FIRE || t === T.Q_STAR) {
      const pulse = 0.85 + Math.sin(performance.now() / 300 + tx) * 0.15;
      ctx.fillStyle = "#f8b800"; ctx.fillRect(x, y, S, S);
      ctx.fillStyle = "#ffd23f"; ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      ctx.strokeStyle = "#7a4a00"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
      ctx.fillStyle = "#7a4a00";
      [[4, 4], [S - 8, 4], [4, S - 8], [S - 8, S - 8]].forEach(([dx, dy]) => { ctx.beginPath(); ctx.arc(x + dx + 2, y + dy + 2, 2, 0, Math.PI * 2); ctx.fill(); });
      ctx.font = `bold ${Math.floor(18 * pulse)}px 'Press Start 2P', monospace`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText("?", x + S / 2 + 1, y + S / 2 + 2);
      ctx.fillStyle = "#c84c0c";
      ctx.fillText("?", x + S / 2, y + S / 2 + 1);
      ctx.textBaseline = "alphabetic";
    } else if (t === T.USED) {
      ctx.fillStyle = "#c84c0c"; ctx.fillRect(x, y, S, S);
      ctx.fillStyle = "#e86a2c"; ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      ctx.strokeStyle = "#7a2a08"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
      ctx.fillStyle = "#7a2a08";
      [[6, 6], [S - 10, 6], [6, S - 10], [S - 10, S - 10]].forEach(([dx, dy]) => ctx.fillRect(x + dx, y + dy, 4, 4));
    } else if (t === T.PIPE) {
      const above = tileAt(w, tx, ty - 1);
      const isTop = above !== T.PIPE;
      const left = tileAt(w, tx - 1, ty);
      const isLeft = left !== T.PIPE;
      ctx.fillStyle = "#00a800";
      ctx.fillRect(x, y, S, S);
      ctx.fillStyle = "#3ddc3d";
      if (isLeft) ctx.fillRect(x, y, 10, S);
      else ctx.fillRect(x + 4, y, 8, S);
      ctx.fillStyle = "#007800";
      if (!isLeft) ctx.fillRect(x + S - 6, y, 6, S);
      ctx.strokeStyle = "#004d00"; ctx.lineWidth = 2; ctx.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
      if (isTop) {
        ctx.fillStyle = "#00c800"; ctx.fillRect(x - 2, y, S + 4, 12);
        ctx.fillStyle = "#3ddc3d"; ctx.fillRect(x - 2, y, S + 4, 5);
        ctx.strokeStyle = "#004d00"; ctx.strokeRect(x - 1.5, y + 0.5, S + 3, 11);
      }
    } else if (t === T.STAIR || t === T.HARD) {
      ctx.fillStyle = "#f8b800"; ctx.fillRect(x, y, S, S);
      ctx.fillStyle = "#ffd23f"; ctx.fillRect(x + 2, y + 2, S - 4, S - 4);
      ctx.strokeStyle = "#7a4a00"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, S - 2, S - 2);
      ctx.fillStyle = "#c84c0c";
      ctx.fillRect(x + 6, y + 6, 6, 6); ctx.fillRect(x + 20, y + 6, 6, 6);
      ctx.fillRect(x + 6, y + 20, 6, 6); ctx.fillRect(x + 20, y + 20, 6, 6);
    } else if (t === T.FLAG) {
      // pole drawn separately; skip tile
    }
  }

  function drawFlag(ctx: CanvasRenderingContext2D, w: World, camX: number) {
    const fx = w.level.flagX * TILE - camX;
    if (fx < -60 || fx > VIEW_W + 60) return;
    const topY = 2 * TILE, botY = 13 * TILE;
    ctx.fillStyle = "#00a800";
    ctx.fillRect(fx + 14, topY, 4, botY - topY);
    ctx.fillStyle = "#ffd700";
    ctx.beginPath(); ctx.arc(fx + 16, topY - 4, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#7a4a00"; ctx.stroke();
    // flag triangle position
    let fy = topY + 10;
    if (w.flagTouched) fy = Math.min(botY - 30, w.flagY + 10);
    ctx.fillStyle = "#00a800";
    ctx.beginPath();
    ctx.moveTo(fx + 16, fy);
    ctx.lineTo(fx - 18, fy + 10);
    ctx.lineTo(fx + 16, fy + 20);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(fx + 4, fy + 10, 4, 0, Math.PI * 2); ctx.fill();
    // base
    ctx.fillStyle = "#00a800";
    ctx.fillRect(fx + 4, botY, 24, 12);
    ctx.fillStyle = "#3ddc3d"; ctx.fillRect(fx + 4, botY, 24, 4);
  }

  function drawCastle(ctx: CanvasRenderingContext2D, w: World, camX: number) {
    const cx = w.level.castleX * TILE - camX;
    if (cx < -200 || cx > VIEW_W + 100) return;
    const baseY = 13 * TILE;
    ctx.fillStyle = "#c84c0c";
    ctx.fillRect(cx, baseY - 64, 128, 64);
    ctx.fillStyle = "#e86a2c";
    ctx.fillRect(cx + 4, baseY - 60, 120, 56);
    // battlements
    for (let i = 0; i < 4; i++) ctx.fillRect(cx + 8 + i * 30, baseY - 76, 18, 14);
    // door
    ctx.fillStyle = "#000";
    ctx.fillRect(cx + 52, baseY - 36, 24, 36);
    ctx.beginPath(); ctx.arc(cx + 64, baseY - 36, 12, Math.PI, 0); ctx.fill();
    // windows
    ctx.fillStyle = "#000";
    ctx.fillRect(cx + 16, baseY - 52, 12, 16);
    ctx.fillRect(cx + 100, baseY - 52, 12, 16);
    ctx.fillRect(cx + 58, baseY - 68, 12, 12);
    // flag on castle
    ctx.fillStyle = "#888"; ctx.fillRect(cx + 62, baseY - 100, 3, 26);
    ctx.fillStyle = "#e52521";
    ctx.beginPath(); ctx.moveTo(cx + 65, baseY - 100); ctx.lineTo(cx + 85, baseY - 94); ctx.lineTo(cx + 65, baseY - 88); ctx.closePath(); ctx.fill();
    // bricks lines
    ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
    for (let y = baseY - 50; y < baseY; y += 12) { ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + 128, y); ctx.stroke(); }
  }

  function drawPowerup(ctx: CanvasRenderingContext2D, pu: Powerup, camX: number) {
    const x = pu.x - camX, y = pu.y;
    if (x < -40 || x > VIEW_W + 40) return;
    if (pu.type === "mushroom") {
      ctx.fillStyle = "#e52521";
      ctx.beginPath(); ctx.arc(x + 12, y + 10, 12, Math.PI, 0); ctx.fill();
      ctx.fillRect(x, y + 10, 24, 4);
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x + 7, y + 7, 3, 0, Math.PI * 2); ctx.arc(x + 17, y + 6, 3, 0, Math.PI * 2); ctx.arc(x + 12, y + 11, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffcc99"; ctx.fillRect(x + 6, y + 14, 12, 8);
      ctx.fillStyle = "#000"; ctx.fillRect(x + 8, y + 17, 2, 3); ctx.fillRect(x + 14, y + 17, 2, 3);
    } else if (pu.type === "fire") {
      const bob = Math.sin(pu.anim * 2) * 2;
      ctx.fillStyle = "#ff6a00";
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + pu.anim * 0.5;
        ctx.beginPath(); ctx.ellipse(x + 12 + Math.cos(a) * 9, y + 10 + bob + Math.sin(a) * 7, 5, 7, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.arc(x + 12, y + 10 + bob, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + 12, y + 10 + bob, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000"; ctx.fillRect(x + 9, y + 9 + bob, 2, 3); ctx.fillRect(x + 13, y + 9 + bob, 2, 3);
    } else {
      // star
      ctx.save();
      ctx.translate(x + 12, y + 12);
      ctx.rotate(Math.sin(pu.anim) * 0.3);
      ctx.fillStyle = "#ffd700";
      ctx.strokeStyle = "#b8860b"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 12 : 5;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#000";
      ctx.fillRect(-4, -2, 2, 3); ctx.fillRect(2, -2, 2, 3);
      ctx.restore();
    }
  }

  function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, sx: number) {
    const y = e.y;
    if (e.squashed > 0) {
      // squashed flat
      ctx.fillStyle = e.type === "koopa" ? "#00a800" : "#c84c0c";
      ctx.fillRect(sx, y + e.h - 8, e.w, 8);
      return;
    }
    if (e.type === "goomba") {
      const step = Math.floor(e.anim * 2) % 2;
      ctx.fillStyle = "#c84c0c";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 12, 14, 12, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e86a2c";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 10, 11, 9, 0, 0, Math.PI * 2); ctx.fill();
      // feet
      ctx.fillStyle = "#5a2a00";
      ctx.fillRect(sx + 2 + step * 2, y + 20, 10, 5);
      ctx.fillRect(sx + 16 - step * 2, y + 20, 10, 5);
      // eyes angry
      ctx.fillStyle = "#fff";
      ctx.fillRect(sx + 6, y + 6, 6, 7); ctx.fillRect(sx + 16, y + 6, 6, 7);
      ctx.fillStyle = "#000";
      ctx.fillRect(sx + 8, y + 8, 3, 4); ctx.fillRect(sx + 18, y + 8, 3, 4);
      ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx + 5, y + 4); ctx.lineTo(sx + 12, y + 7); ctx.moveTo(sx + 23, y + 4); ctx.lineTo(sx + 16, y + 7); ctx.stroke();
      // fangs
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.moveTo(sx + 8, y + 16); ctx.lineTo(sx + 11, y + 20); ctx.lineTo(sx + 14, y + 16); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx + 14, y + 16); ctx.lineTo(sx + 17, y + 20); ctx.lineTo(sx + 20, y + 16); ctx.fill();
    } else if (e.type === "beetle") {
      const step = Math.floor(e.anim * 2) % 2;
      ctx.fillStyle = "#3b6fd4";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 12, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#6ea8ff";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 10, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1a3a7a";
      ctx.fillRect(sx + 2 + step * 2, y + 20, 10, 5); ctx.fillRect(sx + 16 - step * 2, y + 20, 10, 5);
      ctx.fillStyle = "#fff"; ctx.fillRect(sx + 6, y + 6, 6, 7); ctx.fillRect(sx + 16, y + 6, 6, 7);
      ctx.fillStyle = "#000"; ctx.fillRect(sx + 8, y + 8, 3, 4); ctx.fillRect(sx + 18, y + 8, 3, 4);
      ctx.fillStyle = "#ffd700"; ctx.fillRect(sx + 11, y + 2, 6, 3);
    } else if (e.type === "koopa") {
      if (e.shell !== "none") {
        // shell only
        ctx.fillStyle = "#00a800";
        ctx.beginPath(); ctx.ellipse(sx + 14, y + 10, 14, 10, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(sx, y + 10, 28, 8);
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx + 2, y + 12, 24, 3);
        ctx.fillStyle = "#007800";
        ctx.fillRect(sx + 6, y + 6, 5, 5); ctx.fillRect(sx + 17, y + 6, 5, 5);
      } else {
        const step = Math.floor(e.anim * 2) % 2;
        // head
        const hx = e.dir === 1 ? sx + 20 : sx + 2;
        ctx.fillStyle = "#ffcc99";
        ctx.beginPath(); ctx.arc(hx + 4, y + 6, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#000"; ctx.fillRect(hx + (e.dir === 1 ? 5 : 2), y + 4, 2, 3);
        // shell body
        ctx.fillStyle = "#00a800";
        ctx.beginPath(); ctx.ellipse(sx + 14, y + 22, 14, 12, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(sx, y + 22, 28, 10);
        ctx.fillStyle = "#fff";
        ctx.fillRect(sx + 2, y + 24, 24, 3);
        ctx.fillStyle = "#007800";
        ctx.fillRect(sx + 6, y + 16, 6, 6); ctx.fillRect(sx + 16, y + 16, 6, 6);
        // feet
        ctx.fillStyle = "#ffcc99";
        ctx.fillRect(sx + 3 + step * 2, y + 32, 8, 4); ctx.fillRect(sx + 17 - step * 2, y + 32, 8, 4);
      }
    } else if (e.type === "piranha") {
      // stem
      ctx.fillStyle = "#00a800";
      ctx.fillRect(sx + 12, y + 22, 4, 14);
      ctx.fillStyle = "#3ddc3d";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 28, 6, 3, 0.5, 0, Math.PI * 2); ctx.fill();
      // head
      ctx.fillStyle = "#e52521";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 12, 14, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(sx + 8, y + 8, 2.5, 0, Math.PI * 2); ctx.arc(sx + 18, y + 7, 2.5, 0, Math.PI * 2); ctx.arc(sx + 13, y + 13, 2, 0, Math.PI * 2); ctx.fill();
      // mouth
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 16, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath(); ctx.ellipse(sx + 14, y + 16, 7, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawPlayer(ctx: CanvasRenderingContext2D, w: World, camX: number) {
    const p = w.player;
    const x = p.x - camX, y = p.y;
    const isFire = p.state === "fire";
    const isBig = p.state !== "small";
    const cap = isFire ? "#ffffff" : "#e52521";
    const shirt = isFire ? "#ffffff" : "#e52521";
    const overalls = isFire ? "#e52521" : "#2b5cff";
    const skin = "#ffcc99";
    const shoe = "#8a4a00";

    // Star rainbow flash
    let useCap = cap, useShirt = shirt, useOver = overalls;
    if (p.star > 0) {
      const cols = ["#e52521", "#ff8c00", "#ffd700", "#00c800", "#2b5cff", "#9b30ff"];
      const c = cols[Math.floor(performance.now() / 120) % cols.length];
      useCap = c; useShirt = c; useOver = "#ffffff";
    }

    const runFrame = Math.floor(p.anim) % 2;
    const airborne = !p.onGround;

    ctx.save();
    if (p.facing === -1) { ctx.translate(x + p.w / 2, 0); ctx.scale(-1, 1); ctx.translate(-(x + p.w / 2), 0); }

    if (!isBig) {
      // SMALL MARIO (22x28)
      // shoes
      ctx.fillStyle = shoe;
      if (airborne) { ctx.fillRect(x + 2, y + 24, 8, 4); ctx.fillRect(x + 12, y + 22, 8, 4); }
      else if (Math.abs(p.vx) > 0.3) { ctx.fillRect(x + 1 + runFrame * 3, y + 24, 9, 4); ctx.fillRect(x + 12 - runFrame * 3, y + 24, 9, 4); }
      else { ctx.fillRect(x + 2, y + 24, 9, 4); ctx.fillRect(x + 11, y + 24, 9, 4); }
      // overalls legs
      ctx.fillStyle = useOver;
      ctx.fillRect(x + 4, y + 16, 14, 9);
      // shirt arms
      ctx.fillStyle = useShirt;
      if (airborne) { ctx.fillRect(x + 1, y + 10, 5, 8); ctx.fillRect(x + 16, y + 6, 5, 8); }
      else if (Math.abs(p.vx) > 0.3) { ctx.fillRect(x + 1, y + 11 + runFrame * 2, 5, 7); ctx.fillRect(x + 16, y + 11 - runFrame * 2, 5, 7); }
      else { ctx.fillRect(x + 1, y + 11, 5, 7); ctx.fillRect(x + 16, y + 11, 5, 7); }
      // torso overalls top
      ctx.fillStyle = useOver; ctx.fillRect(x + 5, y + 12, 12, 6);
      ctx.fillStyle = "#ffd700"; ctx.fillRect(x + 6, y + 13, 3, 3); ctx.fillRect(x + 13, y + 13, 3, 3);
      // head
      ctx.fillStyle = skin; ctx.fillRect(x + 4, y + 4, 14, 9);
      // eye
      ctx.fillStyle = "#000"; ctx.fillRect(x + 13, y + 7, 3, 4);
      // mustache
      ctx.fillStyle = "#4a2a00"; ctx.fillRect(x + 10, y + 10, 8, 2);
      // cap
      ctx.fillStyle = useCap; ctx.fillRect(x + 3, y, 16, 5);
      ctx.fillRect(x + 14, y + 3, 8, 3); // brim
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + 11, y + 2, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = useCap; ctx.font = "bold 6px monospace"; ctx.textAlign = "center"; ctx.fillText("M", x + 11, y + 4);
    } else {
      // BIG / FIRE MARIO (24x42)
      // shoes
      ctx.fillStyle = shoe;
      if (airborne) { ctx.fillRect(x + 1, y + 38, 10, 4); ctx.fillRect(x + 13, y + 35, 10, 4); }
      else if (Math.abs(p.vx) > 0.3) { ctx.fillRect(x + 0 + runFrame * 4, y + 38, 10, 4); ctx.fillRect(x + 14 - runFrame * 4, y + 38, 10, 4); }
      else { ctx.fillRect(x + 1, y + 38, 10, 4); ctx.fillRect(x + 13, y + 38, 10, 4); }
      // legs overalls
      ctx.fillStyle = useOver;
      if (airborne) { ctx.fillRect(x + 3, y + 28, 8, 11); ctx.fillRect(x + 13, y + 26, 8, 11); }
      else if (Math.abs(p.vx) > 0.3) { ctx.fillRect(x + 2 + runFrame * 3, y + 28, 9, 11); ctx.fillRect(x + 13 - runFrame * 3, y + 28, 9, 11); }
      else { ctx.fillRect(x + 3, y + 28, 8, 11); ctx.fillRect(x + 13, y + 28, 8, 11); }
      // arms
      ctx.fillStyle = useShirt;
      if (airborne) { ctx.fillRect(x + 0, y + 16, 6, 12); ctx.fillRect(x + 18, y + 10, 6, 12); }
      else if (Math.abs(p.vx) > 0.3) { ctx.fillRect(x + 0, y + 17 + runFrame * 3, 6, 11); ctx.fillRect(x + 18, y + 17 - runFrame * 3, 6, 11); }
      else { ctx.fillRect(x + 0, y + 17, 6, 11); ctx.fillRect(x + 18, y + 17, 6, 11); }
      // hands
      ctx.fillStyle = "#fff";
      if (airborne) { ctx.fillRect(x + 0, y + 26, 6, 4); ctx.fillRect(x + 18, y + 20, 6, 4); }
      else { ctx.fillRect(x + 0, y + 26, 6, 4); ctx.fillRect(x + 18, y + 26, 6, 4); }
      // torso
      ctx.fillStyle = useOver; ctx.fillRect(x + 5, y + 18, 14, 12);
      ctx.fillStyle = "#ffd700"; ctx.fillRect(x + 6, y + 20, 4, 4); ctx.fillRect(x + 14, y + 20, 4, 4);
      // head
      ctx.fillStyle = skin; ctx.fillRect(x + 4, y + 6, 16, 13);
      ctx.fillStyle = "#000"; ctx.fillRect(x + 14, y + 10, 4, 5);
      ctx.fillStyle = "#4a2a00"; ctx.fillRect(x + 11, y + 15, 10, 3);
      // cap
      ctx.fillStyle = useCap; ctx.fillRect(x + 3, y, 18, 7);
      ctx.fillRect(x + 15, y + 5, 10, 4);
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + 12, y + 3, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = useCap; ctx.font = "bold 8px monospace"; ctx.textAlign = "center"; ctx.fillText("M", x + 12, y + 6);
      // hair sideburn
      ctx.fillStyle = "#4a2a00"; ctx.fillRect(x + 4, y + 10, 3, 8);
    }
    ctx.restore();
  }

  // Touch handlers
  const bindTouch = (key: keyof typeof touchRef.current) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.target as HTMLElement).setPointerCapture(e.pointerId); touchRef.current[key] = true; },
    onPointerUp: (e: React.PointerEvent) => { e.preventDefault(); touchRef.current[key] = false; },
    onPointerCancel: () => { touchRef.current[key] = false; },
    onPointerLeave: () => { touchRef.current[key] = false; },
  });

  return (
    <div className="min-h-screen bg-[#0b1020] text-white" style={{ backgroundImage: "radial-gradient(ellipse at top, #1e2a5a 0%, #0b1020 60%)" }}>
      {/* Top bar */}
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-red-600 text-xl font-black shadow-lg shadow-red-900/50 ring-2 ring-white/20">M</div>
          <div>
            <div className="font-pixel text-[13px] leading-none text-white mario-title-sm sm:text-sm">SUPER MARIO</div>
            <div className="mt-1 text-[11px] font-bold tracking-widest text-sky-300">MUSHROOM KINGDOM ADVENTURE</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold sm:flex">
            <span className="text-yellow-300">★ HIGH</span> {highScore.toLocaleString()}
          </div>
          <button onClick={toggleMute} className="rounded-full bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20" title="Mute (M)">
            {muted ? "🔇" : "🔊"}
          </button>
          <button onClick={pauseGame} className="rounded-full bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20" title="Pause (P)">
            {phase === "paused" ? "▶" : "⏸"}
          </button>
          <button onClick={() => startGame(levelIndexRef.current, true)} className="rounded-full bg-red-600 px-4 py-2 text-sm font-black shadow hover:bg-red-500">↻ RESTART</button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-10">
        {/* Game frame */}
        <div className="relative overflow-hidden rounded-2xl border-4 border-black bg-black shadow-[0_20px_60px_rgba(0,0,0,0.6)] ring-4 ring-sky-500/30">
          {/* HUD */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent px-3 py-2 sm:px-5">
            <div className="flex items-center gap-3 sm:gap-5">
              <div>
                <div className="font-pixel text-[8px] text-red-400 sm:text-[9px]">MARIO</div>
                <div className="font-pixel text-[11px] text-white sm:text-sm">{String(hud.score).padStart(6, "0")}</div>
              </div>
              <div className="hidden sm:block">
                <div className="font-pixel text-[8px] text-sky-300">WORLD</div>
                <div className="font-pixel text-[11px] text-white">{hud.worldName}</div>
              </div>
              <div>
                <div className="font-pixel text-[8px] text-yellow-300">TIME</div>
                <div className={`font-pixel text-[11px] sm:text-sm ${hud.time <= 30 ? "animate-blink text-red-400" : "text-white"}`}>{String(hud.time).padStart(3, "0")}</div>
              </div>
            </div>
            <div className="flex items-center gap-3 sm:gap-5">
              <div className="flex items-center gap-1.5">
                <span className="animate-coin-spin inline-flex h-5 w-5 items-center justify-center rounded-full border-2 border-yellow-700 bg-yellow-400 text-[10px] font-black text-yellow-900">¢</span>
                <span className="font-pixel text-[11px] text-white sm:text-sm">×{String(hud.coins).padStart(2, "0")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-lg">🍄</span>
                <span className="font-pixel text-[11px] text-white sm:text-sm">×{hud.lives}</span>
              </div>
            </div>
          </div>

          <canvas ref={canvasRef} width={VIEW_W} height={VIEW_H} className="block h-auto w-full" />

          {/* TITLE OVERLAY */}
          {phase === "title" && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-gradient-to-b from-sky-500/30 via-transparent to-black/60 p-4 text-center">
              <div className="animate-slide-up">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-[10px] font-black tracking-widest text-yellow-300 ring-1 ring-yellow-400/40">
                  ★ A MARIO-STYLE PLATFORMER ★
                </div>
                <h1 className="font-pixel mario-title text-3xl leading-tight text-white sm:text-5xl">
                  <span className="text-red-500">SUPER</span> <span className="text-yellow-400">MARIO</span>
                </h1>
                <p className="font-pixel mt-2 text-[10px] text-sky-200 sm:text-xs">MUSHROOM KINGDOM ADVENTURE</p>
                <div className="mx-auto mt-4 flex max-w-md items-center justify-center gap-2 text-xs font-bold text-white/90 sm:text-sm">
                  <span className="rounded-lg bg-black/50 px-2 py-1">Run</span>
                  <span className="rounded-lg bg-black/50 px-2 py-1">Jump on Goombas</span>
                  <span className="rounded-lg bg-black/50 px-2 py-1">Grab the Flag!</span>
                </div>
              </div>
              <button onClick={() => startGame(0, true)} className="font-pixel animate-pop-in mt-6 rounded-xl border-b-8 border-red-800 bg-red-600 px-8 py-4 text-sm text-white shadow-2xl transition hover:scale-105 hover:bg-red-500 active:translate-y-1 active:border-b-2 sm:text-base">
                ▶ START GAME
              </button>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px] font-bold text-white/80">
                <span className="rounded bg-black/50 px-2 py-1">← → Move</span>
                <span className="rounded bg-black/50 px-2 py-1">SPACE Jump</span>
                <span className="rounded bg-black/50 px-2 py-1">SHIFT Run</span>
                <span className="rounded bg-black/50 px-2 py-1">X Fireball</span>
                <span className="rounded bg-black/50 px-2 py-1">P Pause</span>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => startGame(0, true)} className="rounded-full bg-white px-4 py-2 text-xs font-black text-slate-900 hover:bg-yellow-300">WORLD 1-1</button>
                <button onClick={() => startGame(1, true)} className="rounded-full bg-white/20 px-4 py-2 text-xs font-black text-white ring-1 ring-white/40 hover:bg-white/30">WORLD 1-2 🔒</button>
              </div>
            </div>
          )}

          {/* INTRO */}
          {phase === "intro" && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70">
              <div className="font-pixel animate-pop-in text-center">
                <div className="text-xs text-sky-300">{hud.worldName}</div>
                <div className="mt-3 text-2xl text-white sm:text-3xl">HERE WE GO!</div>
                <div className="mt-4 text-[10px] text-white/70">REACH THE FLAGPOLE →</div>
              </div>
            </div>
          )}

          {/* PAUSED */}
          {phase === "paused" && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70">
              <div className="font-pixel text-2xl text-white">PAUSED</div>
              <button onClick={pauseGame} className="font-pixel mt-5 rounded-xl bg-red-600 px-6 py-3 text-xs text-white hover:bg-red-500">▶ RESUME</button>
              <button onClick={() => startGame(levelIndexRef.current, true)} className="mt-3 rounded-full bg-white/15 px-4 py-2 text-xs font-bold">Restart Level</button>
            </div>
          )}

          {/* LEVEL COMPLETE */}
          {phase === "complete" && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/70 p-4 text-center">
              <div className="animate-pop-in">
                <div className="text-4xl">🏁</div>
                <div className="font-pixel mt-2 text-xl text-yellow-400 sm:text-2xl">COURSE CLEAR!</div>
                <div className="mt-4 space-y-1 text-sm font-bold text-white">
                  <div>SCORE: <span className="text-yellow-300">{levelCompleteInfo.score.toLocaleString()}</span></div>
                  <div>TIME BONUS: <span className="text-green-400">+{levelCompleteInfo.timeBonus.toLocaleString()}</span></div>
                  <div>COINS: <span className="text-yellow-300">×{hud.coins}</span> &nbsp; LIVES: <span className="text-red-400">×{hud.lives}</span></div>
                </div>
                <button onClick={() => {
                  const next = levelIndexRef.current + 1;
                  if (next < 2) startGame(next, false);
                  else { setPhaseBoth("win"); sfx.win(); }
                }} className="font-pixel mt-5 rounded-xl bg-red-600 px-6 py-3 text-xs text-white hover:bg-red-500">
                  {levelIndexRef.current + 1 < 2 ? "NEXT WORLD →" : "FINISH →"}
                </button>
              </div>
            </div>
          )}

          {/* GAME OVER */}
          {phase === "gameover" && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 p-4 text-center">
              <div className="animate-pop-in">
                <div className="font-pixel text-2xl text-red-500 sm:text-3xl">GAME OVER</div>
                <div className="mt-3 text-sm font-bold text-white/80">The Mushroom Kingdom needs you!</div>
                <div className="mt-2 font-pixel text-xs text-yellow-300">SCORE {hud.score.toLocaleString()}</div>
                {hud.score >= highScore && hud.score > 0 && <div className="mt-1 text-xs font-black text-green-400">★ NEW HIGH SCORE! ★</div>}
                <button onClick={() => startGame(0, true)} className="font-pixel mt-5 rounded-xl bg-red-600 px-6 py-3 text-xs text-white hover:bg-red-500">TRY AGAIN</button>
                <button onClick={() => setPhaseBoth("title")} className="mt-3 block w-full text-xs font-bold text-white/70 hover:text-white">Back to Title</button>
              </div>
            </div>
          )}

          {/* WIN */}
          {phase === "win" && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-gradient-to-b from-yellow-500/30 to-black/80 p-4 text-center">
              <div className="animate-pop-in">
                <div className="text-5xl">👑</div>
                <div className="font-pixel mt-2 text-xl text-yellow-300 sm:text-2xl">YOU SAVED THE KINGDOM!</div>
                <div className="mt-3 text-sm font-bold text-white">Princess Peach is proud of you!</div>
                <div className="font-pixel mt-3 text-xs text-white">FINAL SCORE {hud.score.toLocaleString()}</div>
                <button onClick={() => startGame(0, true)} className="font-pixel mt-5 rounded-xl bg-red-600 px-6 py-3 text-xs text-white hover:bg-red-500">PLAY AGAIN</button>
              </div>
            </div>
          )}

          {/* Touch controls */}
          {showTouch && phase === "playing" && (
            <div className="absolute inset-x-0 bottom-0 z-20 flex items-end justify-between p-3">
              <div className="flex gap-2">
                <button {...bindTouch("left")} className="touch-btn flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-2xl text-white ring-2 ring-white/30 active:bg-white/30">◀</button>
                <button {...bindTouch("right")} className="touch-btn flex h-14 w-14 items-center justify-center rounded-full bg-black/50 text-2xl text-white ring-2 ring-white/30 active:bg-white/30">▶</button>
              </div>
              <div className="flex gap-2">
                <button {...bindTouch("shoot")} className="touch-btn flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/70 text-lg ring-2 ring-white/30 active:bg-orange-500">🔥</button>
                <button {...bindTouch("run")} className="touch-btn flex h-12 w-12 items-center justify-center rounded-full bg-sky-600/70 text-lg ring-2 ring-white/30 active:bg-sky-500">💨</button>
                <button {...bindTouch("jump")} className="touch-btn flex h-16 w-16 items-center justify-center rounded-full bg-red-600/80 text-2xl ring-2 ring-white/30 active:bg-red-500">⬆</button>
              </div>
            </div>
          )}
        </div>

        {/* Below game controls */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="font-pixel text-[10px] text-yellow-300">HOW TO PLAY</div>
            <ul className="mt-2 space-y-1 text-xs font-semibold text-white/80">
              <li>• <b>← → / A D</b> — Move &nbsp; <b>SPACE / ↑</b> — Jump</li>
              <li>• <b>SHIFT</b> — Run &nbsp; <b>X</b> — Fireball (Fire Mario)</li>
              <li>• Stomp Goombas & Koopas. Kick shells!</li>
              <li>• Hit <b>?</b> blocks for Mushrooms, Fire Flowers & Stars</li>
              <li>• Break bricks when Big. Reach the flag!</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="font-pixel text-[10px] text-sky-300">WORLDS</div>
            <div className="mt-3 flex gap-2">
              <button onClick={() => startGame(0, true)} className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-black ${hud.level === 0 ? "bg-red-600 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}>1-1<br /><span className="text-[10px] font-bold opacity-80">Green Hills</span></button>
              <button onClick={() => startGame(1, true)} className={`flex-1 rounded-xl px-3 py-2.5 text-xs font-black ${hud.level === 1 ? "bg-red-600 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}>1-2<br /><span className="text-[10px] font-bold opacity-80">Sunset Ridge</span></button>
            </div>
            <div className="mt-2 text-[11px] font-bold text-white/60">High Score: <span className="text-yellow-300">{highScore.toLocaleString()}</span></div>
          </div>
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
            <div className="font-pixel text-[10px] text-green-300">POWER-UPS</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px] font-bold">
              <div className="rounded-xl bg-red-500/20 p-2 ring-1 ring-red-400/30"><div className="text-xl">🍄</div>Mushroom<br /><span className="text-white/60">Grow Big</span></div>
              <div className="rounded-xl bg-orange-500/20 p-2 ring-1 ring-orange-400/30"><div className="text-xl">🔥</div>Fire Flower<br /><span className="text-white/60">Shoot Fire</span></div>
              <div className="rounded-xl bg-yellow-500/20 p-2 ring-1 ring-yellow-400/30"><div className="text-xl">⭐</div>Star<br /><span className="text-white/60">Invincible</span></div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-black/30 px-4 py-3 text-xs font-bold text-white/60 ring-1 ring-white/10">
          <span>Tip: Hold jump while stomping for a higher bounce. Shells can defeat whole rows of enemies!</span>
          <span className="flex items-center gap-2">
            <button onClick={() => setShowTouch(v => !v)} className="rounded-full bg-white/10 px-3 py-1.5 hover:bg-white/20">{showTouch ? "Hide" : "Show"} Touch Controls</button>
            <span>100 coins = 1UP 🍄</span>
          </span>
        </div>

        <footer className="mt-6 text-center text-[11px] font-bold text-white/40">
          Fan-made Mario-style platformer • Built with React + Canvas + Web Audio • Not affiliated with Nintendo
        </footer>
      </main>
    </div>
  );
}
