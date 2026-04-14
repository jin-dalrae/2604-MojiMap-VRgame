import {
  createSystem,
  Vector3,
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  CylinderGeometry,
  ConeGeometry,
  DoubleSide,
  Object3D,
} from "@iwsdk/core";
import { type Signal } from "@preact/signals-core";
import { FX } from "./game-fx.js";
import {
  GameState,
  GameActions,
  RESULT_DISPLAY_MS,
  type RoundEndReason,
  type RoundResult,
  isPickup,
  isHazard,
  MAX_HEALTH,
  GOAL_POINTS,
  POWERUP_HEAL,
  FIRE_DPS,
  FIRE_RADIUS,
  PICKUP_RADIUS,
  ENEMY_DAMAGE_RADIUS,
  enemyStats,
  SWORD_RADIUS,
  SWORD_DAMAGE,
  SWORD_COOLDOWN_MS,
  type ItemRole,
} from "./game-state.js";

// ── Grid coordinate mapping ──────────────────────────────────
// Portal grid: 20 cols × 10 rows
// Cell (row r, col c) center → world: x = c - 9.5, z = r - 4.5.
// y is chosen so the billboarded sprite hovers just above the grid floor.
function gridToWorld(row: number, col: number): [number, number, number] {
  return [col - 9.5, 0.55, row - 4.5];
}

