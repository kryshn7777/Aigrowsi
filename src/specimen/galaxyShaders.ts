// Cosmos shaders (GLSL3, three r186). Disc tier: GPU map bake, map-textured planes, Sersic bulge billboard,
// catalogue star points, deep-field ellipses, and the composite (tonemap 1 - e^-x, sRGB, dither).
// All light is summed in linear HalfFloat; nothing here animates.
// Keep the arm law in sync with GAL in galaxy.ts (R0 .886, tanPhi .4451, warp .6, spurs .25, truncation 14.5..17.5).

const noise = /* glsl */ `
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float hash21(vec2 p) {
  ivec2 i = ivec2(floor(p));
  return float(pcg(uint(i.x) + pcg(uint(i.y)))) * (1.0 / 4294967296.0);
}
vec2 hash22(vec2 p) {
  ivec2 i = ivec2(floor(p));
  uint a = pcg(uint(i.x) + pcg(uint(i.y)));
  uint b = pcg(a ^ 2654435769u);
  return vec2(float(a), float(b)) * (1.0 / 4294967296.0);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s / 0.9375;
}
`

export const fullscreenVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * Map bake, once, 1024^2 over +-20 kpc (xz): r young/arm emission, g dust, b old disk, a H-alpha.
 * psi = 2 (theta - ln(R/R0)/tanPhi) + .6 warp. The dust lane sits at psi +.55: smaller R at the same theta, the concave edge.
 * The bulge is not here (it is the billboard); the nuclear ring (R .6) is.
 */
export const mapBakeFrag = /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D uWarp;
const float R0 = 0.886;
const float TANPHI = 0.4451;
${noise}
// periodic gaussian bump in a phase angle
float lobe(float x, float c, float w) {
  return exp((cos(x - c) - 1.0) / (w * w));
}
// cellular blobs: ~30..250 pc star-forming knots
float blobs(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float m = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int k = -1; k <= 1; k++) {
      vec2 g = vec2(float(k), float(j));
      vec2 o = hash22(i + g);
      float d = length(g + o - f);
      m = max(m, exp(-d * d * 9.0) * (0.45 + 0.55 * hash21(i + g + 41.0)));
    }
  }
  return m;
}
void main() {
  vec2 xz = (vUv - 0.5) * 40.0;
  float R = length(xz);
  float th = atan(xz.y, xz.x);
  float warp = texture(uWarp, vUv).r * 2.0 - 1.0;
  float psi = 2.0 * (th - log(max(R, 1e-3) / R0) / TANPHI) + 0.6 * warp;
  float edgeFade = 1.0 - smoothstep(14.5, 17.5, R);

  float arm = pow(0.5 + 0.5 * cos(psi), 6.0);
  float spur = 0.25 * pow(0.5 + 0.5 * cos(2.0 * psi), 6.0) * smoothstep(0.25, 0.75, vnoise(xz * 0.8 + 5.0));
  float body = smoothstep(0.7, 2.4, R);
  float rad = body * exp(-max(R - 2.5, 0.0) / 7.5);
  float clump = (0.4 + 1.2 * fbm(xz * 1.6 + 3.1)) * (0.75 + 0.5 * vnoise(xz * 7.0));

  // nuclear ring, R .6 +- .06, knotty
  float ring = exp(-0.5 * pow((R - 0.6) / 0.06, 2.0));
  vec2 dir = xz / max(R, 1e-3);
  float rc = 0.35 + 1.3 * vnoise(dir * 3.0 + 11.0);

  float young = (arm + spur) * clump * rad * edgeFade + 0.8 * ring * rc;

  // H-alpha: complexes just downstream of the ridge (psi -.2)
  float hii = lobe(psi, -0.2, 0.42);
  float ha = hii * (blobs(xz * 2.2) + 0.5 * blobs(xz * 5.5 + 7.0)) * (0.35 + arm) * rad * edgeFade;
  ha = smoothstep(0.15, 0.9, ha) + ring * rc * smoothstep(0.5, 1.0, vnoise(dir * 7.0)) * 0.9;

  // dust: lane on the concave (inner) edge at psi +.55, clumpy, plus faint filaments in the spurs
  float lane = lobe(psi, 0.55, 0.3);
  float dclump = clamp(0.2 + 1.5 * fbm(xz * 2.4 + 9.0), 0.0, 1.5);
  float dr = smoothstep(0.35, 1.6, R) * (1.0 - smoothstep(13.0, 16.0, R)) * (1.0 - 0.3 * smoothstep(8.0, 14.0, R));
  float dust = (lane + 1.4 * spur) * dclump * dr;

  // old disk, mild arm modulation
  float old = exp(-R / 3.2) * edgeFade * (0.8 + 0.4 * arm * body);

  fragColor = vec4(clamp(vec4(young, dust, old, ha), 0.0, 1.0));
}
`

/**
 * Disc-tier planes (one material, three defines): EMIT (y 0: old + young + H-alpha), THICK (y +-.3: old thick disk),
 * DUST (y +-.05: absorption). Dust blend is MULTIPLY (ZERO, SRC_COLOR): dst *= exp(-tau k_RGB), true absorption of
 * everything drawn before it; the planes are drawn far to near so only the dust in front darkens.
 */
export const planeVert = /* glsl */ `
out vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`

export const planeFrag = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vW;
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D uMap;
uniform float uExpo;
uniform float uTau0;
uniform vec3 uK;
uniform float uOld;
uniform float uYoung;
uniform float uHa;
uniform float uThick;
uniform vec3 uColOld;
uniform vec3 uColYoung;
uniform vec3 uColHII;
uniform vec3 uColBulge;
uniform vec3 uColRefl;
${noise}
void main() {
  vec2 uv = vW.xz * (1.0 / 40.0) + 0.5;
  vec4 m = texture(uMap, uv);
  // near the camera the 39 pc texels would blur: modulate with fine noise, fading out beyond 3 kpc
  float nearW = 1.0 - smoothstep(0.4, 3.0, distance(vW, cameraPosition));
  if (nearW > 0.01) {
    float n = 0.6 * vnoise(vW.xz * 14.0) + 0.4 * vnoise(vW.xz * 47.0);
    float n2 = 0.6 * vnoise(vW.xz * 9.0 + 5.0) + 0.4 * vnoise(vW.xz * 31.0 + 3.0);
    m.r *= mix(1.0, 0.35 + 1.3 * n, nearW);
    m.a *= mix(1.0, 0.3 + 1.4 * n2, nearW);
    m.g *= mix(1.0, 0.4 + 1.2 * n2, nearW);
  }
#if defined(DUST)
  // half of the column per plane; the slant lengthens the path through the slab
  vec3 vd = normalize(vW - cameraPosition);
  float slant = 1.0 / max(abs(vd.y), 0.12);
  fragColor = vec4(exp(-uTau0 * 0.5 * m.g * slant * uK), 1.0);
#elif defined(THICK)
  fragColor = vec4(uExpo * uThick * uOld * m.b * mix(uColOld, uColBulge, 0.5), 0.0);
#else
  vec3 E = uOld * m.b * uColOld + uYoung * m.r * uColYoung + uHa * m.a * uColHII;
  // dust reflection, at most 8% of the local light
  E += 0.08 * m.g * dot(E, vec3(0.3, 0.59, 0.11)) * 1.6 * uColRefl;
  fragColor = vec4(uExpo * E, 0.0);
#endif
}
`

