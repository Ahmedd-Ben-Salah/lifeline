'use client';
/**
 * MarsGlobe — a real-texture Mars you can spin and zoom.
 *
 *  - Colour: Viking colour mosaic; relief: MOLA-derived normal map (scripts/build_textures.py)
 *  - Light: the real Sun direction for the sim date (subsolar point from Ls and Mars mean solar time)
 *  - Atmosphere: thin butterscotch limb haze (Fresnel shader)
 *  - Overlays: colonies, storm cone (p67/p90), routes, rovers — draped on the sphere
 *  - Smooth: inertial drag, exponentially damped zoom, render loop pauses when off-screen
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface GlobePin { id: string; lat: number; lon: number; color: string; label?: string; ring?: boolean; size?: number; pulse?: boolean }
export interface GlobeLine { id: string; points: { lat: number; lon: number }[]; color: string; dashed?: boolean; width?: number; opacity?: number }
export interface GlobeCone { edges: { l67: LL; r67: LL; l90: LL; r90: LL; centre: LL }[]; origin: LL }
type LL = { lat: number; lon: number };

export interface MarsGlobeProps {
  pins?: GlobePin[]; lines?: GlobeLine[]; cone?: GlobeCone | null;
  subsolar?: LL | null;           // real lighting; null = studio light
  focus?: LL | null;              // rotate so this point faces the camera
  autoRotate?: boolean; interactive?: boolean; zoom?: number; hiRes?: boolean;
  background?: 'transparent' | 'space';
  onPick?: (id: string) => void;
  className?: string; style?: React.CSSProperties;
}

const D = Math.PI / 180;
/** lat/lon (°E) → unit vector, matching an equirectangular texture with u=0 at 180°W. */
export function llToVec(lat: number, lon: number, r = 1, out = new THREE.Vector3()) {
  const phi = (lon + 180) * D, th = (90 - lat) * D;
  return out.set(-Math.cos(phi) * Math.sin(th) * r, Math.cos(th) * r, Math.sin(phi) * Math.sin(th) * r);
}

const atmoVert = `varying vec3 vN; varying vec3 vV; void main(){ vec4 w = modelMatrix*vec4(position,1.); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix*viewMatrix*w; }`;
const atmoFrag = `uniform vec3 uSun; uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.2); float lit = smoothstep(-0.35, 0.6, dot(vN, uSun)); gl_FragColor = vec4(uColor, f * (0.18 + 0.82*lit) * 0.85); }`;

