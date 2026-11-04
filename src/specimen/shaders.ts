// GLSL for the specimen. Two passes:
//  1. bake  — exact signed distance to the wordmark outline (+ terrain warp) into a float texture, once.
//  2. plate — 13 stacked sheets cut along offsets of that field, compiled twice from one source:
//       PLAN   seen from straight above, the plate is read directly (a survey drawing). Cheap, compiles first.
//       model  in perspective, raymarched (a laser-cut card model). Compiled in the background.
// Windows drivers compile through D3D, where nested loops and repeated inlining cost seconds, so the
// model path has exactly one call to map(): one loop walks the primary ray, the normal taps, the
// shadow ray and the occlusion taps in turn.

export const fullscreenVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const bakeFrag = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D uSegs;
uniform int uSegCount;
uniform int uSegWidth;
uniform vec4 uDomain;

// keep in sync with src/specimen/field.ts and scripts/build-specimen.mjs
float terrain(vec2 p) {
  return 0.5 * sin(0.83 * p.x + 1.7) * cos(0.61 * p.y - 0.9)
       + 0.3 * sin(0.47 * p.x - 1.13 * p.y + 2.1)
       + 0.2 * cos(1.37 * p.x + 0.71 * p.y + 0.4);
}

void main() {
  vec2 p = uDomain.xy + vUv * uDomain.zw;
  float best = 1e9;
  int wind = 0;
  for (int i = 0; i < uSegCount; i++) {
    vec4 s = texelFetch(uSegs, ivec2(i % uSegWidth, i / uSegWidth), 0);
    vec2 a = s.xy;
    vec2 e = s.zw - s.xy;
    vec2 w = p - a;
    vec2 d = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    best = min(best, dot(d, d));
    if ((a.y <= p.y) != (s.w <= p.y)) {
      float xi = a.x + (p.y - a.y) / e.y * e.x;
      if (p.x < xi) wind += e.y > 0.0 ? 1 : -1;
    }
  }
  float d = wind != 0 ? -sqrt(best) : sqrt(best);
  d += 0.13 * terrain(p) * smoothstep(0.1, 2.6, d) * d;
  fragColor = vec4(d, 0.0, 0.0, 1.0);
}
`

export const plateFrag = /* glsl */ `
precision highp float;
precision highp int;
layout(location = 0) out highp vec4 fragColor;

uniform vec2 uResolution;
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
uniform vec3 uCamPos;
uniform float uPxWorld;     // world size of one pixel at the camera target
uniform float uTargetDist;
uniform int uZero;          // always 0: keeps the compiler from unrolling loops

uniform sampler2D uField;
uniform vec4 uDomain;

uniform float uRadii[13];
uniform float uRing0;       // first offset around the letters
uniform float uGrowth;      // each ring is this much wider than the one inside it
uniform float uLayerH;
uniform float uSummitH;
uniform float uBuilt;
uniform float uExplode;
uniform float uCoarse;
uniform float uDrop;

uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbCol;
uniform vec3 uSheetCol;
uniform vec3 uInkCol;
uniform vec3 uCharCol;
uniform vec3 uBlueCol;

uniform float uPlan;
uniform float uCutZ;
uniform vec4 uTransect;
uniform float uTransectOn;
uniform vec3 uFuse[5];
uniform float uFuseTail[5];
uniform float uFuseOn;
uniform vec3 uBound;
uniform float uBoundOn;
uniform vec2 uFront;
uniform float uRollbackR;
uniform float uStakedR;
uniform float uStaked;
uniform vec2 uStakes[4];
uniform vec4 uStakeOn;
uniform float uGhost;
uniform float uSteps;
uniform float uShadows;
uniform vec3 uIceCol;       // survey light: current
uniform vec3 uMarkCol;      // survey light: proposed
uniform vec3 uRimDir;       // unit vector towards the galactic core, specimen world space
uniform vec3 uRimCol;       // core light: bulge colour x clamp(6/d_core, .15, 1.6)

const int TOP = 12;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
             mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float easeOut(float x) { float y = 1.0 - x; return 1.0 - y * y * y; }

float field(vec2 p) {
  vec2 c = clamp((p - uDomain.xy) / uDomain.zw, 0.0, 1.0);
  return textureLod(uField, c, 0.0).r + length(p - uDomain.xy - c * uDomain.zw);
}