/**
 * Volume march (replaces the disc planes), one fullscreen quad into a low-res HalfFloat target: rgb = emission (premultiplied by the
 * transmittance in front of it, times exposure), a = green-channel transmittance (the other channels are T^k, since tau_rgb = tau k_rgb).
 * Ray = camera through the pixel (projectionMatrixInverse carries the lens shift); intersect the slab |y| <= 2.2 and the cylinder R <= 18
 * first, march only inside. The step is max(clamp(.3|y| + .004 t, .012, 1.2), a geometric ramp) where the ramp is sized so that
 * uSteps steps always reach the far side (edge-on views, camera inside the disk); the ramp is flat unless the entry point is near the camera.
 * Vertical structure is integrated exactly per step (exponential profiles), so a thin dust lane is never stepped over; only the map
 * (horizontal) is point-sampled, at an interleaved-gradient-noise jittered position inside the step, with the mip chosen from the footprint.
 * Emission per kpc of path integrates to the plane version's column: old uOld m.b over h .22 plus a thick term (2 uThick uOld, h .7),
 * young uYoung m.r and H-alpha uHa m.a over h .09; dust tau = uTau0 m.g (0.5 / .07) e^(-|y|/.07) dl, times (.55 + .9 n3) near the camera.
 */
export const marchFrag = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;
in vec2 vUv;
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D uMap;
uniform sampler3D uNoise;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform int uSteps;
uniform int uZero;   // always 0: keeps the compiler from unrolling the loop
uniform float uOct;  // near-camera dust octaves: 1 or 2
uniform float uPix;  // angle of one volume pixel (rad)
uniform float uExpo;
uniform float uTau0;
uniform vec3 uK;
uniform float uOld;
uniform float uYoung;
uniform float uHa;
uniform float uThick;
uniform float uRefl;
uniform vec3 uColOld;
uniform vec3 uColYoung;
uniform vec3 uColHII;
uniform vec3 uColBulge;
uniform vec3 uColRefl;
const float RMAX = 18.0;
const float YMAX = 2.2;
// mean of e^(-|y|/h) along a step that runs from height y0 to y1
float vavg(float y0, float y1, float h) {
  float dy = abs(y1 - y0);
  if (dy < 0.08 * h) return exp(-abs(0.5 * (y0 + y1)) / h);
  float e0 = exp(-abs(y0) / h);
  float e1 = exp(-abs(y1) / h);
  float num = (y0 * y1 < 0.0) ? 2.0 - e0 - e1 : abs(e0 - e1);
  return min(1.0, h * num / dy);
}
void main() {
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 0.0, 1.0);
  vec3 rd = normalize(mat3(uCamWorld) * (vp.xyz / vp.w));
  vec3 ro = uCamPos;
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);

  // slab, then cylinder
  float iy = 1.0 / (abs(rd.y) < 1e-5 ? 1e-5 : rd.y);
  float s0 = (-YMAX - ro.y) * iy;
  float s1 = (YMAX - ro.y) * iy;
  float tn = min(s0, s1);
  float tf = max(s0, s1);
  float qa = dot(rd.xz, rd.xz);
  float qb = dot(ro.xz, rd.xz);
  float qc = dot(ro.xz, ro.xz) - RMAX * RMAX;
  if (qa > 1e-8) {
    float disc = qb * qb - qa * qc;
    if (disc < 0.0) return;
    float sq = sqrt(disc);
    tn = max(tn, (-qb - sq) / qa);
    tf = min(tf, (-qb + sq) / qa);
  } else if (qc > 0.0) {
    return;
  }
  tn = max(tn, 0.0);
  if (tf <= tn) return;

  float N = float(uSteps);
  float q = max(0.15 * (1.0 - smoothstep(2.0, 10.0, tn)), 0.002);
  float b0 = (tf - tn) * q / (pow(1.0 + q, N) - 1.0);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float t = tn;
  float g = 1.0;
  vec3 E = vec3(0.0);
  vec3 T = vec3(1.0);
  for (int i = 0; i < 48 + uZero; i++) {
    if (i >= uSteps || t >= tf || T.g < 0.004) break;
    float dt = max(clamp(0.3 * abs(ro.y + rd.y * t) + 0.004 * t, 0.012, 1.2), b0 * g);
    g *= 1.0 + q;
    dt = min(dt, tf - t);
    float ts = t + dt * fract(jit + float(i) * 0.6180339887);
    vec3 p = ro + rd * ts;
    float y0 = ro.y + rd.y * t;
    float y1 = y0 + rd.y * dt;
    t += dt;

    float foot = max(ts * uPix, 0.5 * dt * length(rd.xz));
    vec4 m = textureLod(uMap, p.xz * (1.0 / 40.0) + 0.5, clamp(log2(max(foot / 0.039, 1.0)), 0.0, 6.0));

    // fine dust detail near the camera, two octaves (lambda .15 / .05) fading in within 3 kpc
    float nearW = 1.0 - smoothstep(0.4, 3.0, ts);
    float fd = 1.0;
    if (nearW > 0.01) {
      vec2 n = textureLod(uNoise, p / 1.2, 0.0).rg;
      if (uOct > 1.5) n = 0.65 * n + 0.35 * textureLod(uNoise, p / 0.4 + 0.37, 0.0).rg;
      fd = mix(1.0, 0.55 + 0.9 * n.g, nearW);
      m.r *= mix(1.0, 0.35 + 1.3 * n.r, nearW);
      m.a *= mix(1.0, 0.3 + 1.4 * n.r, nearW);
    }

    float aThin = vavg(y0, y1, 0.22);
    float aThick = vavg(y0, y1, 0.7);
    float aYoung = vavg(y0, y1, 0.09);
    float aDust = vavg(y0, y1, 0.07);
    float edge = 1.0 - smoothstep(1.6, 2.2, abs(0.5 * (y0 + y1)));

    vec3 J = uOld * m.b * (aThin * (0.5 / 0.22)) * uColOld
           + uOld * uThick * 2.0 * m.b * (aThick * (0.5 / 0.7)) * mix(uColOld, uColBulge, 0.5)
           + aYoung * (0.5 / 0.09) * (uYoung * m.r * uColYoung + uHa * m.a * uColHII);
    J *= edge;
    float dd = m.g * fd * aDust;
    // faint dust reflection of the local light (blue), never more than a few percent
    J += uRefl * dd * dot(J, vec3(0.3, 0.59, 0.11)) * uColRefl;

    vec3 tau = uTau0 * dd * (0.5 / 0.07) * dt * uK;
    vec3 att = exp(-tau);
    // mean transmittance over the step: (1 - e^-tau) / tau, series for small tau
    vec3 mt = mix(1.0 - tau * (0.5 - tau * 0.16667), (1.0 - att) / max(tau, vec3(1e-3)), step(0.4, tau));
    E += T * J * (dt * mt);
    T *= att;
  }
  fragColor = vec4(E * uExpo, T.g);
}
`

/** The volume target composited onto the main target: MULT = dst *= T^k (blend ZERO, SRC_COLOR), ADD = dst += emission. Both read the same texture. */
export const volCompFrag = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D uVol;
uniform vec3 uK;
void main() {
  vec4 v = texture(uVol, vUv);
#if defined(MULT)
  fragColor = vec4(pow(vec3(clamp(v.a, 1e-4, 1.0)), uK), 1.0);
#else
  fragColor = vec4(max(v.rgb, 0.0), 0.0);
#endif
}
`

