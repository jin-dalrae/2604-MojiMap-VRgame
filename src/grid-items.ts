import {
  Object3D,
  Mesh,
  Group,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  RingGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  DoubleSide,
  AdditiveBlending,
} from "@iwsdk/core";

// ── Cyberpunk color palette ─────────────────────────────────
const COLORS = {
  cyan: 0x00ffff,
  magenta: 0xff00ff,
  yellow: 0xffff00,
  orange: 0xff6600,
  green: 0x00ff66,
  blue: 0x0066ff,
  red: 0xff3366,
  white: 0xffffff,
};

// ── Neon material factory ───────────────────────────────────
function createNeonMaterial(color: number, emissiveIntensity = 0.5): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity,
    metalness: 0.8,
    roughness: 0.2,
  });
}

function createGlowMaterial(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.3,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

// ── Item factory functions ──────────────────────────────────

function createCube(): Object3D {
  const group = new Group();
  const geo = new BoxGeometry(0.5, 0.5, 0.5);
  const mesh = new Mesh(geo, createNeonMaterial(COLORS.cyan));
  group.add(mesh);

  // Glow outline
  const glowGeo = new BoxGeometry(0.55, 0.55, 0.55);
  const glow = new Mesh(glowGeo, createGlowMaterial(COLORS.cyan));
  group.add(glow);

  return group;
}

function createSphere(): Object3D {
  const group = new Group();
  const geo = new SphereGeometry(0.25, 24, 24);
  const mesh = new Mesh(geo, createNeonMaterial(COLORS.blue));
  group.add(mesh);

  // Glow
  const glowGeo = new SphereGeometry(0.28, 16, 16);
  const glow = new Mesh(glowGeo, createGlowMaterial(COLORS.blue));
  group.add(glow);

  return group;
}

function createCylinder(): Object3D {
  const group = new Group();
  const geo = new CylinderGeometry(0.2, 0.2, 0.5, 24);
  const mesh = new Mesh(geo, createNeonMaterial(COLORS.orange));
  group.add(mesh);

  return group;
}

function createChair(): Object3D {
  const group = new Group();
  const mat = createNeonMaterial(COLORS.magenta, 0.3);

  // Seat
  const seat = new Mesh(new BoxGeometry(0.4, 0.05, 0.4), mat);
  seat.position.y = 0.25;
  group.add(seat);

  // Back
  const back = new Mesh(new BoxGeometry(0.4, 0.4, 0.05), mat);
  back.position.set(0, 0.45, -0.175);
  group.add(back);

  // Legs
  const legGeo = new CylinderGeometry(0.02, 0.02, 0.25);
  const positions = [[-0.15, 0.125, -0.15], [0.15, 0.125, -0.15], [-0.15, 0.125, 0.15], [0.15, 0.125, 0.15]];
  for (const [x, y, z] of positions) {
    const leg = new Mesh(legGeo, mat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  return group;
}

function createTable(): Object3D {
  const group = new Group();
  const mat = createNeonMaterial(COLORS.green, 0.3);

  // Top
  const top = new Mesh(new BoxGeometry(0.7, 0.05, 0.5), mat);
  top.position.y = 0.4;
  group.add(top);

  // Legs
  const legGeo = new CylinderGeometry(0.03, 0.03, 0.4);
  const positions = [[-0.3, 0.2, -0.2], [0.3, 0.2, -0.2], [-0.3, 0.2, 0.2], [0.3, 0.2, 0.2]];
  for (const [x, y, z] of positions) {
    const leg = new Mesh(legGeo, mat);
    leg.position.set(x, y, z);
    group.add(leg);
  }

  return group;
}

function createLamp(): Object3D {
  const group = new Group();

  // Base
  const base = new Mesh(
    new CylinderGeometry(0.1, 0.12, 0.05, 16),
    createNeonMaterial(COLORS.white, 0.2)
  );
  group.add(base);

  // Pole
  const pole = new Mesh(
    new CylinderGeometry(0.02, 0.02, 0.4, 8),
    createNeonMaterial(COLORS.white, 0.2)
  );
  pole.position.y = 0.22;
  group.add(pole);

  // Bulb (glowing)
  const bulb = new Mesh(
    new SphereGeometry(0.08, 16, 16),
    createNeonMaterial(COLORS.yellow, 2.0)
  );
  bulb.position.y = 0.45;
  group.add(bulb);

  // Glow
  const glow = new Mesh(
    new SphereGeometry(0.15, 16, 16),
    createGlowMaterial(COLORS.yellow)
  );
  glow.position.y = 0.45;
  group.add(glow);

  return group;
}

function createPlant(): Object3D {
  const group = new Group();

  // Pot
  const pot = new Mesh(
    new CylinderGeometry(0.1, 0.08, 0.15, 12),
    createNeonMaterial(COLORS.orange, 0.2)
  );
  pot.position.y = 0.075;
  group.add(pot);

  // Leaves (simple cones)
  const leafMat = createNeonMaterial(COLORS.green, 0.4);
  for (let i = 0; i < 5; i++) {
    const leaf = new Mesh(new ConeGeometry(0.03, 0.3, 4), leafMat);
    const angle = (i / 5) * Math.PI * 2;
    const spread = 0.05;
    leaf.position.set(Math.cos(angle) * spread, 0.25 + Math.random() * 0.1, Math.sin(angle) * spread);
    leaf.rotation.z = (Math.random() - 0.5) * 0.3;
    group.add(leaf);
  }

  return group;
}

function createScreen(): Object3D {
  const group = new Group();

  // Screen frame
  const frame = new Mesh(
    new BoxGeometry(0.6, 0.4, 0.03),
    createNeonMaterial(COLORS.white, 0.1)
  );
  frame.position.y = 0.35;
  group.add(frame);

  // Screen (glowing)
  const screen = new Mesh(
    new PlaneGeometry(0.55, 0.35),
    createNeonMaterial(COLORS.cyan, 0.8)
  );
  screen.position.set(0, 0.35, 0.02);
  group.add(screen);

  // Stand
  const stand = new Mesh(
    new CylinderGeometry(0.02, 0.02, 0.15, 8),
    createNeonMaterial(COLORS.white, 0.1)
  );
  stand.position.y = 0.075;
  group.add(stand);

  // Base
  const base = new Mesh(
    new CylinderGeometry(0.1, 0.1, 0.02, 16),
    createNeonMaterial(COLORS.white, 0.1)
  );
  base.position.y = 0.01;
  group.add(base);

  return group;
}

function createFire(): Object3D {
  const group = new Group();

  // Fire cones (layered)
  const colors = [COLORS.red, COLORS.orange, COLORS.yellow];
  const sizes = [[0.15, 0.4], [0.1, 0.35], [0.06, 0.25]];

  for (let i = 0; i < 3; i++) {
    const fire = new Mesh(
      new ConeGeometry(sizes[i][0], sizes[i][1], 8),
      createNeonMaterial(colors[i], 1.5 - i * 0.3)
    );
    fire.position.y = sizes[i][1] / 2 + 0.05;
    group.add(fire);
  }

  // Glow
  const glow = new Mesh(
    new SphereGeometry(0.3, 16, 16),
    createGlowMaterial(COLORS.orange)
  );
  glow.position.y = 0.2;
  group.add(glow);

  return group;
}

function createPortal(): Object3D {
  const group = new Group();

  // Ring frame
  const ring = new Mesh(
    new TorusGeometry(0.3, 0.03, 8, 32),
    createNeonMaterial(COLORS.magenta, 1.0)
  );
  ring.position.y = 0.35;
  group.add(ring);

  // Inner vortex (disc)
  const vortex = new Mesh(
    new RingGeometry(0.05, 0.27, 32),
    createNeonMaterial(COLORS.cyan, 0.8)
  );
  vortex.position.y = 0.35;
  group.add(vortex);

  // Glow
  const glow = new Mesh(
    new SphereGeometry(0.4, 16, 16),
    createGlowMaterial(COLORS.magenta)
  );
  glow.position.y = 0.35;
  group.add(glow);

  return group;
}

function createStar(): Object3D {
  const group = new Group();

  // Central sphere
  const center = new Mesh(
    new SphereGeometry(0.1, 16, 16),
    createNeonMaterial(COLORS.yellow, 2.0)
  );
  center.position.y = 0.3;
  group.add(center);

  // Points (cones)
  const pointMat = createNeonMaterial(COLORS.yellow, 1.5);
  const directions = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
  ];

  for (const [dx, dy, dz] of directions) {
    const point = new Mesh(new ConeGeometry(0.05, 0.15, 4), pointMat);
    point.position.set(dx * 0.15 + 0, dy * 0.15 + 0.3, dz * 0.15);
    point.lookAt(dx * 2, dy * 2 + 0.3, dz * 2);
    group.add(point);
  }

  // Glow
  const glow = new Mesh(
    new SphereGeometry(0.25, 16, 16),
    createGlowMaterial(COLORS.yellow)
  );
  glow.position.y = 0.3;
  group.add(glow);

  return group;
}

function createMusic(): Object3D {
  const group = new Group();
  const mat = createNeonMaterial(COLORS.magenta, 0.4);

  // Speaker box
  const box = new Mesh(new BoxGeometry(0.3, 0.4, 0.2), mat);
  box.position.y = 0.2;
  group.add(box);

  // Speaker cone (large)
  const cone1 = new Mesh(
    new CylinderGeometry(0.08, 0.1, 0.05, 16),
    createNeonMaterial(COLORS.cyan, 0.6)
  );
  cone1.position.set(0, 0.25, 0.11);
  cone1.rotation.x = Math.PI / 2;
  group.add(cone1);

  // Speaker cone (small)
  const cone2 = new Mesh(
    new CylinderGeometry(0.03, 0.04, 0.03, 16),
    createNeonMaterial(COLORS.cyan, 0.6)
  );
  cone2.position.set(0, 0.35, 0.11);
  cone2.rotation.x = Math.PI / 2;
  group.add(cone2);

  return group;
}

function createRobot(): Object3D {
  const group = new Group();
  const bodyMat = createNeonMaterial(COLORS.cyan, 0.3);
  const accentMat = createNeonMaterial(COLORS.magenta, 0.6);

  // Body
  const body = new Mesh(new BoxGeometry(0.25, 0.3, 0.15), bodyMat);
  body.position.y = 0.25;
  group.add(body);

  // Head
  const head = new Mesh(new BoxGeometry(0.2, 0.15, 0.12), bodyMat);
  head.position.y = 0.475;
  group.add(head);

  // Eyes
  const eyeMat = createNeonMaterial(COLORS.red, 1.5);
  const eyeGeo = new SphereGeometry(0.02, 8, 8);
  const leftEye = new Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.05, 0.49, 0.07);
  group.add(leftEye);

  const rightEye = new Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.05, 0.49, 0.07);
  group.add(rightEye);

  // Antenna
  const antenna = new Mesh(
    new CylinderGeometry(0.01, 0.01, 0.1, 8),
    accentMat
  );
  antenna.position.y = 0.6;
  group.add(antenna);

  const antennaBall = new Mesh(new SphereGeometry(0.025, 8, 8), accentMat);
  antennaBall.position.y = 0.66;
  group.add(antennaBall);

  // Arms
  const armGeo = new BoxGeometry(0.05, 0.2, 0.05);
  const leftArm = new Mesh(armGeo, bodyMat);
  leftArm.position.set(-0.175, 0.2, 0);
  group.add(leftArm);

  const rightArm = new Mesh(armGeo, bodyMat);
  rightArm.position.set(0.175, 0.2, 0);
  group.add(rightArm);

  // Legs
  const legGeo = new BoxGeometry(0.08, 0.1, 0.08);
  const leftLeg = new Mesh(legGeo, bodyMat);
  leftLeg.position.set(-0.07, 0.05, 0);
  group.add(leftLeg);

  const rightLeg = new Mesh(legGeo, bodyMat);
  rightLeg.position.set(0.07, 0.05, 0);
  group.add(rightLeg);

  return group;
}

// ── Factory map ─────────────────────────────────────────────

const ITEM_FACTORIES: Record<string, () => Object3D> = {
  cube: createCube,
  sphere: createSphere,
  cylinder: createCylinder,
  chair: createChair,
  table: createTable,
  lamp: createLamp,
  plant: createPlant,
  screen: createScreen,
  fire: createFire,
  portal: createPortal,
  star: createStar,
  music: createMusic,
  robot: createRobot,
};

// ── Public API ──────────────────────────────────────────────

export function createGridItem(type: string): Object3D | null {
  const factory = ITEM_FACTORIES[type];
  if (!factory) {
    console.warn(`[GridItems] Unknown type: ${type}`);
    return null;
  }
  return factory();
}

export function getAvailableTypes(): string[] {
  return Object.keys(ITEM_FACTORIES);
}