// ---------------------------------------------------------------- the stack
float arrival(int i) { return clamp(uBuilt - float(i), 0.0, 1.0); }
// A sheet arrives eroded to nothing, unfolds to its contour while it descends, and only then is set.
float layerR(int i, float a) {
  float coarse = uCoarse * 0.3 * smoothstep(5.0, 12.0, float(i));
  return mix(-0.3, uRadii[i] + coarse, easeOut(a));
}
float slab() { return uLayerH + uExplode; }
float layerY0(int i, float a) { return float(i) * slab() + (1.0 - easeOut(a)) * uDrop; }
float layerT(int i) { return i == TOP ? uLayerH + uSummitH : uLayerH; }
float topY(int i) { return i < 0 ? 0.0 : layerY0(i, arrival(i)) + layerT(i); }
float stackTop() { return float(TOP) * slab() + uLayerH + uSummitH + (uBuilt < 12.999 ? uDrop : 0.0) + 0.02; }
int settledCount() { return int(floor(uBuilt + 1e-4)); }

// The offsets compound, so the ring index of a plate point is a logarithm, not a search.
float ringIndex(float f) { return f <= 0.0 ? -1.0 : floor(log(1.0 + f * (uGrowth - 1.0) / uRing0) / log(uGrowth)); }
float ringRadius(float k) { return k <= 0.0 ? 0.0 : uRing0 * (pow(uGrowth, k) - 1.0) / (uGrowth - 1.0); }

// Highest sheet standing over a plate point (-1 = bare plate). Ignores the rough summit (never shown in plan).
int layerAt(float f) {
  int s = settledCount();
  if (s <= TOP && arrival(s) > 0.0 && f < layerR(s, arrival(s))) return s;
  return min(TOP - int(ringIndex(f)) - 1, s - 1);
}

float boundSd(vec2 p) {
  vec2 q = abs(p) - uBound.xy + uBound.z;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uBound.z;
}

// Light relative to an unshadowed upward face, so the plate itself always reads as its exact colour.
vec3 relLight(float dif, float sh, float occ, float up) {
  return (uSunCol * dif * sh + uAmbCol * (0.55 + 0.45 * up) * occ) / (uSunCol * max(uSunDir.y, 0.0) + uAmbCol);
}

// ---------------------------------------------------------------- drawing on the plate
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a;
  vec2 w = p - a;
  return length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0));
}
// dashes drawn in plate space, so they behave like ink on the board when the camera moves
float dash(vec2 q, float s) { return mod(floor(q.x / s) + floor(q.y / s), 2.0); }
float ring(float f, float r, float pxf, float w) { return 1.0 - smoothstep(w - 0.5, w + 0.5, abs(f - r) / pxf); }

// straight-alpha "over": d is the layer below (rgb straight, a coverage), c a colour laid on it with coverage cov.
// On an opaque card (a = 1) this is exactly mix(d.rgb, c, cov); on empty space it builds up anti-aliased light.
vec4 lay(vec4 d, vec3 c, float cov) {
  cov = clamp(cov, 0.0, 1.0);
  float a = cov + d.a * (1.0 - cov);
  return vec4((c * cov + d.rgb * d.a * (1.0 - cov)) / max(a, 1e-5), a);
}