/** Sersic bulge billboard (n 2.5, b 4.67, Re .85, q .72): an oblate spheroid projected to its apparent ellipse, plus a 30 pc nucleus. */
export const bulgeVert = /* glsl */ `
uniform float uHalf;
out vec2 vP;
out vec3 vSpin;
void main() {
  vec2 c = position.xy * uHalf;
  vP = c;
  vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vSpin = viewMatrix[1].xyz; // world +y on the view axes (right, up, back)
  gl_Position = projectionMatrix * viewMatrix * vec4(r * c.x + u * c.y, 1.0);
}
`

export const bulgeFrag = /* glsl */ `
precision highp float;
in vec2 vP;
in vec3 vSpin;
layout(location = 0) out highp vec4 fragColor;
uniform float uExpo;
uniform float uIe;
uniform float uNuc;
uniform vec3 uColBulge;
uniform vec3 uColCore;
const float RE = 0.85;
const float N = 2.5;
const float B = 4.67;
const float Q = 0.72;
void main() {
  float sl = length(vSpin.xy);
  float ci = abs(vSpin.z); // cos of the inclination from face-on
  float qp = sqrt(ci * ci + Q * Q * (1.0 - ci * ci));
  vec2 m = sl > 1e-3 ? vSpin.xy / sl : vec2(0.0, 1.0);
  float a = dot(vP, m) / qp; // along the projected spin axis the ellipse is squashed
  float b = dot(vP, vec2(-m.y, m.x));
  float r = sqrt(a * a + b * b);
  float rs = sqrt(r * r + 0.0016);
  float I = exp(-B * (pow(rs / RE, 1.0 / N) - 1.0)) * (1.0 - smoothstep(3.0, 5.0, length(vP)));
  vec3 col = uIe * I * uColBulge;
  col += uNuc * exp(-dot(vP, vP) / (2.0 * 0.03 * 0.03)) * uColCore;
  fragColor = vec4(uExpo * col, 0.0);
}
`

