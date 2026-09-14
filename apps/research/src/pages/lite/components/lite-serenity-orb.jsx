/**
 * The living surface of the Serenity sphere.
 *
 * The CSS orb underneath is a lit glass ball, which is fine but still. The
 * founder's reference (an "ember orb" from a WebGPU shader tool) has a surface
 * that MOVES: marble veins that drift, dark smoke filaments, a bright white rim
 * where the light wraps the edge, and a film-grain finish. This is that, in a
 * raw WebGL fragment shader - no three.js, no library, ~120 lines of GLSL.
 *
 * How the picture is made, in one paragraph: simplex noise stacked five times
 * (fbm) gives cloud. Feeding that cloud back into itself as an offset twice
 * ("domain warping") bends it into the liquid, marbled look. A sine over the
 * warped field draws the veins. Thin dark filaments sit where the sine crosses
 * zero. The flat plane is then projected onto a hemisphere so the pattern
 * curls toward the edge, lit from the upper left with a glint, and a strong
 * rim light fades the edge to white the way the reference does.
 *
 * Breath: the canvas sits INSIDE .lsr-orb, which is CSS-scaled on the 12s
 * timeline, so the sphere still swells with the room for free. On top of that
 * the shader gets the breath phase - the flow runs faster and the surface
 * brightens on the inhale, then settles on the exhale.
 *
 * Fallbacks: no WebGL, or prefers-reduced-motion, and nothing mounts - the CSS
 * sphere is still there underneath. A hidden tab stops the loop.
 */
import { useEffect, useRef } from 'react'

const MAX_BACKING = 360
const FRAME_MS = 1000 / 30 - 1 // -1: rAF ticks land just under the mark on 60Hz

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_breath;
uniform float u_seed;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

/* 2D simplex noise (Ashima Arts, MIT). */
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/* Four octaves, gain 0.45: the reference is SMOOTH liquid, and a fifth
   octave at full gain turns it into frost. */
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    s += a * snoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.45;
  }
  return s;
}
/* The warp fields only steer the final one - two octaves is all they need. */
float fbm2(vec2 p) {
  return 0.55 * snoise(p) + 0.25 * snoise(p * 2.03 + vec2(17.3, 9.1));
}