// ── Emoji sprite factory ─────────────────────────────────────
// Render the emoji onto a CanvasTexture wrapped in a Three.js Sprite so
// it always faces the headset. For pickups we also paint a soft white
// radial halo underneath — reads as "collectible" at a glance. Hazards
// get a subtle red aura so players know to keep their distance.
function makeEmojiSprite(
  emoji: string,
  role: ItemRole = "decor",
  size = 1.1,
): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  if (isPickup(role)) {
    // Soft white disc behind emoji — affordance for "grab me"
    const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
    grad.addColorStop(0, "rgba(255,255,255,0.95)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0.0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
  } else if (isHazard(role)) {
    // Red glow — danger signal, no "pickup" affordance
    const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 60);
    grad.addColorStop(0, "rgba(239,68,68,0.55)");
    grad.addColorStop(1, "rgba(239,68,68,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.font = '108px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, 64, 70);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    depthWrite: true,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}

// ── Avatar colors (same palette as broadcast + portal) ──────
const AVATAR_COLORS = [
  0x6366f1, 0xec4899, 0xf59e0b, 0x10b981,
  0x3b82f6, 0xef4444, 0xa855f7, 0x14b8a6,
];
function colorForUser(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// Shared cone geometry for avatar facing indicators (allocated once).
// Tip at origin, base extends forward (+Z) — rotates with avatar heading.
const avatarConeGeom = new ConeGeometry(0.5, 1.2, 20, 1, true);
avatarConeGeom.rotateX(-Math.PI / 2); // tip → -Z, base → +Z
avatarConeGeom.translate(0, 0, 0.6);  // tip at z=0, base at z=1.2

type AvatarRecord = {
  root: Object3D;
  cone: Mesh;
  entity: { dispose(): void };
};

// ── System ───────────────────────────────────────────────────
type SpawnedItem = {
  entity: { dispose(): void };
  sprite: Sprite;
  role: ItemRole;
  // Portal's `type` string (e.g. "robot", "ghost"). Drives per-variant
  // enemy stats via enemyStats() — decor/pickups ignore it.
  type: string;
  baseSize: number;
  // Original grid cell position — used to snap enemies back home when
  // the round ends and they've drifted from chasing the player.
  origin: [number, number, number];
  hp: number;
  nextDamageableAt: number; // ms epoch; 0 = always hittable
};

export class PortalSystem extends createSystem({}) {
  private ws: WebSocket | null = null;
  private spawnedEntities = new Map<string, SpawnedItem>();
  private avatars = new Map<string, AvatarRecord>();
  private lastPosSend = 0;
  private tempPos!: Vector3;
  private tempFwd!: Vector3;
  private tempGrip!: Vector3;
  private tempChase!: Vector3;
  // Cooldown gates — keeps sword from deleting enemies in a single tick
  // by virtue of being inside their hit radius for several frames.
  private lastSwordHitAt = 0;
  private userId: string | null = null;

  // Round/game state signals — shared via world.globals. PortalSystem
  // writes most of these; WeaponSystem and HUDSystem only read.
  private roundRunning!: Signal<boolean>;
  private roundEndsAt!: Signal<number>; // ms epoch, 0 when idle
  private score!: Signal<number>;
  private playerHealth!: Signal<number>;
  private equippedLeft!: Signal<"sword" | null>;
  private equippedRight!: Signal<"gun" | null>;
  private roundResult!: Signal<RoundResult | null>;
  private goalsTotal!: Signal<number>;
  private goalsCollected!: Signal<number>;
  // spaceId is the Quest Shared Spaces XRSharedReferenceSpace UUID when available.
  // Set externally (e.g. by a future SharedSpaceSystem that requests the "shared"
  // feature and listens for the reference space UUID); forwarded on every update.
  public spaceId: string | null = null;
  // Pre-allocated to avoid update() allocations. The stats fields ride
  // along with every position packet so observers (portal/broadcast) can
  // render a leaderboard at the native 10 Hz update cadence.
  private posMsg: {
    type: string;
    position: { x: number; z: number; heading: number; pitch: number };
    score: number;
    health: number;
    goalsCollected: number;
    goalsTotal: number;
    spaceId: string | null;
  } = {
    type: 'PLAYER_POSITION',
    position: { x: 0, z: 0, heading: 0, pitch: 0 },
    score: 0,
    health: MAX_HEALTH,
    goalsCollected: 0,
    goalsTotal: 0,
    spaceId: null,
  };

  init() {
    this.tempPos = new Vector3();
    this.tempFwd = new Vector3();
    this.tempGrip = new Vector3();
    this.tempChase = new Vector3();

    const globals = this.world.globals as Record<string, unknown>;
    this.roundRunning  = GameState.roundRunning(globals);
    this.roundEndsAt   = GameState.roundEndsAt(globals);
    this.score         = GameState.score(globals);
    this.playerHealth  = GameState.playerHealth(globals);
    this.equippedLeft  = GameState.equippedLeft(globals);
    this.equippedRight = GameState.equippedRight(globals);
    this.roundResult   = GameState.roundResult(globals);
    this.goalsTotal     = GameState.goalsTotal(globals);
    this.goalsCollected = GameState.goalsCollected(globals);

    // Expose damage entry-point for ProjectileSystem + any future attackers.
    // Passing the key lets the callback do O(1) lookup + broadcast GRID_CLEAR.
    GameActions.setDamageEnemy(globals, (key, amount) => this.damageEnemy(key, amount));
    GameActions.setFindEnemyAt(globals, (x, y, z, r2) => this.findEnemyAt(x, y, z, r2));

    this.connectWS();
  }

  // Nearest enemy within squared radius, or null. Linear scan — fine
  // for the few dozen items a round has; swap to a spatial hash if we
  // ever push past a couple hundred.
  private findEnemyAt(x: number, y: number, z: number, r2: number): string | null {
    let bestKey: string | null = null;
    let bestD2 = r2;
    for (const [key, item] of this.spawnedEntities) {
      if (item.role !== 'enemy') continue;
      const dx = item.sprite.position.x - x;
      const dy = item.sprite.position.y - y;
      const dz = item.sprite.position.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestKey = key;
      }
    }
    return bestKey;
  }

  // Returns true if the hit killed the enemy (so callers can skip further
  // processing against a now-gone entity).
  private damageEnemy(key: string, amount: number): boolean {
    const item = this.spawnedEntities.get(key);
    if (!item || item.role !== 'enemy') return false;
    item.hp -= amount;
    if (item.hp <= 0) {
      this.score.value = this.score.peek() + enemyStats(item.type).killPoints;
      this.despawnItem(key);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
      }
      // Either hand works for the kill thump; prefer whichever has a pad.
      FX.enemyKill(this.input.gamepads.right ?? this.input.gamepads.left);
      return true;
    }
    return false;
  }

  private connectWS() {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const url = isLocal ? `ws://${location.hostname}:3001` : `wss://ar-app-ws-production.up.railway.app`;
    console.log(`[GridSync] Connecting → ${url}`);
    const ws = new WebSocket(url);

    ws.onopen = () => console.log('[GridSync] Connected');

    ws.onmessage = (e: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      console.log('[GridSync] Disconnected — retrying in 2s');
      setTimeout(() => this.connectWS(), 2000);
    };

    this.cleanupFuncs.push(() => ws.close());
    this.ws = ws;
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case 'WELCOME':
        this.userId = msg.userId;
        console.log(`[GridSync] Joined as ${this.userId?.slice(0, 8)}`);
        for (const key of [...this.spawnedEntities.keys()]) this.despawnItem(key);
        for (const [key, item] of Object.entries(msg.grid as Record<string, any>)) {
          this.spawnItem(key, item);
        }
        for (const [, av] of this.avatars) this.disposeAvatar(av);
        this.avatars.clear();
        for (const [uid, user] of Object.entries(msg.users as Record<string, any>)) {
          if (uid !== this.userId) this.updateAvatar(uid, user.position);
        }
        // Adopt any round already in progress on the server.
        if (msg.round && msg.round.endsAt > Date.now()) {
          this.roundEndsAt.value = msg.round.endsAt;
          this.roundRunning.value = true;
        } else {
          this.roundEndsAt.value = 0;
          this.roundRunning.value = false;
        }
        break;

      case 'ROUND_START':
        console.log(`[Round] Started — ends at ${new Date(msg.endsAt).toISOString()}`);
        // Fresh run: clear inventory + score, heal up. WeaponSystem reacts
        // via the signal subscription and despawns any weapon meshes.
        this.score.value = 0;
        this.playerHealth.value = MAX_HEALTH;
        this.equippedLeft.value = null;
        this.equippedRight.value = null;
        this.roundEndsAt.value = msg.endsAt;
        this.roundRunning.value = true;
        // Snapshot goal count so checkWin() knows if this was a
        // goal-based round (ignore survival rounds with zero goals).
        // HUD also reads goalsTotal to decide whether to show "X/Y".
        let total = 0;
        for (const item of this.spawnedEntities.values()) {
          if (item.role === 'goal') total++;
        }
        this.goalsTotal.value = total;
        this.goalsCollected.value = 0;
        FX.roundStart();
        break;

      case 'ROUND_END': {
        const finalScore = this.score.peek();
        const reason = (msg.reason ?? 'timeout') as RoundEndReason;
        console.log(`[Round] Ended (${reason}) — final score: ${finalScore}`);
        this.roundEndsAt.value = 0;
        this.roundRunning.value = false;
        // Drop weapons at round end per design ("if you drop your weapons,
        // they despawn"). Health stays so the player sees their final state.
        this.equippedLeft.value = null;
        this.equippedRight.value = null;
        // HUD shows the result overlay; it clears the signal when it hides.
        this.roundResult.value = {
          reason,
          score: finalScore,
          expiresAt: Date.now() + RESULT_DISPLAY_MS,
        };
        // Reason-driven cue — completion feels different from timeout/death.
        if      (reason === 'completed') FX.roundWin();
        else if (reason === 'died')      FX.roundLose();
        else                             FX.roundTimeout();
        break;
      }

      case 'GRID_UPDATE':
        this.despawnItem(msg.key);
        this.spawnItem(msg.key, msg.item);
        break;

      case 'GRID_CLEAR':
        this.despawnItem(msg.key);
        break;

      case 'GRID_CLEAR_ALL':
        for (const key of [...this.spawnedEntities.keys()]) this.despawnItem(key);
        break;

      case 'USER_JOIN':
        if (msg.userId !== this.userId) this.updateAvatar(msg.userId, msg.position);
        break;

      case 'USER_LEAVE': {
        const av = this.avatars.get(msg.userId);
        if (av) { this.disposeAvatar(av); this.avatars.delete(msg.userId); }
        break;
      }

      case 'PLAYER_POSITION':
        if (msg.userId !== this.userId) this.updateAvatar(msg.userId, msg.position);
        break;
    }
  }

  // ── Avatar management ─────────────────────────────────────
  private createAvatar(userId: string): AvatarRecord {
    const color = colorForUser(userId);
    const root = new Object3D();

    // Body — a capsule-like cylinder
    const body = new Mesh(
      new CylinderGeometry(0.15, 0.15, 0.6, 12),
      new MeshBasicMaterial({ color }),
    );
    body.position.y = 0.7;
    root.add(body);

    // Head — sphere
    const head = new Mesh(
      new SphereGeometry(0.2, 16, 16),
      new MeshBasicMaterial({ color }),
    );
    head.position.y = 1.2;
    root.add(head);

    // Emoji face — billboarded sprite above head
    const face = makeEmojiSprite('🧑', 'decor', 0.5);
    face.position.y = 1.55;
    root.add(face);

    // Facing cone — extends forward from head so you can see where they look
    const cone = new Mesh(
      avatarConeGeom,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    cone.position.y = 1.2;
    root.add(cone);

    const entity = this.world.createTransformEntity(root);
    return { root, cone, entity };
  }

  private disposeAvatar(av: AvatarRecord) {
    av.root.traverse((obj: any) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose?.();
        obj.material.dispose?.();
      }
    });
    av.entity.dispose();
  }

  private updateAvatar(
    userId: string,
    pos: { x: number; z: number; heading?: number; pitch?: number },
  ) {
    if (!pos) return;
    let av = this.avatars.get(userId);
    if (!av) {
      av = this.createAvatar(userId);
      this.avatars.set(userId, av);
    }
    av.root.position.x = pos.x;
    av.root.position.z = pos.z;
    if (typeof pos.heading === 'number') {
      av.root.rotation.y = pos.heading;
    }
    if (typeof pos.pitch === 'number') {
      av.cone.rotation.x = -pos.pitch;
    }
  }

  private spawnItem(
    key: string,
    item: { type: string; icon: string; role?: ItemRole },
  ) {
    const [row, col] = key.split(',').map(Number);
    const [x, y, z] = gridToWorld(row, col);

    // Role drives halo/aura in the canvas. Older items placed before the
    // portal started tagging roles fall back to decor (no halo).
    const role: ItemRole = item.role ?? 'decor';
    const baseSize = 1.1;
    const sprite = makeEmojiSprite(item.icon, role, baseSize);
    sprite.position.set(x, y, z);

    const entity = this.world.createTransformEntity(sprite);
    this.spawnedEntities.set(key, {
      entity,
      sprite,
      role,
      type: item.type ?? 'decor',
      baseSize,
      origin: [x, y, z],
      hp: role === 'enemy' ? enemyStats(item.type ?? '').hp : 0,
      nextDamageableAt: 0,
    });
  }

  private despawnItem(key: string) {
    const record = this.spawnedEntities.get(key);
    if (!record) return;
    const mat = record.sprite.material as SpriteMaterial;
    if (mat.map) mat.map.dispose();
    mat.dispose();
    record.entity.dispose();
    this.spawnedEntities.delete(key);
  }

  // Per-frame item animation: pulse pickups, flicker hazards when a round
  // is active. Idle state leaves items at their static base transform.
  private animateItems(time: number, roundRunning: boolean) {
    // Shared phases — one sin per frame, not per item.
    const pulse = Math.sin(time * 3.5);        // pickup scale oscillation
    const bob   = Math.sin(time * 1.8) * 0.05; // pickup vertical bob
    const flick = 0.75 + Math.random() * 0.25; // hazard opacity jitter

    for (const item of this.spawnedEntities.values()) {
      const s = item.sprite;
      const mat = s.material as SpriteMaterial;

      if (!roundRunning) {
        // Snap to neutral state so the idle view stays calm. Restore
        // origin so enemies that wandered during chase return home.
        s.scale.set(item.baseSize, item.baseSize, 1);
        s.position.set(item.origin[0], item.origin[1], item.origin[2]);
        mat.opacity = 1;
        continue;
      }

      if (isPickup(item.role)) {
        const scale = item.baseSize * (1 + 0.08 * pulse);
        s.scale.set(scale, scale, 1);
        s.position.y = 0.55 + bob;
        mat.opacity = 1;
      } else if (isHazard(item.role)) {
        // Fire/enemies read as "alive" via opacity flicker. Steady scale
        // keeps the animation from feeling seizure-y.
        mat.opacity = flick;
        s.position.y = 0.55;
      }
    }
  }

  // Locally-authoritative collision: each client checks its own head
  // against the shared grid items. On pickup/kill we broadcast GRID_CLEAR
  // so other clients see the item vanish. No server-side validation —
  // trust-the-client is fine for a prototype, not a competitive game.
  private handleCollisions(deltaSeconds: number) {
    this.player.head.getWorldPosition(this.tempPos);

    const pickupR2 = PICKUP_RADIUS * PICKUP_RADIUS;
    const fireR2   = FIRE_RADIUS   * FIRE_RADIUS;
    const swordR2  = SWORD_RADIUS  * SWORD_RADIUS;
    const enemyR2  = ENEMY_DAMAGE_RADIUS * ENEMY_DAMAGE_RADIUS;

    const now = performance.now();
    const swordEquipped = this.equippedLeft.peek() === 'sword';
    const swordReady = swordEquipped && now >= this.lastSwordHitAt + SWORD_COOLDOWN_MS;
    if (swordEquipped) {
      this.player.gripSpaces.left.getWorldPosition(this.tempGrip);
    }

    let totalHealthDelta = 0; // apply once so Signal only fires one write

    // Snapshot keys first: despawning during Map iteration is fine, but
    // deterministic ordering matters when several items overlap.
    for (const [key, item] of [...this.spawnedEntities]) {
      const headD2 = this.tempPos.distanceToSquared(item.sprite.position);

      // ── Pickups (weapons, goals, powerups) ──
      if (isPickup(item.role) && headD2 < pickupR2) {
        this.applyPickup(item.role);
        this.despawnItem(key);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'GRID_CLEAR', key }));
        }
        continue;
      }

      // ── Fire: damage-over-time when player stands inside ──
      if (item.role === 'obstacle-damage' && headD2 < fireR2) {
        totalHealthDelta -= FIRE_DPS * deltaSeconds;
      }

      // ── Enemy logic ──
      if (item.role === 'enemy') {
        // Enemy touches player → damage over time (per variant)
        if (headD2 < enemyR2) {
          totalHealthDelta -= enemyStats(item.type).dps * deltaSeconds;
        }
        // Sword touches enemy → scheduled damage (once per cooldown)
        if (swordReady) {
          const gripD2 = this.tempGrip.distanceToSquared(item.sprite.position);
          if (gripD2 < swordR2) {
            this.lastSwordHitAt = now;
            const killed = this.damageEnemy(key, SWORD_DAMAGE);
            if (!killed) FX.swordHit(this.input.gamepads.left);
            continue; // item may be gone; don't touch it again this tick
          }
        }
      }
    }

    if (totalHealthDelta !== 0) {
      const current = this.playerHealth.peek();
      const next = Math.max(0, current + totalHealthDelta);
      if (next !== current) {
        this.playerHealth.value = next;
        // Cue once per chunk of damage taken (not per frame) — floor(hp/5)
        // changing means at least 5 HP drained since the last cue.
        if (Math.floor(next / 5) < Math.floor(current / 5)) {
          FX.playerHurt(this.input.gamepads.right ?? this.input.gamepads.left);
        }
        if (next <= 0) this.playerDied();
      }
    }
  }

  // Per-variant chase: speed + optional vertical bob for flying enemies.
  // Shared one-sin-per-frame phase keeps costs flat even with many ghosts.
  private tickEnemyAI(deltaSeconds: number, time: number) {
    this.player.head.getWorldPosition(this.tempPos);
    for (const item of this.spawnedEntities.values()) {
      if (item.role !== 'enemy') continue;
      const stats = enemyStats(item.type);

      // Horizontal chase
      this.tempChase.set(
        this.tempPos.x - item.sprite.position.x,
        0,
        this.tempPos.z - item.sprite.position.z,
      );
      const dist = this.tempChase.length();
      if (dist > 0.1) {
        const step = stats.speed * deltaSeconds;
        this.tempChase.multiplyScalar(step / dist);
        item.sprite.position.x += this.tempChase.x;
        item.sprite.position.z += this.tempChase.z;
      }

      // Vertical bob — ghosts float and weave, ground units skip this.
      if (stats.bobAmp > 0) {
        item.sprite.position.y =
          item.origin[1] + 0.5 + Math.sin(time * stats.bobSpeed) * stats.bobAmp;
      }
    }
  }

  private playerDied() {
    console.log('[Round] Player died');
    // Server will broadcast ROUND_END back, which resets everything.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ROUND_END', reason: 'died' }));
    }
  }

  private applyPickup(role: ItemRole) {
    const leftPad  = this.input.gamepads.left;
    const rightPad = this.input.gamepads.right;
    switch (role) {
      case 'weapon-sword':
        this.equippedLeft.value = 'sword';
        FX.pickupWeapon(leftPad);
        break;
      case 'weapon-gun':
        this.equippedRight.value = 'gun';
        FX.pickupWeapon(rightPad);
        break;
      case 'goal':
        this.score.value = this.score.peek() + GOAL_POINTS;
        this.goalsCollected.value = this.goalsCollected.peek() + 1;
        FX.pickupGoal(rightPad ?? leftPad);
        this.checkWin();
        break;
      case 'powerup':
        this.playerHealth.value = Math.min(
          MAX_HEALTH,
          this.playerHealth.peek() + POWERUP_HEAL,
        );
        FX.pickupPowerup(rightPad ?? leftPad);
        break;
    }
  }

  // End the round early when no goals remain. Only triggers if at least
  // one goal existed at round start — a survival round (zero goals)
  // should just run the clock.
  private checkWin() {
    if (this.goalsTotal.peek() === 0) return;
    if (this.goalsCollected.peek() < this.goalsTotal.peek()) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'ROUND_END', reason: 'completed' }));
    }
  }

  update(delta: number) {
    const time = performance.now() / 1000;
    const roundRunning = this.roundRunning.peek();
    this.animateItems(time, roundRunning);

    // Gameplay interactions only fire while the round is live. Gives the
    // planner time to place items before the contestant can grab them.
    if (roundRunning) {
      this.tickEnemyAI(delta, time);
      this.handleCollisions(delta);
    }

    // Send VR player head position at ~10 Hz
    const now = performance.now();
    if (now - this.lastPosSend < 100) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.player.head.getWorldPosition(this.tempPos);
    this.posMsg.position.x = this.tempPos.x;
    this.posMsg.position.z = this.tempPos.z;
    this.player.head.getWorldDirection(this.tempFwd);
    this.posMsg.position.heading = Math.atan2(-this.tempFwd.x, -this.tempFwd.z);
    this.posMsg.position.pitch = -Math.asin(Math.max(-1, Math.min(1, this.tempFwd.y)));
    this.posMsg.score          = this.score.peek();
    this.posMsg.health         = this.playerHealth.peek();
    this.posMsg.goalsCollected = this.goalsCollected.peek();
    this.posMsg.goalsTotal     = this.goalsTotal.peek();
    this.posMsg.spaceId        = this.spaceId;
    this.ws.send(JSON.stringify(this.posMsg));
    this.lastPosSend = now;
  }
}