/**
 * Catalogue stars as points. F = L E / (d^2 + .02^2), I = 1 - e^-F. Core 1.5..4.5 px, a halo to 9 px when I > .8, culled below .004,
 * size clamped to ALIASED_POINT_SIZE_RANGE. Dust extinction e^(-tau k) in the VS: the fraction of the midplane column between star and
 * camera (the whole column if the ray crosses y 0, else the part above the star), read from the baked map at the crossing point.
 */
export const starVert = /* glsl */ `
precision highp float;
precision highp int;
in float aLum;
in vec4 aCol;
uniform sampler2D uMap;
uniform float uE;
uniform float uTau0;
uniform vec3 uK;
uniform float uDpr;
uniform float uPointMax;
out vec3 vCol;
out float vI;
out float vSize;
void cull() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 0.0;
  vI = 0.0;
  vCol = vec3(0.0);
  vSize = 0.0;
}
void main() {
  vec3 d = position - cameraPosition;
  float d2 = dot(d, d);
  // stars nearer than ~0.3 kpc fade out so a close super-star does not balloon into a disc
  float F = aLum * uE / (d2 + 0.0004) * smoothstep(0.3, 0.8, sqrt(d2));
  if (F < 0.004) {
    cull();
    return;
  }
  vec3 T = vec3(1.0);
  float cy = cameraPosition.y;
  bool crossing = position.y * cy < 0.0;
  float a = 0.5 * exp(-abs(position.y) / 0.07);
  float frac = crossing ? 1.0 - a : a;
  if (frac > 0.002) {
    float t = crossing ? position.y / (position.y - cy) : 0.0;
    vec2 xz = mix(position.xz, cameraPosition.xz, t);
    float g = textureLod(uMap, xz * (1.0 / 40.0) + 0.5, 1.0).g;
    float slant = 1.0 / max(abs(cy - position.y) / sqrt(d2 + 1e-8), 0.12);
    T = exp(-uTau0 * g * frac * slant * uK);
  }
  float lumT = max(dot(T, vec3(0.3, 0.59, 0.11)), 1e-3);
  float I = 1.0 - exp(-F * lumT);
  if (I < 0.004) {
    cull();
    return;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  float core = mix(1.5, 4.5, smoothstep(0.03, 0.9, I));
  float ps = clamp(mix(core, 9.0, smoothstep(0.8, 1.0, I)) * uDpr, 1.0, uPointMax);
  gl_PointSize = ps;
  vSize = ps / uDpr;
  vI = I;
  vCol = pow(aCol.rgb, vec3(2.2)) * T / lumT;
}
`

