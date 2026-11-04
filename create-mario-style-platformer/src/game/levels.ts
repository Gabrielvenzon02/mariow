export const TILE = 32;
export const T = {
  EMPTY: 0,
  GROUND: 1,
  BRICK: 2,
  Q_COIN: 3,
  Q_MUSHROOM: 4,
  Q_FIRE: 5,
  Q_STAR: 6,
  USED: 7,
  PIPE: 8, // pipe body/top distinguished by neighbors
  STAIR: 9,
  HARD: 10,
  FLAG: 11,
  CLOUD_BLOCK: 12,
} as const;

export interface CoinSpawn { x: number; y: number; }
export interface EnemySpawn { x: number; y: number; type: "goomba" | "koopa" | "piranha" | "beetle"; pipeX?: number; pipeY?: number; }
export interface LevelData {
  name: string;
  width: number; // tiles
  height: number; // tiles
  tiles: number[][];
  coins: CoinSpawn[];
  enemies: EnemySpawn[];
  playerStart: { x: number; y: number };
  flagX: number; // tile x
  castleX: number;
  theme: "day" | "dusk" | "underground";
  time: number;
}

function emptyGrid(w: number, h: number) {
  return Array.from({ length: h }, () => Array(w).fill(T.EMPTY));
}
function ground(g: number[][], x0: number, x1: number, topRow: number) {
  for (let x = x0; x <= x1; x++) {
    for (let y = topRow; y < g.length; y++) g[y][x] = T.GROUND;
  }
}
function pit(g: number[][], x0: number, x1: number, topRow: number) {
  for (let x = x0; x <= x1; x++) for (let y = topRow; y < g.length; y++) g[y][x] = T.EMPTY;
}
function pipe(g: number[][], x: number, topRow: number, height: number) {
  // height includes top row; pipe occupies x, x+1
  for (let i = 0; i < height; i++) {
    const y = topRow - height + i;
    g[y][x] = T.PIPE;
    g[y][x + 1] = T.PIPE;
  }
}
function stairs(g: number[][], x: number, topRow: number, steps: number, dir: 1 | -1) {
  for (let s = 0; s < steps; s++) {
    const h = s + 1;
    const sx = dir === 1 ? x + s : x - s;
    for (let i = 0; i < h; i++) {
      const y = topRow - 1 - i;
      if (y >= 0) g[y][sx] = T.STAIR;
    }
  }
}
function blockRow(g: number[][], x: number, y: number, pattern: number[]) {
  pattern.forEach((t, i) => { if (t !== T.EMPTY) g[y][x + i] = t; });
}
function platform(g: number[][], x: number, y: number, len: number) {
  for (let i = 0; i < len; i++) g[y][x + i] = T.HARD;
}
function coinRow(coins: CoinSpawn[], x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) coins.push({ x: x + i, y });
}
function coinArc(coins: CoinSpawn[], cx: number, cy: number) {
  const pts = [[-2, 0], [-1, -1], [0, -1], [1, -1], [2, 0]];
  pts.forEach(([dx, dy]) => coins.push({ x: cx + dx, y: cy + dy }));
}

