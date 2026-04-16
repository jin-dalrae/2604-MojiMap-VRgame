import {
  createSystem,
  createComponent,
  ShaderMaterial,
  Types,
  DoubleSide,
} from "@iwsdk/core";

// ── Shader Code ─────────────────────────────────────────────

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uPrimaryColor;
uniform vec3 uSecondaryColor;
uniform float uScanlineSpeed;
uniform float uGlitchIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;

// ── Noise functions ─────────────────────────────────────────

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ── Grid pattern ────────────────────────────────────────────

float gridLines(vec2 uv, vec2 resolution, float lineWidth) {
  vec2 grid = abs(fract(uv * resolution - 0.5) - 0.5) / fwidth(uv * resolution);
  float line = min(grid.x, grid.y);
  return 1.0 - min(line, 1.0);
}

// ── Circuit trace pattern ───────────────────────────────────

float circuitPattern(vec2 uv, float time) {
  vec2 cell = floor(uv * 10.0);
  float cellHash = hash(cell);

  // Horizontal or vertical line based on cell
  vec2 localUv = fract(uv * 10.0);
  float line = 0.0;

  if (cellHash > 0.5) {
    // Horizontal line
    line = smoothstep(0.48, 0.5, localUv.y) * smoothstep(0.52, 0.5, localUv.y);
  } else {
    // Vertical line
    line = smoothstep(0.48, 0.5, localUv.x) * smoothstep(0.52, 0.5, localUv.x);
  }

  // Traveling data packet
  float packetPos = fract(time * 0.3 + cellHash * 6.28);
  float packet = 0.0;

  if (cellHash > 0.5) {
    packet = smoothstep(0.1, 0.0, abs(localUv.x - packetPos)) * line;
  } else {
    packet = smoothstep(0.1, 0.0, abs(localUv.y - packetPos)) * line;
  }

  return line * 0.3 + packet * 2.0;
}

// ── Scanlines ───────────────────────────────────────────────

float scanlines(vec2 uv, float time, float speed) {
  float scanline = sin((uv.y * 80.0) + time * speed) * 0.5 + 0.5;
  scanline = pow(scanline, 1.5);
  return mix(0.85, 1.0, scanline);
}

// ── Glitch blocks ───────────────────────────────────────────

vec2 glitchOffset(vec2 uv, float time, float intensity) {
  // Random glitch trigger
  float glitchTime = floor(time * 8.0);
  float glitchRandom = hash(glitchTime);

  if (glitchRandom > (1.0 - intensity * 0.3)) {
    // Create block distortion
    float blockY = floor(uv.y * 15.0);
    float blockHash = hash(vec2(blockY, glitchTime));

    if (blockHash > 0.7) {
      float offset = (hash(vec2(blockY + 1.0, glitchTime)) - 0.5) * 0.1 * intensity;
      return vec2(offset, 0.0);
    }
  }
  return vec2(0.0);
}

// ── RGB split / chromatic aberration ────────────────────────

vec3 rgbSplit(vec2 uv, float time, float intensity) {
  float splitAmount = 0.003 * intensity;

  // Add time-based variation
  float glitchTime = floor(time * 4.0);
  float glitchRand = hash(glitchTime);
  if (glitchRand > 0.85) {
    splitAmount *= 3.0;
  }

  return vec3(
    splitAmount,
    0.0,
    -splitAmount
  );
}

// ── Main ────────────────────────────────────────────────────

void main() {
  vec2 uv = vUv;

  // Apply glitch offset
  vec2 glitchOff = glitchOffset(uv, uTime, uGlitchIntensity);
  uv += glitchOff;

  // RGB split offsets
  vec3 rgbOff = rgbSplit(uv, uTime, uGlitchIntensity);

  // Sample each channel with offset
  vec2 uvR = uv + vec2(rgbOff.r, 0.0);
  vec2 uvG = uv;
  vec2 uvB = uv + vec2(rgbOff.b, 0.0);

  // Base dark background
  vec3 bgColor = vec3(0.02, 0.02, 0.04);

  // Grid lines (main structure)
  float gridR = gridLines(uvR, uResolution, 0.02);
  float gridG = gridLines(uvG, uResolution, 0.02);
  float gridB = gridLines(uvB, uResolution, 0.02);

  // Circuit pattern
  float circuitR = circuitPattern(uvR, uTime);
  float circuitG = circuitPattern(uvG, uTime);
  float circuitB = circuitPattern(uvB, uTime);

  // Combine grid + circuit with RGB split
  vec3 gridColor;
  gridColor.r = gridR * uPrimaryColor.r + circuitR * uSecondaryColor.r;
  gridColor.g = gridG * uPrimaryColor.g + circuitG * uSecondaryColor.g;
  gridColor.b = gridB * uPrimaryColor.b + circuitB * uSecondaryColor.b;

  // Apply scanlines
  float scan = scanlines(uv, uTime, uScanlineSpeed);
  gridColor *= scan;

  // Random bright flicker
  float flicker = hash(vec2(floor(uTime * 30.0), 0.0));
  if (flicker > 0.97) {
    gridColor *= 1.5;
  }

  // Noise overlay for texture
  float noiseVal = noise(uv * 200.0 + uTime * 2.0) * 0.05;

  // Edge glow (vignette inverse - brighter at edges)
  float edgeDist = max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0;
  float edgeGlow = smoothstep(0.7, 1.0, edgeDist) * 0.3;

  // Final composition
  vec3 finalColor = bgColor + gridColor + noiseVal + edgeGlow * uPrimaryColor;

  // Occasional full-screen flash glitch
  float flashTime = floor(uTime * 2.0);
  float flashRand = hash(flashTime);
  if (flashRand > 0.98 && uGlitchIntensity > 0.3) {
    finalColor = mix(finalColor, vec3(1.0), 0.1);
  }

  gl_FragColor = vec4(finalColor, 0.9);
}
`;

// ── Material Factory ────────────────────────────────────────

export function createGlitchFloorMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: [20, 10] }, // Grid cells
      uPrimaryColor: { value: [0.0, 1.0, 1.0] }, // Cyan
      uSecondaryColor: { value: [1.0, 0.0, 1.0] }, // Magenta
      uScanlineSpeed: { value: 2.0 },
      uGlitchIntensity: { value: 0.5 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: DoubleSide,
  });
}

// ── Component to tag floor entity ───────────────────────────

export const GlitchFloor = createComponent("GlitchFloor", {
  material: { type: Types.Object, default: null },
});

// ── System to animate the shader ────────────────────────────

export class GlitchFloorSystem extends createSystem({
  floors: { required: [GlitchFloor] },
}) {
  update(_delta: number, time: number) {
    for (const entity of this.queries.floors.entities) {
      const material = entity.getValue(GlitchFloor, "material") as ShaderMaterial | null;
      if (material?.uniforms) {
        material.uniforms.uTime.value = time;
      }
    }
  }
}
