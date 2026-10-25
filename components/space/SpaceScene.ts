/**
 * Space view — a light, smooth 3D scene of the Sun, Earth, Mars and the cargo rockets.
 *
 * Accuracy: planet positions from the JPL elements (lib/engine/ephemeris), the rockets fly the
 * real Lambert transfer for the next launch window. Planets are drawn much bigger than real
 * so you can see them; their positions are true.
 *
 * Performance choices: 2K textures, no post-processing, stars as one Points draw call,
 * OrbitControls with damping (smooth rotate + zoom), pixel ratio ≤ 1.5, rendering stops when
 * the tab is hidden, nothing allocated inside the render loop.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { helio, gmst, marsW, lightDelaySec, earthMarsKm } from '@/lib/engine/ephemeris';
import { trajectoryPoints, transfer } from '@/lib/engine/lambert';

const AU = 10;                    // 1 AU = 10 scene units
const R_SUN = 0.9, R_E = 0.32, R_M = 0.22;
const D = Math.PI / 180;

export type Focus = 'system' | 'earth' | 'mars' | 'rocket' | 'sun';
export interface Colony { slug: string; name: string; lat: number; lon: number; status: string }
export interface SpaceInfo {
  dateIso: string; daysToLaunch: number; daysSinceLaunch: number; tofDays: number;
  earthMarsMkm: number; delayMin: number; phase: 'waiting' | 'flying' | 'arrived';
}

/** ecliptic (x, y, z) in AU → scene (x, z-up → y-up) */
const toScene = (p: { x: number; y: number; z: number }, out: THREE.Vector3) => out.set(p.x * AU, p.z * AU, -p.y * AU);
function llToVec(lat: number, lon: number, r: number, out = new THREE.Vector3()) {
  const phi = (lon + 180) * D, th = (90 - lat) * D;
  return out.set(-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r);
}