export function createLevel1(): LevelData {
  const W = 230, H = 15, TOP = 13;
  const g = emptyGrid(W, H);
  const coins: CoinSpawn[] = [];
  const enemies: EnemySpawn[] = [];

  ground(g, 0, W - 1, TOP);
  // pits
  pit(g, 68, 70, TOP);
  pit(g, 108, 111, TOP);
  pit(g, 152, 154, TOP);
  pit(g, 188, 191, TOP);

  // --- Start area blocks ---
  blockRow(g, 16, 9, [T.Q_COIN, T.BRICK, T.Q_MUSHROOM, T.BRICK, T.Q_COIN]);
  blockRow(g, 21, 5, [T.Q_COIN]);
  coinRow(coins, 24, 9, 4);
  enemies.push({ x: 24, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 32, y: TOP - 1, type: "goomba" });

  // pipes
  pipe(g, 28, TOP, 2);
  pipe(g, 38, TOP, 3);
  enemies.push({ x: 38, y: TOP - 3, type: "piranha", pipeX: 38, pipeY: TOP - 3 });
  pipe(g, 48, TOP, 4);
  enemies.push({ x: 48, y: TOP - 4, type: "piranha", pipeX: 48, pipeY: TOP - 4 });
  pipe(g, 58, TOP, 2);
  enemies.push({ x: 62, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 64, y: TOP - 1, type: "goomba" });

  // brick + question cluster over pit approach
  blockRow(g, 74, 9, [T.BRICK, T.Q_FIRE, T.BRICK, T.Q_COIN, T.BRICK]);
  blockRow(g, 75, 5, [T.Q_STAR]);
  coinArc(coins, 69, 10);
  enemies.push({ x: 80, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 86, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 88, y: TOP - 1, type: "goomba" });

  // floating platforms
  platform(g, 92, 9, 3);
  platform(g, 96, 6, 3);
  coinRow(coins, 92, 8, 3);
  coinRow(coins, 96, 5, 3);
  enemies.push({ x: 98, y: TOP - 1, type: "koopa" });

  // pipe + enemies
  pipe(g, 102, TOP, 3);
  enemies.push({ x: 104, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 105, y: TOP - 1, type: "goomba" });
  coinArc(coins, 109, 10);

  // mid blocks
  blockRow(g, 116, 9, [T.Q_COIN, T.BRICK, T.Q_MUSHROOM, T.BRICK, T.Q_COIN]);
  blockRow(g, 118, 5, [T.BRICK, T.Q_COIN, T.BRICK]);
  enemies.push({ x: 122, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 126, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 128, y: TOP - 1, type: "beetle" });

  pipe(g, 134, TOP, 4);
  enemies.push({ x: 134, y: TOP - 4, type: "piranha", pipeX: 134, pipeY: TOP - 4 });
  pipe(g, 144, TOP, 2);
  coinRow(coins, 138, 9, 4);
  enemies.push({ x: 148, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 150, y: TOP - 1, type: "goomba" });

  // platforms over pit
  platform(g, 152, 10, 1);
  platform(g, 153, 8, 1);
  platform(g, 154, 10, 1);
  coinArc(coins, 153, 7);

  blockRow(g, 158, 9, [T.BRICK, T.Q_COIN, T.BRICK, T.Q_FIRE, T.BRICK]);
  enemies.push({ x: 166, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 170, y: TOP - 1, type: "beetle" });
  enemies.push({ x: 172, y: TOP - 1, type: "goomba" });

  pipe(g, 178, TOP, 3);
  enemies.push({ x: 178, y: TOP - 3, type: "piranha", pipeX: 178, pipeY: TOP - 3 });
  coinRow(coins, 182, 9, 4);

  // staircase to flag
  stairs(g, 198, TOP, 8, 1);
  // flagpole at 210
  const flagX = 210;
  for (let y = 2; y < TOP; y++) g[y][flagX] = T.FLAG;
  // castle base blocks
  for (let x = 216; x <= 224; x++) {
    g[TOP - 1][x] = T.HARD;
    g[TOP - 2][x] = T.HARD;
  }
  g[TOP - 3][218] = T.HARD; g[TOP - 3][222] = T.HARD;
  g[TOP - 3][220] = T.HARD;
  g[TOP - 4][220] = T.HARD;

  // extra coins scattered
  coinRow(coins, 10, 10, 3);
  coinRow(coins, 40, 8, 3);
  coinRow(coins, 60, 10, 3);
  coinRow(coins, 84, 10, 3);
  coinRow(coins, 120, 10, 3);
  coinRow(coins, 164, 10, 3);
  coinRow(coins, 194, 10, 3);

  enemies.push({ x: 12, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 44, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 52, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 90, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 140, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 160, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 184, y: TOP - 1, type: "koopa" });

  return {
    name: "WORLD 1-1",
    width: W, height: H, tiles: g, coins, enemies,
    playerStart: { x: 2, y: TOP - 2 },
    flagX, castleX: 216,
    theme: "day", time: 300,
  };
}