// Survey marks. On a card they are ink (current) and blue (proposed); on the invisible survey plane they are light: ice / mark.
vec4 overlays(vec4 col, vec3 p, float f, float pxf, float px, bool card) {
  vec2 q = p.xz;
  vec3 cur = card ? uInkCol : uIceCol;
  vec3 prop = card ? uBlueCol : uMarkCol;

  if (uGhost > 0.001) // the unrefined summit, kept as a rollback path
    col = lay(col, cur, ring(f, 0.3, pxf, 0.9) * dash(q, 0.025) * uGhost);

  if (uFront.y > 0.001) {
    col = lay(col, cur, ring(f, uRollbackR, pxf, 0.9) * dash(q, 0.03) * uFront.y);
    col = lay(col, prop, ring(f, uFront.x, pxf, 1.3) * dash(q, 0.09) * uFront.y);
  }

  if (uStaked > 0.001) {
    col = lay(col, prop, ring(f, uStakedR, pxf, 1.3) * dash(q, 0.11) * uStaked);
    for (int k = 0; k < 4; k++) {
      float on = uStakeOn[k];
      vec2 s = (q - uStakes[k]) / px;
      float post = 1.0 - smoothstep(3.0, 4.0, max(abs(s.x), abs(s.y)));
      // the ring closes in as the stake is driven
      float halo = 1.0 - smoothstep(0.6, 1.4, abs(length(s) - mix(30.0, 9.0, on)));
      col = lay(col, prop, max(post * step(0.5, on), halo) * step(0.001, on) * min(1.0, on * 1.6) * uStaked);
    }
  }

  if (uBoundOn > 0.001) {
    float b = abs(boundSd(q)) / px;
    col = lay(col, prop, (1.0 - smoothstep(0.7, 1.6, b)) * dash(q, 0.16) * uBoundOn);
  }

  if (uFuseOn > 0.001) {
    for (int k = 0; k < 5; k++) {
      float d = length(q - uFuse[k].xy);
      float rr = max(uFuse[k].z, 11.0 * px);
      float circle = 1.0 - smoothstep(0.6, 1.5, abs(d - rr) / px);
      float centre = 1.0 - smoothstep(1.8, 2.8, d / px);
      // a leader from the circle to its callout
      float s = sign(uFuseTail[k] - uFuse[k].y);
      vec2 a = uFuse[k].xy + vec2(0.0, s * rr);
      vec2 b = vec2(uFuse[k].x, uFuseTail[k] - s * 5.0 * px);
      float lead = 1.0 - smoothstep(0.5, 1.2, segDist(q, a, b) / px);
      col = lay(col, prop, max(max(circle, centre), lead) * uFuseOn);
    }
  }

  if (uTransectOn > 0.001) {
    vec2 a = uTransect.xy;
    vec2 b = uTransect.zw;
    float ds = segDist(q, a, b) / px;
    float line = 1.0 - smoothstep(0.6, 1.5, ds);
    float ends = 1.0 - smoothstep(0.6, 1.5, abs(min(length(q - a), length(q - b)) / px - 5.0));
    float k = ringIndex(f);
    float crossing = max(ring(f, ringRadius(k), pxf, 2.4), ring(f, ringRadius(k + 1.0), pxf, 2.4));
    float dots = crossing * (1.0 - smoothstep(2.4, 3.4, ds)) * step(f, uRadii[0] + 0.01);
    col = lay(col, prop, max(max(line, ends), dots) * uTransectOn);
  }
  return col;
}

// Contour of the sheet resting above this surface. One-sided, so overlapping letter contours never draw.
// id < 0 is the survey plane (light on nothing); id >= 0 is a card (ink on paper).
vec4 linework(vec4 col, vec3 p, float f, float pxf, float px, int id) {
  bool card = id >= 0;
  int j = id + 1;
  if (j <= TOP) {
    float aj = arrival(j);
    float e = (f - layerR(j, aj)) / pxf;
    float w = (j % 4 == 0) ? 1.8 : 1.05;
    float line = (1.0 - smoothstep(w - 0.5, w + 0.5, e)) * step(-0.35, e);
    float settled = smoothstep(0.55, 1.0, aj);
    vec3 ink = card ? mix(uBlueCol, uInkCol, settled) : mix(uMarkCol, uIceCol, settled);
    col = lay(col, ink, line * uPlan * step(0.001, aj) * step(boundSd(p.xz), 0.0));
  }
  return overlays(col, p, f, pxf, px, card);
}

vec3 topTone(int id, vec2 q) {
  // paper a touch darker and warmer (~8%) so a large white slab does not glare on the dark page; the ink summit is untouched
  vec3 base = id == TOP ? uInkCol : uSheetCol * vec3(0.945, 0.915, 0.87) * (0.97 + 0.05 * hash1(float(id) * 7.31));
  base *= 0.985 + 0.03 * vnoise(q * 46.0 + float(id) * 3.1);
  return mix(mix(base, uBlueCol, 0.32), base, smoothstep(0.55, 1.0, arrival(id))); // still settling: a proposed change
}

vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  c = mix(c, 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) / 0.2)), step(0.8, c)); // soft shoulder for raking light
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, 12.92 * c, step(c, vec3(0.0031308)));
}