const EARTH_VERT = `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const EARTH_FRAG = `uniform sampler2D dayMap, nightMap, cloudMap; uniform vec3 sunPos; uniform float cloudShift;
varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN); vec3 L = normalize(sunPos - vW); vec3 V = normalize(cameraPosition - vW);
  float d = dot(n, L); float day = smoothstep(-0.12, 0.25, d);
  vec3 dayC = texture2D(dayMap, vUv).rgb;
  float c = texture2D(cloudMap, vUv + vec2(cloudShift, 0.0)).r;
  dayC = mix(dayC, vec3(1.0), c * 0.85) * (0.06 + 1.1 * max(d, 0.0));
  vec3 nightC = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.8, 0.55) * 1.4 * (1.0 - c);
  vec3 col = mix(nightC, dayC, day);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 2.6);
  col += vec3(0.35, 0.6, 1.0) * rim * (0.15 + 0.85 * day) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}`;
const GLOW_VERT = `varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`;
const GLOW_FRAG = `uniform vec3 color; uniform float power; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), power); gl_FragColor = vec4(color, f); }`;

function radialTexture(inner: string, outer: string, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!, h = size / 2, gr = g.createRadialGradient(h, h, 0, h, h, h);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** A Starship-style cargo rocket (about 50 m tall in reality; drawn huge so you can see it). */
function buildRocket(env: THREE.Texture) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9dee5, metalness: 0.85, roughness: 0.28, envMap: env, envMapIntensity: 1.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f37, metalness: 0.3, roughness: 0.6, envMap: env, envMapIntensity: 0.6 });
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0.5, 4.0)];
  for (let i = 1; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(0.5 * Math.cos(t * Math.PI / 2) ** 0.8, 4.0 + 1.7 * Math.sin(t * Math.PI / 2))); }
  const hull = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), steel);
  g.add(hull);
  const tiles = new THREE.Mesh(new THREE.CylinderGeometry(0.505, 0.505, 4.0, 48, 1, true, Math.PI * 0.75, Math.PI * 0.5), dark);
  tiles.position.y = 2.0; g.add(tiles);
  const flap = (y: number, w: number, h: number, side: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), dark);
    m.position.set(side * (0.5 + w / 2), y, 0); g.add(m);
  };
  flap(0.7, 0.55, 1.1, 1); flap(0.7, 0.55, 1.1, -1); flap(4.6, 0.35, 0.7, 1); flap(4.6, 0.35, 0.7, -1);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x5a606a, metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide, envMap: env });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.35, 20, 1, true), bellMat);
    bell.position.set(Math.cos(a) * 0.22, -0.15, Math.sin(a) * 0.22); g.add(bell);
  }
  const plumeMat = new THREE.MeshBasicMaterial({ map: radialTexture('rgba(255,236,200,1)', 'rgba(255,140,60,0)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3.2, 24, 1, true), plumeMat);
  plume.rotation.x = Math.PI; plume.position.y = -1.9; plume.name = 'plume'; g.add(plume);
  g.scale.setScalar(0.012);
  return g;
}

export class SpaceScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.001, 5000);
  private controls: OrbitControls;
  private earth = new THREE.Group(); private earthSpin = new THREE.Group();
  private mars = new THREE.Group(); private marsSpin = new THREE.Group();
  private sun: THREE.Mesh;
  private earthU: Record<string, THREE.IUniform>;
  private rockets: THREE.Group[] = [];
  private rocketDots: THREE.Sprite[] = [];
  private pathDone: THREE.Line; private pathTodo: THREE.Line;
  private path: THREE.Vector3[] = [];
  private labels: { el: HTMLDivElement; obj: THREE.Object3D; show: () => boolean }[] = [];
  private colonyGroup = new THREE.Group();
  private raf = 0; private last = performance.now(); private W = 1; private H = 1;
  private ro: ResizeObserver;
  private focus: Focus = 'system';
  private fly: { t0: number; fromT: THREE.Vector3; fromD: number; toD: number } | null = null;
  private prevTarget = new THREE.Vector3();
  private tmp = new THREE.Vector3(); private tmp2 = new THREE.Vector3();
  jd = 0; speed = 1; playing = true;
  depJd = 0; tofDays = 200;
  onInfo?: (i: SpaceInfo) => void;
  onLoad?: (pct: number) => void;
  private infoTimer = 0;
  private lastK = -2;
  private flying = false;
  private camDir = new THREE.Vector3();

  constructor(private host: HTMLElement, private labelHost: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.scene.background = new THREE.Color(0x020306);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.08, rotateSpeed: 0.55, zoomSpeed: 0.9, enablePan: false, minDistance: 0.05, maxDistance: 120 });
    this.camera.position.set(0, 26, 30);

    const manager = new THREE.LoadingManager();
    manager.onProgress = (_u, done, total) => this.onLoad?.(done / total);
    const loader = new THREE.TextureLoader(manager);
    const tex = (url: string, srgb = true) => { const t = loader.load(url); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };

    // stars: one draw call
    {
      const N = 5000, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
      let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < N; i++) {
        const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), r = 1500;
        pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
        const k = 0.25 + Math.pow(rnd(), 4) * 0.75, warm = rnd();
        col.set([k * (warm > 0.8 ? 1 : 0.9), k * 0.93, k * (warm < 0.2 ? 1 : 0.88)], i * 3);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true })));
    }

    // sun + glow + light
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(R_SUN, 48, 24), new THREE.MeshBasicMaterial({ map: tex('/textures/sun-1k.jpg'), color: new THREE.Color(1.6, 1.35, 1.0) }));
    this.scene.add(this.sun);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture('rgba(255,214,150,0.85)', 'rgba(255,170,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(9); this.scene.add(glow);
    this.scene.add(new THREE.PointLight(0xfff4e6, 2.4, 0, 0));
    this.scene.add(new THREE.AmbientLight(0x404858, 0.35));

    // earth
    this.earth.rotation.x = 23.44 * D; this.earth.add(this.earthSpin); this.scene.add(this.earth);
    this.earthU = { dayMap: { value: tex('/textures/earth-day-2k.jpg') }, nightMap: { value: tex('/textures/earth-night-2k.jpg') }, cloudMap: { value: tex('/textures/earth-clouds-1k.jpg', false) }, sunPos: { value: new THREE.Vector3() }, cloudShift: { value: 0 } };
    this.earthSpin.add(new THREE.Mesh(new THREE.SphereGeometry(R_E, 96, 48), new THREE.ShaderMaterial({ uniforms: this.earthU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG })));
    this.earth.add(new THREE.Mesh(new THREE.SphereGeometry(R_E * 1.04, 64, 32), new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(0x6fa8ff) }, power: { value: 3.5 } }, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending })));

    // mars
    this.mars.rotation.x = 25.19 * D; this.mars.add(this.marsSpin); this.scene.add(this.mars);
    this.marsSpin.add(new THREE.Mesh(new THREE.SphereGeometry(R_M, 96, 48), new THREE.MeshStandardMaterial({ map: tex('/textures/mars-color-2k.jpg'), normalMap: tex('/textures/mars-normal-2k.jpg', false), roughness: 0.95, metalness: 0 })));
    this.mars.add(new THREE.Mesh(new THREE.SphereGeometry(R_M * 1.035, 64, 32), new THREE.ShaderMaterial({ uniforms: { color: { value: new THREE.Color(0xe8b48a) }, power: { value: 4 } }, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending })));
    this.marsSpin.add(this.colonyGroup);

    // orbits drawn once per window
    this.pathDone = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9dbcf7 }));
    this.pathTodo = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x5b8def, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.7 }));
    this.scene.add(this.pathDone, this.pathTodo);

    // three rockets (model + a dot visible from far away)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.add(this.camera);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(0.5, 1, 1); this.camera.add(fill);
    const dotTex = radialTexture('rgba(190,215,255,1)', 'rgba(91,141,239,0)', 64);
    for (let i = 0; i < 3; i++) {
      const r = buildRocket(env); this.scene.add(r); this.rockets.push(r);
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, transparent: true, depthWrite: false, sizeAttenuation: false }));
      dot.scale.setScalar(i ? 0.018 : 0.026); this.scene.add(dot); this.rocketDots.push(dot);
    }

    this.addLabel('Sun', '#FFE3B0', this.sun, () => this.focus === 'system');
    this.addLabel('Earth', '#6FA4E6', this.earth, () => this.focus !== 'earth' || this.dist() > 2.5);
    this.addLabel('Mars', '#D0754E', this.mars, () => this.focus !== 'mars' || this.dist() > 2);
    this.addLabel('Cargo rockets', '#9DBCF7', this.rocketDots[0], () => this.flying && (this.focus !== 'rocket' || this.dist() > 0.6));

    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); this.resize();
    document.addEventListener('visibilitychange', this.onVis);
    this.loop();
  }

  private dist() { return this.camera.position.distanceTo(this.controls.target); }

  private addLabel(text: string, color: string, obj: THREE.Object3D, show: () => boolean, onClick?: () => void) {
    const el = document.createElement('div');
    el.className = 'space-lbl';
    el.innerHTML = `<i style="background:${color}"></i>${text}`;
    el.onclick = onClick ?? (() => this.setFocus(text === 'Earth' ? 'earth' : text === 'Mars' ? 'mars' : text === 'Sun' ? 'sun' : 'rocket'));
    this.labelHost.appendChild(el);
    this.labels.push({ el, obj, show });
  }

  setColonies(cols: Colony[]) {
    this.colonyGroup.clear();
    this.labels = this.labels.filter(l => { if (l.obj.userData.colony) { l.el.remove(); return false; } return true; });
    const color = (s: string) => (s === 'CRITICAL' ? 0xf05252 : s === 'WATCH' ? 0xf5a524 : 0x34c77b);
    for (const c of cols) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(R_M * 0.025, 12, 8), new THREE.MeshBasicMaterial({ color: color(c.status) }));
      llToVec(c.lat, c.lon, R_M * 1.01, m.position);
      m.userData.colony = true;
      this.colonyGroup.add(m);
      this.addLabel(c.name, `#${color(c.status).toString(16).padStart(6, '0')}`, m, () => this.focus === 'mars' && this.dist() < 1.6, () => this.setFocus('mars'));
    }
  }

  setWindow(depJd: number, tofDays: number) {
    this.depJd = depJd; this.tofDays = tofDays;
    const t = transfer(depJd, tofDays);
    const pts = t ? trajectoryPoints(t, 240) : [];
    this.path = pts.map(p => toScene(p, new THREE.Vector3()));
    // planet orbits
    this.scene.children.filter(o => o.userData.orbit).forEach(o => { this.scene.remove(o); (o as THREE.Line).geometry.dispose(); });
    for (const [p, period, col] of [['earth', 365.256, 0x2f4a70], ['mars', 686.98, 0x6a4232]] as const) {
      const arr: THREE.Vector3[] = [];
      for (let i = 0; i <= 360; i++) arr.push(toScene(helio(p, depJd + (period * i) / 360), new THREE.Vector3()));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arr), new THREE.LineBasicMaterial({ color: col }));
      line.userData.orbit = true; this.scene.add(line);
    }
    this.pathTodo.geometry.dispose(); this.pathTodo.geometry = new THREE.BufferGeometry().setFromPoints(this.path); this.pathTodo.computeLineDistances();
    this.lastK = -2;
  }

  setFocus(f: Focus) {
    this.focus = f;
    const d = f === 'system' ? 42 : f === 'sun' ? 6 : f === 'earth' ? 1.4 : f === 'mars' ? 1.0 : 0.22;
    this.fly = { t0: performance.now(), fromT: this.controls.target.clone(), fromD: this.dist(), toD: d };
    this.controls.minDistance = f === 'earth' ? R_E * 1.25 : f === 'mars' ? R_M * 1.3 : f === 'sun' ? R_SUN * 1.6 : f === 'rocket' ? 0.04 : 2;
  }

  private targetPos(out: THREE.Vector3) {
    switch (this.focus) {
      case 'earth': return out.copy(this.earth.position);
      case 'mars': return out.copy(this.mars.position);
      case 'rocket': return out.copy(this.rockets[0].position);
      default: return out.set(0, 0, 0);
    }
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.renderer.setSize(this.W, this.H); this.camera.aspect = this.W / this.H; this.camera.updateProjectionMatrix();
  }
  private onVis = () => { this.last = performance.now(); };

  private update(dt: number) {
    if (this.playing) this.jd += dt * this.speed;
    const jd = this.jd;
    toScene(helio('earth', jd), this.earth.position);
    toScene(helio('mars', jd), this.mars.position);
    // real rotation, but slowed to a calm visual spin when time runs fast
    const fast = this.speed > 0.05;
    this.earthSpin.rotation.y = fast ? (jd % 3) * 0.15 : gmst(jd);
    this.marsSpin.rotation.y = fast ? (jd % 3) * 0.12 : marsW(jd);
    this.earthU.sunPos.value.set(0, 0, 0);
    this.earthU.cloudShift.value = (jd * 0.002) % 1;

    // rockets along the transfer
    const rel = jd - this.depJd, f = rel / this.tofDays, n = this.path.length;
    this.flying = f > 0 && f < 1.02;
    this.rockets.forEach((r, i) => {
      const fi = (rel - i * 2) / this.tofDays;
      if (!n) return;
      if (fi <= 0) r.position.copy(this.earth.position).add(this.tmp.set(R_E * 1.4 + i * 0.05, 0.05, 0));
      else if (fi >= 1) r.position.copy(this.mars.position).add(this.tmp.set(R_M * 1.6 + i * 0.05, 0.04, 0));
      else {
        const x = fi * (n - 1), k = Math.floor(x);
        r.position.copy(this.path[k]).lerp(this.path[Math.min(n - 1, k + 1)], x - k);
        this.tmp2.copy(this.path[Math.min(n - 1, k + 2)]).sub(this.path[Math.max(0, k - 1)]).normalize();
        r.quaternion.setFromUnitVectors(this.tmp.set(0, 1, 0), this.tmp2);
      }
      const plume = r.getObjectByName('plume')!;
      plume.visible = (fi > 0 && fi < 0.02) || (fi > 0.97 && fi < 1);
      this.rocketDots[i].position.copy(r.position);
    });
    const kDone = n ? Math.max(0, Math.min(n - 1, Math.floor(Math.max(0, f) * (n - 1)))) : -1;
    if (n && kDone !== this.lastK) {
      this.lastK = kDone; const k = kDone;
      const done = this.path.slice(0, k + 1);
      this.pathDone.geometry.dispose(); this.pathDone.geometry = new THREE.BufferGeometry().setFromPoints(done.length > 1 ? done : [this.path[0], this.path[0]]);
    }

    // camera follows its target smoothly
    this.targetPos(this.tmp);
    if (this.fly) {
      const t = Math.min(1, (performance.now() - this.fly.t0) / 1300), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const dir = this.tmp2.copy(this.camera.position).sub(this.controls.target).normalize();
      this.controls.target.copy(this.fly.fromT).lerp(this.tmp, e);
      const d = this.fly.fromD * Math.pow(this.fly.toD / this.fly.fromD, e);
      this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
      if (t >= 1) this.fly = null;
    } else {
      const delta = this.tmp2.copy(this.tmp).sub(this.prevTarget);
      this.controls.target.add(delta); this.camera.position.add(delta);
    }
    this.prevTarget.copy(this.tmp);
    const dist = this.dist();
    this.camera.near = Math.max(0.0005, dist * 0.02); this.camera.far = 4000; this.camera.updateProjectionMatrix();
    this.rocketDots.forEach(d => (d.visible = dist > 0.5 || this.focus !== 'rocket'));

    // info for the UI (4×/s)
    this.infoTimer += dt;
    if (this.infoTimer > 0.25) {
      this.infoTimer = 0;
      this.onInfo?.({
        dateIso: new Date((jd - 2440587.5) * 86400000).toISOString(),
        daysToLaunch: this.depJd - jd, daysSinceLaunch: rel, tofDays: this.tofDays,
        earthMarsMkm: earthMarsKm(jd) / 1e6, delayMin: lightDelaySec(jd) / 60,
        phase: rel < 0 ? 'waiting' : rel < this.tofDays + 5 ? 'flying' : 'arrived',
      });
    }
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.update(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    // labels: transform only
    this.camera.getWorldDirection(this.camDir);
    for (const l of this.labels) {
      if (!l.show()) { l.el.style.opacity = '0'; l.el.style.pointerEvents = 'none'; continue; }
      l.obj.getWorldPosition(this.tmp);
      this.tmp2.copy(this.tmp).sub(this.camera.position);
      const behind = this.tmp2.dot(this.camDir) < 0;
      this.tmp.project(this.camera);
      if (behind) { l.el.style.opacity = '0'; continue; }
      l.el.style.opacity = '1'; l.el.style.pointerEvents = 'auto';
      l.el.style.transform = `translate(${((this.tmp.x * 0.5 + 0.5) * this.W + 10).toFixed(1)}px,${((-this.tmp.y * 0.5 + 0.5) * this.H - 12).toFixed(1)}px)`;
    }
  };

  dispose() {
    cancelAnimationFrame(this.raf); this.ro.disconnect(); document.removeEventListener('visibilitychange', this.onVis);
    this.controls.dispose();
    this.labels.forEach(l => l.el.remove());
    this.scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mat = m.material as THREE.Material | undefined; if (mat) { Object.values(mat).forEach(v => (v as THREE.Texture)?.isTexture && (v as THREE.Texture).dispose()); mat.dispose(); } });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