export default function MarsGlobe(props: MarsGlobeProps) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{ update: (p: MarsGlobeProps) => void } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const el = host.current!, lbl = labels.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    let dist = 4.1 / (propsRef.current.zoom ?? 1), distTarget = dist;
    camera.position.set(0, 0, dist);

    if (propsRef.current.background === 'space') {
      const tex = new THREE.TextureLoader().load('/textures/stars.jpg');
      tex.colorSpace = THREE.SRGBColorSpace;
      const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 24), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: 0x9aa0aa }));
      scene.add(sky);
    }

    // planet (tilted group → spin group → mesh + overlays)
    const tilt = new THREE.Group(); scene.add(tilt);
    const spin = new THREE.Group(); tilt.add(spin);
    const loader = new THREE.TextureLoader();
    const aniso = renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97, metalness: 0, normalScale: new THREE.Vector2(0.9, 0.9) });
    const hi = propsRef.current.hiRes;
    loader.load(hi ? '/textures/mars-color-4k.jpg' : '/textures/mars-color-2k.jpg', t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; mat.map = t; mat.needsUpdate = true; dirty = true; });
    loader.load(hi ? '/textures/mars-normal-4k.jpg' : '/textures/mars-normal-2k.jpg', t => { t.anisotropy = aniso; mat.normalMap = t; mat.needsUpdate = true; dirty = true; });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 96), mat);
    spin.add(planet);
    const atmoU = { uSun: { value: new THREE.Vector3(1, 0.3, 0.6).normalize() }, uColor: { value: new THREE.Color(0xE8B48A) } };
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 64), new THREE.ShaderMaterial({ uniforms: atmoU, vertexShader: atmoVert, fragmentShader: atmoFrag, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending }));
    scene.add(atmo);
    const haze = new THREE.Mesh(new THREE.SphereGeometry(1.006, 96, 64), new THREE.ShaderMaterial({ uniforms: atmoU, vertexShader: atmoVert, fragmentShader: atmoFrag.replace('* 0.85', '* 0.55'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    scene.add(haze);

    const sun = new THREE.DirectionalLight(0xfff1e0, 2.6); scene.add(sun);
    const amb = new THREE.AmbientLight(0x8a7f78, 0.16); scene.add(amb);
    const hemi = new THREE.HemisphereLight(0xffe8d6, 0x1a0e0a, 0.12); scene.add(hemi);

    const overlay = new THREE.Group(); spin.add(overlay);
    const pinObjs = new Map<string, { mesh: THREE.Object3D; ring?: THREE.Mesh; lbl?: HTMLDivElement; n: THREE.Vector3; pulse?: boolean }>();
    const disposables: { dispose: () => void }[] = [];

    function clearOverlay() {
      overlay.children.slice().forEach(o => { overlay.remove(o); (o as THREE.Mesh).geometry?.dispose?.(); const m = (o as THREE.Mesh).material as THREE.Material | undefined; m?.dispose?.(); });
      pinObjs.forEach(p => p.lbl?.remove());
      pinObjs.clear();
    }

    function surfaceLine(points: LL[], r: number) {
      const out: THREE.Vector3[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = llToVec(points[i].lat, points[i].lon, 1);
        if (i > 0) {
          const b = out[out.length - 1].clone().normalize();
          const ang = a.angleTo(b);
          const steps = Math.ceil(ang / (2 * D));
          for (let k = 1; k < steps; k++) out.push(b.clone().lerp(a, k / steps).normalize().multiplyScalar(r));
        }
        out.push(a.multiplyScalar(r));
      }
      return out;
    }

    function build(p: MarsGlobeProps) {
      clearOverlay();
      // storm cone: p90 (soft) and p67 (stronger, dashed edge), draped as triangle strips
      if (p.cone && p.cone.edges.length > 1) {
        const strip = (L: (e: GlobeCone['edges'][0]) => LL, R: (e: GlobeCone['edges'][0]) => LL, color: number, opacity: number, r: number) => {
          // dense grid (≈2° cells) so flat triangles never dip under the sphere
          const pos: number[] = [], idx: number[] = [];
          const E = p.cone!.edges, along = 4, subs = 18;
          const rows: THREE.Vector3[][] = [];
          for (let i = 0; i < E.length - 1; i++) for (let a = 0; a < along; a++) rows.push([llToVec(L(E[i]).lat, L(E[i]).lon), llToVec(R(E[i]).lat, R(E[i]).lon), llToVec(L(E[i + 1]).lat, L(E[i + 1]).lon), llToVec(R(E[i + 1]).lat, R(E[i + 1]).lon), new THREE.Vector3(a / along, 0, 0)]);
          const last = E[E.length - 1];
          rows.push([llToVec(L(last).lat, L(last).lon), llToVec(R(last).lat, R(last).lon), llToVec(L(last).lat, L(last).lon), llToVec(R(last).lat, R(last).lon), new THREE.Vector3(0, 0, 0)]);
          rows.forEach((row, i) => {
            const t = row[4].x;
            const lv = row[0].clone().lerp(row[2], t).normalize(), rv = row[1].clone().lerp(row[3], t).normalize();
            const ang = lv.angleTo(rv), sn = Math.sin(ang) || 1;
            for (let k = 0; k <= subs; k++) { const f = k / subs; const v = lv.clone().multiplyScalar(Math.sin((1 - f) * ang) / sn).add(rv.clone().multiplyScalar(Math.sin(f * ang) / sn)).normalize().multiplyScalar(r); pos.push(v.x, v.y, v.z); }
            if (i > 0) { const a0 = (i - 1) * (subs + 1), b0 = i * (subs + 1); for (let k = 0; k < subs; k++) idx.push(a0 + k, b0 + k, a0 + k + 1, a0 + k + 1, b0 + k, b0 + k + 1); }
          });
          const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
          const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
          overlay.add(m);
        };
        strip(e => e.l90, e => e.r90, 0xF2C38B, 0.16, 1.004);
        strip(e => e.l67, e => e.r67, 0xF0A35C, 0.30, 1.005);
        const edge = (pts: LL[]) => { const g = new THREE.BufferGeometry().setFromPoints(surfaceLine(pts, 1.006)); const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xFCE3C4, dashSize: 0.02, gapSize: 0.014, transparent: true, opacity: 0.95 })); l.computeLineDistances(); overlay.add(l); };
        edge(p.cone.edges.map(e => e.l67)); edge(p.cone.edges.map(e => e.r67));
        const centre = new THREE.Line(new THREE.BufferGeometry().setFromPoints(surfaceLine(p.cone.edges.map(e => e.centre), 1.0065)), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.01, gapSize: 0.012, transparent: true, opacity: 0.8 }));
        centre.computeLineDistances(); overlay.add(centre);
        // dust core at the origin
        const o = llToVec(p.cone.origin.lat, p.cone.origin.lon, 1.008);
        const cv = document.createElement('canvas'); cv.width = cv.height = 128; const cx = cv.getContext('2d')!; const gr = cx.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(252,227,196,0.85)'); gr.addColorStop(0.5, 'rgba(240,190,140,0.35)'); gr.addColorStop(1, 'rgba(240,190,140,0)'); cx.fillStyle = gr; cx.fillRect(0, 0, 128, 128);
        const tex = new THREE.CanvasTexture(cv);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.16, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        disc.position.copy(o); disc.lookAt(o.clone().multiplyScalar(2)); overlay.add(disc);
      }
      for (const ln of p.lines ?? []) {
        const g = new THREE.BufferGeometry().setFromPoints(surfaceLine(ln.points, 1.007));
        const m = ln.dashed ? new THREE.LineDashedMaterial({ color: new THREE.Color(ln.color), dashSize: 0.018, gapSize: 0.012, transparent: true, opacity: ln.opacity ?? 0.95 }) : new THREE.LineBasicMaterial({ color: new THREE.Color(ln.color), transparent: true, opacity: ln.opacity ?? 0.95 });
        const l = new THREE.Line(g, m); if (ln.dashed) l.computeLineDistances(); overlay.add(l);
      }
      for (const pin of p.pins ?? []) {
        const n = llToVec(pin.lat, pin.lon, 1);
        const s = pin.size ?? 1;
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.018 * s, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        head.position.copy(n).multiplyScalar(1.012);
        const ringM = new THREE.Mesh(new THREE.RingGeometry(0.019 * s, 0.03 * s, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(pin.color), side: THREE.DoubleSide, transparent: true, depthWrite: false }));
        ringM.position.copy(n).multiplyScalar(1.0125); ringM.lookAt(n.clone().multiplyScalar(3));
        overlay.add(head, ringM);
        let pulse: THREE.Mesh | undefined;
        if (pin.pulse) { pulse = new THREE.Mesh(new THREE.RingGeometry(0.03 * s, 0.036 * s, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(pin.color), side: THREE.DoubleSide, transparent: true, depthWrite: false })); pulse.position.copy(n).multiplyScalar(1.011); pulse.lookAt(n.clone().multiplyScalar(3)); overlay.add(pulse); }
        let l: HTMLDivElement | undefined;
        if (pin.label) {
          l = document.createElement('div');
          l.className = 'globe-lbl';
          l.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font:600 12px/1 var(--font);padding:5px 9px;border-radius:999px;background:rgba(255,255,255,.94);color:${pin.color === '#DC2626' ? '#B91C1C' : '#0E1116'};box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:${p.onPick ? 'auto' : 'none'};cursor:pointer;will-change:transform;transition:opacity .2s`;
          l.textContent = pin.label;
          if (p.onPick) l.onclick = () => propsRef.current.onPick?.(pin.id);
          lbl.appendChild(l);
        }
        pinObjs.set(pin.id, { mesh: head, ring: pulse, lbl: l, n, pulse: pin.pulse });
      }
      dirty = true;
    }

    function setSun(p: MarsGlobeProps) {
      // sun direction in the planet's frame → rotate with the spin group so the terminator is geographic
      const ss = p.subsolar ?? { lat: 12, lon: (spinBase / D) };
      const v = llToVec(ss.lat, ss.lon, 1);
      sunLocal.copy(v);
    }

    // orientation state: yaw/pitch with inertia; focus animation
    let yaw = 0, pitch = 0.32, vYaw = 0, vPitch = 0, dirty = true;
    let spinBase = 0;
    const sunLocal = new THREE.Vector3(1, 0.2, 0.5).normalize();
    let focusAnim: { fromYaw: number; toYaw: number; fromPitch: number; toPitch: number; t0: number } | null = null;
    function focusOn(f: LL) {
      // yaw so that longitude faces +z (camera): vector for lon has phi; we rotate spin by -angle
      const v = llToVec(f.lat, f.lon, 1);
      const targetYaw = -Math.atan2(v.x, v.z);
      let dy = targetYaw - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      focusAnim = { fromYaw: yaw, toYaw: yaw + dy, fromPitch: pitch, toPitch: Math.max(-1.1, Math.min(1.1, f.lat * D * 0.9)), t0: performance.now() };
    }

    // input
    let dragging = false, lastX = 0, lastY = 0, idleSince = performance.now();
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch0 = 0, pinchDist0 = 0;
    const onDown = (e: PointerEvent) => {
      if (propsRef.current.interactive === false) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      renderer.domElement.setPointerCapture(e.pointerId);
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); pinchDist0 = distTarget; }
      dragging = true; lastX = e.clientX; lastY = e.clientY; focusAnim = null; renderer.domElement.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); distTarget = Math.max(1.35, Math.min(8, pinchDist0 * pinch0 / Math.max(1, d))); return; }
      const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
      const k = 0.0052 * (dist - 1) / 3;
      vYaw = dx * k; vPitch = dy * k; yaw += vYaw; pitch = Math.max(-1.25, Math.min(1.25, pitch + vPitch));
      idleSince = performance.now(); dirty = true;
    };
    const onUp = (e: PointerEvent) => { pointers.delete(e.pointerId); if (!pointers.size) { dragging = false; renderer.domElement.style.cursor = 'grab'; idleSince = performance.now(); } };
    const onWheel = (e: WheelEvent) => {
      if (propsRef.current.interactive === false) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      distTarget = Math.max(1.35, Math.min(8, distTarget * Math.exp(delta * 0.0012)));
      idleSince = performance.now();
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointercancel', onUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.style.cursor = propsRef.current.interactive === false ? 'default' : 'grab';

    // size
    let W = 1, H = 1;
    const resize = () => { const r = el.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); renderer.setSize(W, H, false); renderer.domElement.style.width = W + 'px'; renderer.domElement.style.height = H + 'px'; camera.aspect = W / H; camera.updateProjectionMatrix(); dirty = true; };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();

    // visibility: stop rendering when off-screen or tab hidden
    let visible = true;
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 });
    io.observe(el);

    const tmp = new THREE.Vector3(), camDir = new THREE.Vector3(), q = new THREE.Quaternion();
    let raf = 0, last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!visible || document.hidden) return;
      const p = propsRef.current;
      // inertia + auto-rotate
      if (!dragging) {
        if (focusAnim) {
          const t = Math.min(1, (now - focusAnim.t0) / 1100), e = 1 - Math.pow(1 - t, 3);
          yaw = focusAnim.fromYaw + (focusAnim.toYaw - focusAnim.fromYaw) * e; pitch = focusAnim.fromPitch + (focusAnim.toPitch - focusAnim.fromPitch) * e;
          if (t >= 1) focusAnim = null; dirty = true;
        } else if (Math.abs(vYaw) > 1e-5 || Math.abs(vPitch) > 1e-5) {
          yaw += vYaw; pitch = Math.max(-1.25, Math.min(1.25, pitch + vPitch)); vYaw *= Math.pow(0.04, dt); vPitch *= Math.pow(0.04, dt); dirty = true;
        } else if (p.autoRotate !== false && now - idleSince > 2500) { yaw += dt * 0.06; dirty = true; }
      }
      // damped zoom (frame-rate independent)
      if (Math.abs(distTarget - dist) > 1e-4) { dist += (distTarget - dist) * (1 - Math.exp(-dt * 9)); dirty = true; }
      const pulseT = (now % 1600) / 1600;
      pinObjs.forEach(o => { if (o.ring) { o.ring.scale.setScalar(1 + pulseT * 1.4); (o.ring.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - pulseT); dirty = true; } });
      if (!dirty) return;
      dirty = false;
      spin.rotation.set(0, yaw, 0);
      tilt.rotation.set(pitch, 0, 0);
      camera.position.set(0, 0, dist); camera.lookAt(0, 0, 0);
      camera.near = Math.max(0.005, (dist - 1) * 0.3); camera.updateProjectionMatrix();
      // sun follows the planet's geography (true terminator)
      tilt.updateMatrixWorld(true);
      spin.getWorldQuaternion(q);
      tmp.copy(sunLocal).applyQuaternion(q);
      sun.position.copy(tmp).multiplyScalar(10);
      atmoU.uSun.value.copy(tmp);
      renderer.render(scene, camera);
      // labels (transform only)
      camDir.copy(camera.position).normalize();
      pinObjs.forEach(o => {
        if (!o.lbl) return;
        o.mesh.getWorldPosition(tmp);
        const facing = tmp.clone().normalize().dot(camDir);
        tmp.project(camera);
        const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
        o.lbl.style.transform = `translate(${(x + 10).toFixed(1)}px,${(y - 11).toFixed(1)}px)`;
        o.lbl.style.opacity = facing > 0.15 ? '1' : '0';
      });
    };
    raf = requestAnimationFrame(loop);

    let lastFocusKey = '';
    api.current = {
      update(p) {
        build(p); setSun(p);
        const fk = p.focus ? `${p.focus.lat.toFixed(2)},${p.focus.lon.toFixed(2)}` : '';
        if (p.focus && fk !== lastFocusKey) { lastFocusKey = fk; focusOn(p.focus); }
        if (p.zoom) distTarget = 4.1 / p.zoom;
        dirty = true;
      },
    };
    api.current.update(propsRef.current);
    if (propsRef.current.focus) { const v = llToVec(propsRef.current.focus.lat, propsRef.current.focus.lon); yaw = -Math.atan2(v.x, v.z); pitch = Math.max(-1.1, Math.min(1.1, propsRef.current.focus.lat * D * 0.9)); focusAnim = null; }

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown); renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp); renderer.domElement.removeEventListener('pointercancel', onUp); renderer.domElement.removeEventListener('wheel', onWheel);
      clearOverlay();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; (Array.isArray(mm) ? mm : mm ? [mm] : []).forEach(x => { Object.values(x).forEach(v => (v as THREE.Texture)?.isTexture && (v as THREE.Texture).dispose()); x.dispose(); }); });
      disposables.forEach(d => d.dispose());
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);

  // overlay updates without rebuilding the renderer
  const key = JSON.stringify([props.pins, props.lines, props.cone, props.subsolar, props.focus, props.zoom]);
  useEffect(() => { api.current?.update(propsRef.current); }, [key]);

  return (
    <div className={props.className} style={{ position: 'relative', width: '100%', height: '100%', ...props.style }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} aria-label="Interactive 3D Mars. Drag to rotate, scroll to zoom." role="img" />
      <div ref={labels} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }} aria-hidden="true" />
    </div>
  );
}