vec3 viewRay() {
  vec2 ndc = gl_FragCoord.xy / uResolution * 2.0 - 1.0;
  vec4 v = uProjInv * vec4(ndc, 1.0, 1.0);
  return normalize((uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz);
}

#ifdef PLAN
// ================================================================ plan: read the plate from above
void main() {
  vec3 rd = viewRay();
  vec3 ro = uCamPos;
  // find the sheet under this pixel, then meet the ray at that sheet's height
  vec3 p = ro + rd * (-ro.y / rd.y);
  p = ro + rd * ((topY(layerAt(field(p.xz))) - ro.y) / rd.y);
  float f = field(p.xz);
  float pxf = clamp(fwidth(f), 1e-5, 3.0 * uPxWorld);
  float b = boundSd(p.xz);
  int iL = b > 0.0 ? -1 : layerAt(f);
  // the base sheet's edge, anti-aliased: pixels half a texel outside it still carry its card
  float a0 = (b > 0.0 || arrival(0) <= 0.0) ? 0.0 : clamp((layerR(0, arrival(0)) - f) / pxf + 0.5, 0.0, 1.0);
  int i = (iL < 0 && a0 > 0.0) ? 0 : iL;
  float H = topY(i);

  float sh = 1.0;
  if (uShadows > 0.5 && i >= 0 && i < TOP && b <= 0.0) {
    // walls of higher sheets, sampled toward the sun across the plate
    vec2 sdir = normalize(uSunDir.xz + vec2(1e-5));
    float rise = uSunDir.y / max(length(uSunDir.xz), 1e-3);
    for (int k = uZero; k < 7; k++) {
      float t = 0.01 + 0.034 * float(k);
      float hj = topY(layerAt(field(p.xz + sdir * t)));
      sh = min(sh, smoothstep(-0.004, 0.014, H + t * rise - hj));
    }
  }
  float occ = 1.0;
  if (i >= 0 && i < TOP && b <= 0.0) {
    float aj = arrival(i + 1);
    if (aj > 0.0) occ = mix(0.78, 1.0, smoothstep(0.0, 0.055, f - layerR(i + 1, aj)));
  }
  // no board: the plate is transparent where no card stands, and only the survey marks draw there
  vec4 o = i < 0 ? vec4(0.0) : vec4(topTone(i, p.xz) * relLight(max(uSunDir.y, 0.0), sh, occ, 1.0), i == 0 ? a0 : 1.0);
  if (i >= 0) {
    // the galactic core rims the edges that face it: a thin warm gradient inside each card's outer edge (before the ink, so linework stays crisp)
    vec2 rs = (uRimDir * mat3(uCamWorld)).xy; // core direction on screen (view-space xy)
    float face = max(dot(normalize(vec2(dFdx(f), dFdy(f)) + 1e-9), normalize(rs + 1e-5)), 0.0) * min(1.0, 1.5 * length(rs));
    float de = (layerR(i, arrival(i)) - f) / pxf;
    float band = (1.0 - smoothstep(0.5, 7.0, de)) * step(-0.5, de);
    o.rgb += max(topTone(i, p.xz), vec3(0.3)) * uRimCol * (1.3 * face * band * (i == 0 ? a0 : 1.0));
  }
  o = linework(o, p, f, pxf, uPxWorld, iL);
  fragColor = vec4((toSRGB(o.rgb) + (hash2(gl_FragCoord.xy) - 0.5) * 0.012) * o.a, o.a); // premultiplied
}

#else
// ================================================================ model: the card stack in perspective
// KERF: the laser keeps cutting. The survey plane opens along the field; the ember band and the shards mark the front.
uniform mat4 uProj;         // camera.projectionMatrix / matrixWorldInverse, for gl_FragDepth
uniform mat4 uView;
uniform float uFrontR;      // burn front in field units
uniform float uStrata;
uniform float uKerfRing;
uniform float uRiftQ;       // 0 = skip isolines, strata and glow
uniform sampler2D uNoise;
uniform vec3 uKerfCoreCol;
uniform vec3 uKerfCol;
uniform vec3 uEmberCol;

const float RIFT_AMP = 0.35;    // keep in sync with RIFT in scene.ts

float riftR0() { return uRadii[0] + 0.15; }
// the survey plane opens where f + noise falls below the front; the shard vertex shader uses the same key (RIFT_AMP)

float sheet(float fp, float y, float y0, float t) {
  const float r = 0.006;
  vec2 w = vec2(fp + r, abs(y - y0 - 0.5 * t) - 0.5 * t + r);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - r;
}

// Sheets are nested and stacked, so only the slabs around p (and the one in flight) can be nearest.
// Every skipped sheet is at least its vertical gap away, which bounds the distance safely.
float map(vec3 p, out int id) {
  float f = field(p.xz);
  float b = boundSd(p.xz);
  float s = slab();
  int settled = settledCount();
  int i0 = clamp(int(floor(p.y / s)), 0, max(settled - 1, 0));
  float d = 1e3;
  if (i0 + 2 < settled) d = float(i0 + 2) * s - p.y;
  if (i0 - 2 >= 0) d = min(d, p.y - float(i0 - 2) * s - layerT(i0 - 2));
  d = max(d, 0.0);
  id = -1;
  for (int k = 0; k < 4; k++) {
    int i = k < 3 ? i0 + k - 1 : settled; // three neighbours, then the sheet in flight
    if (i < 0 || i > TOP || (k < 3 && i >= settled) || arrival(i) <= 0.0) continue;
    float a = arrival(i);
    float v = sheet(max(f - layerR(i, a), b), p.y, layerY0(i, a), layerT(i));
    if (v < d) { d = v; id = i; }
  }
  return max(d, p.z - uCutZ);
}

bool box(vec3 ro, vec3 rd, out float t0, out float t1) {
  vec3 lo = vec3(uDomain.x, 0.0, uDomain.y);
  vec3 hi = vec3(uDomain.x + uDomain.z, stackTop(), uDomain.y + uDomain.w);
  vec3 inv = 1.0 / (rd + vec3(1e-9) * step(abs(rd), vec3(1e-9)));
  vec3 ta = (lo - ro) * inv;
  vec3 tb = (hi - ro) * inv;
  vec3 mn = min(ta, tb);
  vec3 mx = max(ta, tb);
  t0 = max(max(mn.x, mn.y), mn.z);
  t1 = min(min(mx.x, mx.y), mx.z);
  return t1 > max(t0, 0.0);
}

vec3 tap(int i) { return 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0); }
float aoStep(int i) { return 0.012 + 0.02 * float(i); }