export function createLevel2(): LevelData {
  const W = 240, H = 15, TOP = 13;
  const g = emptyGrid(W, H);
  const coins: CoinSpawn[] = [];
  const enemies: EnemySpawn[] = [];

  ground(g, 0, W - 1, TOP);
  pit(g, 30, 33, TOP);
  pit(g, 62, 65, TOP);
  pit(g, 95, 99, TOP);
  pit(g, 130, 133, TOP);
  pit(g, 165, 169, TOP);
  pit(g, 200, 203, TOP);

  blockRow(g, 14, 9, [T.Q_MUSHROOM, T.BRICK, T.Q_COIN, T.BRICK, T.Q_COIN]);
  enemies.push({ x: 20, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 24, y: TOP - 1, type: "koopa" });
  pipe(g, 26, TOP, 3);
  enemies.push({ x: 26, y: TOP - 3, type: "piranha", pipeX: 26, pipeY: TOP - 3 });
  coinArc(coins, 31, 10);

  blockRow(g, 38, 9, [T.BRICK, T.Q_FIRE, T.BRICK, T.BRICK, T.Q_COIN]);
  blockRow(g, 39, 5, [T.Q_STAR]);
  enemies.push({ x: 44, y: TOP - 1, type: "beetle" });
  enemies.push({ x: 48, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 50, y: TOP - 1, type: "goomba" });
  platform(g, 54, 9, 4);
  coinRow(coins, 54, 8, 4);

  pipe(g, 58, TOP, 4);
  enemies.push({ x: 58, y: TOP - 4, type: "piranha", pipeX: 58, pipeY: TOP - 4 });
  coinArc(coins, 63, 10);
  enemies.push({ x: 68, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 72, y: TOP - 1, type: "beetle" });

  blockRow(g, 78, 9, [T.Q_COIN, T.BRICK, T.Q_MUSHROOM, T.BRICK, T.Q_COIN]);
  blockRow(g, 80, 5, [T.BRICK, T.Q_COIN, T.BRICK]);
  enemies.push({ x: 84, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 86, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 88, y: TOP - 1, type: "goomba" });
  platform(g, 90, 8, 3);
  platform(g, 94, 6, 3);
  coinRow(coins, 90, 7, 3);
  coinRow(coins, 94, 5, 3);

  pipe(g, 104, TOP, 2);
  pipe(g, 112, TOP, 3);
  enemies.push({ x: 112, y: TOP - 3, type: "piranha", pipeX: 112, pipeY: TOP - 3 });
  coinArc(coins, 97, 10);
  enemies.push({ x: 118, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 122, y: TOP - 1, type: "beetle" });

  blockRow(g, 126, 9, [T.BRICK, T.Q_COIN, T.BRICK, T.Q_FIRE, T.BRICK]);
  platform(g, 131, 10, 1); platform(g, 132, 8, 1); platform(g, 133, 10, 1);
  enemies.push({ x: 138, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 140, y: TOP - 1, type: "goomba" });
  pipe(g, 146, TOP, 4);
  enemies.push({ x: 146, y: TOP - 4, type: "piranha", pipeX: 146, pipeY: TOP - 4 });
  coinRow(coins, 150, 9, 4);

  blockRow(g, 156, 9, [T.Q_MUSHROOM, T.BRICK, T.Q_COIN, T.BRICK, T.Q_COIN]);
  enemies.push({ x: 162, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 166, y: TOP - 1, type: "beetle" });
  platform(g, 172, 9, 3); platform(g, 176, 6, 3);
  coinRow(coins, 172, 8, 3); coinRow(coins, 176, 5, 3);
  coinArc(coins, 167, 10);

  pipe(g, 184, TOP, 3);
  enemies.push({ x: 184, y: TOP - 3, type: "piranha", pipeX: 184, pipeY: TOP - 3 });
  enemies.push({ x: 190, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 192, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 194, y: TOP - 1, type: "koopa" });

  blockRow(g, 196, 9, [T.BRICK, T.Q_STAR, T.BRICK, T.Q_COIN, T.BRICK]);
  coinArc(coins, 201, 10);

  stairs(g, 208, TOP, 8, 1);
  const flagX = 220;
  for (let y = 2; y < TOP; y++) g[y][flagX] = T.FLAG;
  for (let x = 226; x <= 234; x++) {
    g[TOP - 1][x] = T.HARD;
    g[TOP - 2][x] = T.HARD;
  }
  g[TOP - 3][228] = T.HARD; g[TOP - 3][232] = T.HARD; g[TOP - 3][230] = T.HARD;
  g[TOP - 4][230] = T.HARD;

  coinRow(coins, 8, 10, 3);
  coinRow(coins, 42, 10, 3);
  coinRow(coins, 74, 10, 3);
  coinRow(coins, 108, 10, 3);
  coinRow(coins, 142, 10, 3);
  coinRow(coins, 180, 10, 3);

  enemies.push({ x: 10, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 36, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 52, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 76, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 100, y: TOP - 1, type: "koopa" });
  enemies.push({ x: 124, y: TOP - 1, type: "goomba" });
  enemies.push({ x: 154, y: TOP - 1, type: "beetle" });
  enemies.push({ x: 188, y: TOP - 1, type: "goomba" });

  return {
    name: "WORLD 1-2",
    width: W, height: H, tiles: g, coins, enemies,
    playerStart: { x: 2, y: TOP - 2 },
    flagX, castleX: 226,
    theme: "dusk", time: 300,
  };
}