export const starFrag = /* glsl */ `
precision highp float;
in vec3 vCol;
in float vI;
in float vSize;
layout(location = 0) out highp vec4 fragColor;
uniform float uGain;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  float k = mix(1.0, 3.6, smoothstep(1.5, 6.0, vSize));
  float halo = smoothstep(4.5, 9.0, vSize);
  float prof = mix(exp(-k * r2), 0.65 * exp(-22.0 * r2) + 0.35 * exp(-3.0 * r2), halo) * (1.0 - smoothstep(0.6, 1.0, r2));
  fragColor = vec4(vCol * (vI * uGain * prof), 0.0);
}
`

/** Deep field: ellipses 2..9 px at 1.5..8 Mpc (true 3D positions, so they show parallax), log-normal flux. */
export const deepVert = /* glsl */ `
precision highp float;
in vec4 aD;
in vec4 aCol;
uniform float uFocal;
uniform float uDpr;
uniform float uPointMax;
uniform float uExpo;
out vec3 vCol;
out vec4 vP;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  // pulled far back (the fields, the deep field) the small galaxies get brighter and larger so they read as galaxies
  float far = smoothstep(80.0, 300.0, length(cameraPosition));
  gl_PointSize = min(clamp(aD.y * uFocal * (1.0 + 0.6 * far), 1.5, 12.0) * uDpr, uPointMax);
  vCol = pow(aCol.rgb, vec3(2.2)) * aD.x * uExpo * (1.0 + 11.0 * far);
  vP = vec4(aD.z, aD.w, floor(aCol.a * 3.0 + 0.5), fract(aD.x * 7919.0));
}
`

export const deepFrag = /* glsl */ `
precision highp float;
precision highp int;
in vec3 vCol;
in vec4 vP;
layout(location = 0) out highp vec4 fragColor;
${noise}
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vP.y);
  float s = sin(vP.y);
  p = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  float r = sqrt(p.x * p.x + (p.y * p.y) / (vP.x * vP.x));
  float prof;
  if (vP.z < 0.5) prof = exp(-6.5 * r);
  else if (vP.z < 1.5) prof = exp(-4.5 * r) + 0.9 * exp(-28.0 * r * r);
  else prof = exp(-3.5 * r) * (0.55 + 0.9 * vnoise(p * 3.0 + vP.w * 40.0));
  fragColor = vec4(vCol * prof * (1.0 - smoothstep(0.7, 1.0, r)), 0.0);
}
`

/** Composite: tonemap 1 - e^-x on the linear sum, lift onto --space, mild vignette, sRGB, tiny interleaved-gradient dither. */
export const compositeFrag = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out highp vec4 fragColor;
uniform sampler2D uScene;
uniform vec3 uSpace; // linear --space
float enc(float c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
void main() {
  vec3 x = max(texture(uScene, vUv).rgb, 0.0);
  float vig = 1.0 - 0.08 * smoothstep(0.4, 0.9, length(vUv - 0.5));
  vec3 c = uSpace + (1.0 - uSpace) * (1.0 - exp(-x)) * vig;
  c = vec3(enc(c.r), enc(c.g), enc(c.b));
  float dn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  fragColor = vec4(c + (dn - 0.5) / 255.0, 1.0);
}
`