// Starts the shadow ray toward the sun; returns false when there is nothing to march.
bool shadowStart(vec3 hp, vec3 n, out vec3 so, out float st, out float stEnd) {
  so = hp + n * 0.003;
  float a, b;
  bool hit = uShadows > 0.5 && dot(n, uSunDir) > 0.0 && box(so, uSunDir, a, b);
  st = max(a, 0.004);
  stEnd = b;
  return hit;
}

vec3 poche(vec3 p, int id, float px) {
  if (id == TOP) return uInkCol;
  // solid card core: sheet stock a shade darker than the face, with a fibre striation along the sheet
  // (faded out before a fibre drops under ~2 pixels), and ink seams between the layers
  float seam = abs(fract(p.y / slab() + 0.5) - 0.5) * slab();
  float fa = 1.0 - smoothstep(0.25, 0.5, px * 260.0);
  vec3 c = uSheetCol * (0.86 + (vnoise(vec2(p.x * 18.0, p.y * 260.0)) - 0.5) * 0.1 * fa);
  float sw = max(0.0012, 0.6 * px); // layer seams never go sub-pixel
  return mix(uInkCol, c, smoothstep(sw, 2.0 * sw, seam));
}

void main() {
  vec3 rd = viewRay();
  vec3 ro = uCamPos;
  float tGround = rd.y < -1e-5 ? -ro.y / rd.y : -1.0; // the invisible survey plane: it only carries marks
  float t0, t1;
  bool inBox = uBuilt > 0.0 && box(ro, rd, t0, t1);

  // phases: 0 march, 1-4 normal taps, 5 shadow ray, 6-9 occlusion taps, 10 done
  int phase = 0;
  int kind = 0;       // 0 nothing (transparent), 1 sheet, 2 survey plane
  int id = -1;
  int prim = 0;
  float t = max(t0, 0.0);
  vec3 hp = ro + rd * 1e4;
  vec3 nrm = vec3(0.0);
  vec3 so = vec3(0.0);
  float st = 0.0;
  float stEnd = 0.0;
  float sh = 1.0;
  float occ = 0.0;
  float sca = 1.0;
  float eps = 0.0012;   // normal taps widen with the pixel, so distant edges do not sparkle
  // closest approach of a missed ray, in pixels of the ray's own width: the silhouette is anti-aliased from it
  float mn = 1e3;
  vec3 qm = ro;
  float tm = 0.0;
  int idm = -1;
  float edgeA = 1.0;

  if (!inBox) {
    // outside the model's bounding box there is nothing to march: at most the survey plane
    phase = 10;
    if (tGround > 0.0) {
      kind = 2;
      hp = ro + rd * tGround;
    }
  }

  for (int k = uZero; k < 300; k++) {
    if (phase >= 10) break;
    vec3 q = phase == 0 ? ro + rd * t
           : phase < 5 ? hp + tap(phase - 1) * eps
           : phase == 5 ? so + uSunDir * st
           : hp + nrm * aoStep(phase - 6);
    int hid;
    float d = map(q, hid);
    // Seen from above, the stack is terraced: above the highest sheet at a point, a ray may travel until it
    // drops onto that sheet or reaches the edge of the next one up, however close it skims. Grazing views
    // cost a few steps instead of hundreds. Every bound is conservative: coarse sheets reach at most 0.3
    // further, a cut or a boundary only removes material, and below the envelope the ray simply marches.
    float leap = 0.0;
    if (phase == 0 || phase == 5) {
      vec3 dir = phase == 0 ? rd : uSunDir;
      float fq = field(q.xz) - 0.3 * uCoarse;
      float bq = boundSd(q.xz);
      int iq = bq > 0.0 ? -1 : layerAt(fq);
      float clear = q.y - topY(iq);
      if (clear > 0.0) {
        float down = dir.y < 0.0 ? clear / -dir.y : 1e3;
        float edge = iq < TOP ? fq - uRadii[iq + 1] : 1e3;
        if (bq > 0.0) edge = max(edge, bq);
        leap = min(down, 0.8 * edge / max(length(dir.xz), 1e-3));
      }
    }

    if (phase == 0) {
      float pw = uPxWorld * t / uTargetDist;
      if (d < 0.3 * pw) {
        kind = 1;
        hp = q;
        eps = max(0.0012, 0.6 * pw);
        id = hid;
        phase = 1;
      } else {
        if (hid >= 0 && d < mn * pw) { mn = d / max(pw, 1e-6); qm = q; tm = t; idm = hid; }
        t += max(d * 0.8, leap);
        prim++;
        if (t > t1 || float(prim) >= uSteps) {
          if (mn < 0.9) {
            // grazed the silhouette: shade the closest-approach point, carrying partial coverage
            kind = 1;
            hp = qm;
            eps = max(0.0012, 0.6 * uPxWorld * tm / uTargetDist);
            id = idm;
            edgeA = clamp(1.0 - (mn - 0.3) / 0.6, 0.0, 1.0);
            phase = 1;
          } else if (tGround > 0.0) {
            kind = 2;
            hp = ro + rd * tGround;
            phase = 10;
          } else {
            phase = 10;
          }
        }
      }
    } else if (phase < 5) {
      nrm += tap(phase - 1) * d;
      phase++;
      if (phase == 5) {
        nrm = normalize(nrm);
        if (!shadowStart(hp, nrm, so, st, stEnd)) phase = 6;
      }
    } else if (phase == 5) {
      sh = min(sh, 9.0 * d / st);
      st += max(clamp(d * 0.85, 0.008, 0.35), leap);
      if (sh < 0.002 || st > stEnd) phase = 6;
    } else {
      occ += (aoStep(phase - 6) - d) * sca;
      sca *= 0.8;
      phase++;
    }
  }

  sh = clamp(sh, 0.0, 1.0);
  sh = sh * sh * (3.0 - 2.0 * sh);
  float ao = clamp(1.0 - 2.4 * occ, 0.0, 1.0);
  float dist = kind == 0 ? 1e4 : length(hp - ro);
  float px = uPxWorld * dist / uTargetDist;
  float f = field(hp.xz);
  float pxf = clamp(fwidth(f), 1e-5, 3.0 * px);

  // ---- KERF: where is this survey-plane pixel relative to the front? e > 0 = inside the cut, in band widths
  float R0 = riftR0();
  bool burning = uFrontR > R0 + 0.002;
  float e = -2.0;
  if (burning) {
    float key = f + RIFT_AMP * textureLod(uNoise, hp.xz * 0.02, 0.0).r;
    float w = 0.06 + 1.5 * min(fwidth(key), 0.2);
    e = (uFrontR - key) / w;
  }
  bool gone = kind == 2 && e > 0.0;

  // straight colour + coverage; the plate canvas is transparent and premultiplied
  vec4 o = vec4(0.0);
  if (kind == 1) {
    bool cut = abs(hp.z - uCutZ) < 0.004 && nrm.z > 0.7;
    float top = smoothstep(0.4, 0.75, nrm.y);
    vec3 base;
    if (cut) base = poche(hp, id, px);
    else {
      // laser-cut edge: charred card, faintly striated by the beam
      float stri = 0.93 + 0.07 * hash1(floor(hp.y * 2400.0) + float(id) * 17.0);
      vec3 wall = mix(uBlueCol, (id == TOP ? uInkCol * 1.5 : uCharCol) * stri, smoothstep(0.55, 1.0, arrival(id)));
      base = mix(wall, topTone(id, hp.xz), top);
    }
    // card tops are wrap-lit
    float ndl = dot(nrm, uSunDir);
    vec3 col = base * relLight(mix(max(ndl, 0.0), clamp((ndl + 0.25) / 1.25, 0.0, 1.0), top), sh, ao, nrm.y);
    float bev = 4.0 * top * (1.0 - top); // the 0.006 bevel between face and edge
    if (!cut) {
      // catch-light on the bevel; the obsidian summit shines more
      float nh = pow(max(dot(nrm, normalize(uSunDir - rd)), 0.0), 48.0);
      float cg = id == TOP ? max(bev, 0.6 * top) * 0.35 : bev * 0.18;
      col += uSunCol / (uSunCol * max(uSunDir.y, 0.0) + uAmbCol) * nh * cg * sh;
      // strata: each sheet's edge lights ember from the bottom up, so the build is read again in light
      if (uRiftQ > 0.5 && uStrata > 0.0) col += uKerfCol * clamp(uStrata - float(id), 0.0, 1.0) * bev * (id == TOP ? 1.9 : 1.2);
    }
    // the galactic core rims the card edges and bevels (not the flat faces), brightest on the summit
    float fres = pow(1.0 - clamp(dot(nrm, -rd), 0.0, 1.0), 2.0);
    col += (id == TOP ? max(base, vec3(0.3)) * 1.6 : base) * uRimCol * 1.8 * pow(max(dot(nrm, uRimDir), 0.0), 1.5) * (1.0 - top) * (0.4 + 0.6 * fres) * ao;
    o = vec4(col, edgeA);
    if (top > 0.5 && !cut) o = linework(o, hp, f, pxf, px, id);
  } else if (kind == 2) {
    // survey marks only, as light; a mark is gone where the front has passed
    o = linework(vec4(0.0), hp, f, pxf, px, -1);
    if (gone) o.a = 0.0;
    if (burning) {
      // the kerf itself: white-hot core, ember tail, and an analytic glow standing in for bloom
      float ec = clamp(e, 0.0, 1.0);
      vec3 ramp = mix(mix(uKerfCoreCol, uKerfCol, smoothstep(0.0, 0.25, ec)), uEmberCol, smoothstep(0.25, 1.0, ec));
      float band = smoothstep(-0.15, 0.0, e) * (1.0 - smoothstep(0.55, 1.0, e));
      float glow = uRiftQ > 0.5 ? 0.6 * exp(-6.0 * abs(e)) : 0.0;
      vec3 em = ramp * band * 1.6 + uKerfCol * glow;
      float m = max(em.r, max(em.g, em.b));
      o = lay(o, em / max(m, 1e-4), m);
    }
    // foreshadow: an ember hairline ignites on the ring just outside the base and traces round it
    if (!gone && uKerfRing > 0.0) {
      vec2 c = uDomain.xy + 0.5 * uDomain.zw;
      float ang = atan(hp.z - c.y, hp.x - c.x) * 0.15915494 + 0.5;
      float arc = 1.0 - smoothstep(uKerfRing - 0.02, uKerfRing, ang);
      float head = exp(-40.0 * max(uKerfRing - ang, 0.0));
      o = lay(o, mix(uKerfCol, uKerfCoreCol, clamp(head, 0.0, 1.0)), ring(f, R0, pxf, 1.1) * arc);
    }
  }

  vec4 clip = uProj * (uView * vec4(hp, 1.0));
  gl_FragDepth = (kind == 0 || (kind == 2 && o.a < 0.004)) ? 1.0 : clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
  fragColor = vec4((toSRGB(o.rgb) + (hash2(gl_FragCoord.xy) - 0.5) * 0.012) * o.a, o.a); // premultiplied
}
#endif
`

// ---------------------------------------------------------------- KERF shards: flakes released where the plate opens
// THREE.Points on a ShaderMaterial (GLSL3), blending AdditiveBlending + premultipliedAlpha:true, transparent, depthTest on, depthWrite off.
// Attributes: position = (x, 0, z) start point on the plate (random xz in the annulus R0..30, density ~ 1/r);
//             aSeed    = vec4 of random 0..1 (x size, y unused, z outward drift, w lift).
// Uniforms (all shared with the plate material): uProj, uView, uResolution, uField, uDomain, uNoise, uRadii, uFrontR,
//             uKerfCoreCol, uKerfCol, uIceCol. No clock: a flake's whole life is a function of the burn front, so rendering stays on demand.
export const shardVert = /* glsl */ `
precision highp float;
precision highp int;
in vec4 aSeed;
uniform mat4 uProj;
uniform mat4 uView;
uniform vec2 uResolution;
uniform sampler2D uField;
uniform vec4 uDomain;
uniform sampler2D uNoise;
uniform float uRadii[13];
uniform float uFrontR;
out float vAge;