vec3 ramp(float t) {
  vec3 c0 = vec3(0.13, 0.10, 0.48);
  vec3 c1 = vec3(0.26, 0.22, 0.86);
  vec3 c2 = vec3(0.23, 0.51, 0.96);
  vec3 c3 = vec3(0.49, 0.83, 0.99);
  vec3 c4 = vec3(0.86, 0.93, 1.00);
  t = clamp(t, 0.0, 1.0) * 4.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
  float r = length(uv);
  float disc = 1.0 - smoothstep(0.975, 1.0, r);
  if (disc <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = vec3(uv, z);

  /* Fold the plane onto the sphere (refraction) so the marble bends toward
     the rim. Small scale: a handful of big swirls, not a texture. */
  vec2 p = uv / (z + 0.6) * 0.8 + u_seed;
  float t = u_time;

  vec2 q = vec2(fbm2(p + vec2(0.0, t * 0.11)), fbm2(p + vec2(5.2, 1.3) - t * 0.09));
  /* Warp gently. Every unit of warp multiplies the frequency of what comes
     out; at 2x+ the surface turns into oil-slick scribble. */
  vec2 w = vec2(fbm2(p + 1.1 * q + vec2(1.7, 9.2) + t * 0.07), fbm2(p + 1.1 * q + vec2(8.3, 2.8) - t * 0.05));
  vec2 pw = p + 0.9 * w;
  float v = fbm(pw);

  float veins = 0.5 + 0.5 * sin((p.x + p.y * 0.7) * 1.1 + v * 2.6 + t * 0.12);
  float cloud = clamp(0.5 + 0.6 * v, 0.0, 1.0);
  float tone = smoothstep(0.06, 0.94, mix(cloud, veins, 0.35));
  vec3 col = ramp(tone);

  /* Dark smoke: the zero-crossings of ONE low octave over the warped field.
     Contours of the full fbm are the topographic scribble; one octave gives
     the few broad soft streaks the reference has. */
  float smoke = snoise(pw * 0.75 + vec2(t * 0.03, 0.0));
  float fil = smoothstep(0.5, 0.0, abs(smoke));
  col *= 1.0 - 0.45 * fil;

  /* Light from the upper left, a glint, and the rim that wraps to white. */
  vec3 L = normalize(vec3(-0.55, 0.62, 0.72));
  float diff = 0.62 + 0.38 * max(dot(n, L), 0.0);
  col *= diff;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  col += vec3(1.0) * pow(max(dot(n, H), 0.0), 36.0) * 0.45;
  float edge = 1.0 - z;
  col += vec3(0.6, 0.78, 1.0) * pow(edge, 1.4) * 0.5;
  col = mix(col, vec3(0.95, 0.98, 1.0), pow(edge, 1.6));

  /* Inhale: brighter. Exhale: settled. */
  col *= 0.9 + 0.2 * u_breath;
  col = (col - 0.5) * 1.1 + 0.5;

  /* Film grain, refreshed each frame. */
  col += (hash(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) * 0.035;

  col = clamp(col, 0.0, 1.0);
  gl_FragColor = vec4(col * disc, disc);
}
`

/** The CSS breath: 0-33% in, 33-50% hold, 50-100% out, ease-in-out on each leg. */
function easeInOut(x) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}
function breathAt(phase) {
  if (phase < 1 / 3) return easeInOut(phase * 3)
  if (phase < 0.5) return 1
  return 1 - easeInOut((phase - 0.5) * 2)
}

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[serenity-orb] shader failed:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export default function SerenityOrbCanvas({ cycleMs = 12000 }) {
  const ref = useRef(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined

    let gl
    try {
      gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'low-power' })
    } catch { gl = null }
    if (!gl) return undefined

    const vs = compile(gl, gl.VERTEX_SHADER, VERT)
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return undefined
    const prog = gl.createProgram()
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[serenity-orb] link failed:', gl.getProgramInfoLog(prog))
      return undefined
    }
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(prog, 'a_pos')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    const uRes = gl.getUniformLocation(prog, 'u_res')
    const uTime = gl.getUniformLocation(prog, 'u_time')
    const uBreath = gl.getUniformLocation(prog, 'u_breath')
    const uSeed = gl.getUniformLocation(prog, 'u_seed')
    gl.uniform1f(uSeed, Math.random() * 40)

    // Budget, not fidelity: the surface is smooth by design, so it is drawn
    // into a buffer of at most MAX_BACKING px and upscaled by the compositor.
    // A 380px orb on a 2x screen would otherwise be 620K fragments a frame;
    // this is ~130K. Nobody can tell on a soft marble, and a laptop stays
    // cool.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const side = Math.min(MAX_BACKING, Math.round(Math.max(canvas.clientWidth, canvas.clientHeight) * dpr))
      const w = Math.max(1, side)
      const h = Math.max(1, side)
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      // Always, not only on change: a remount (StrictMode) reuses a canvas
      // that is already the right size, and a fresh program with u_res left
      // at zero draws nothing at all.
      gl.viewport(0, 0, w, h)
      gl.uniform2f(uRes, w, h)
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(canvas)

    // Flow time is accumulated, not read off the clock, so the surface speeds
    // up on the inhale without any visible jump.
    const start = performance.now()
    let last = start
    let flow = 0
    let raf = 0
    let running = true

    const frame = (now) => {
      if (!running) return
      // 30fps is plenty for a drift this slow, and it halves (or thirds, on a
      // 90/120Hz screen) the GPU time. The clock stays continuous, so the
      // skipped frames cost nothing in smoothness of the motion itself.
      if (now - last < FRAME_MS) {
        raf = requestAnimationFrame(frame)
        return
      }
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const breath = breathAt(((now - start) % cycleMs) / cycleMs)
      flow += dt * (0.55 + 0.75 * breath)
      gl.uniform1f(uTime, flow)
      gl.uniform1f(uBreath, breath)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(frame)
    }
    const onVis = () => {
      if (document.hidden) {
        running = false
        cancelAnimationFrame(raf)
      } else if (!running) {
        running = true
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(frame)

    return () => {
      running = false
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      ro?.disconnect()
      // 🪤 No loseContext() here. StrictMode runs mount → cleanup → mount on
      // the same canvas, and getContext() hands back the SAME (now dead)
      // context on the second pass: every shader fails with a null log and
      // the sphere paints solid white. The context dies with the canvas.
    }
  }, [cycleMs])

  return <canvas ref={ref} className="lsr-orb-canvas" aria-hidden />
}