float field(vec2 p) {
  vec2 c = clamp((p - uDomain.xy) / uDomain.zw, 0.0, 1.0);
  return textureLod(uField, c, 0.0).r + length(p - uDomain.xy - c * uDomain.zw);
}

void main() {
  vec2 xz = position.xz;
  // the same key as the plate shader's front key (RIFT_AMP 0.35, AGE 0.5), so a flake lifts exactly where the plate opens
  float k = field(xz) + 0.35 * textureLod(uNoise, xz * 0.02, 0.0).r;
  float age = (uFrontR - k) / 0.5;
  if (uFrontR <= uRadii[0] + 0.152 || age <= 0.0 || age >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vAge = 1.0;
    return;
  }
  vec2 c0 = uDomain.xy + 0.5 * uDomain.zw;
  vec2 out2 = normalize(xz - c0 + vec2(1e-4));
  vec2 curl = textureLod(uNoise, xz * 0.05 + vec2(age * 0.3), 0.0).rg - 0.5;
  vec3 world = vec3(xz + out2 * 0.6 * age * (0.7 + 0.6 * aSeed.z) + curl * 0.8 * age,
                    0.01 + 2.4 * age * age * (0.6 + 0.8 * aSeed.w)).xzy;
  vec4 vp = uView * vec4(world, 1.0);
  gl_Position = uProj * vp;
  float size = 0.05 * (0.6 + 0.8 * aSeed.x) * (1.0 - 0.4 * age); // world units
  gl_PointSize = clamp(size * uProj[1][1] * 0.5 * uResolution.y / max(-vp.z, 0.01), 1.5, 48.0);
  vAge = age;
}
`

export const shardFrag = /* glsl */ `
precision highp float;
layout(location = 0) out highp vec4 fragColor;
in float vAge;
uniform vec3 uKerfCoreCol;
uniform vec3 uKerfCol;
uniform vec3 uIceCol;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 >= 1.0) discard;
  float a = exp(-3.0 * r2) * (1.0 - r2) * (1.0 - vAge);
  // ember -> ice with age; the plate shader writes sRGB, so encode here too
  vec3 col = mix(mix(uKerfCoreCol, uKerfCol, smoothstep(0.0, 0.12, vAge)), uIceCol, smoothstep(0.15, 0.85, vAge));
  fragColor = vec4(pow(col, vec3(0.4545)) * a, a); // premultiplied, additive-friendly
}
`
