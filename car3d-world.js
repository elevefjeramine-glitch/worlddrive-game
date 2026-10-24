/**
 * car3d-world.js — Module 3D Three.js pour jeu de voiture en monde ouvert (un seul fichier, ES module).
 * Aucune API payante, aucune clé. Testé avec three@0.160.0 (cœur uniquement, sans addons).
 *
 * Rendu : éclairage physique (soleil + lune + phares), ombres PCF, ciel procédural + réflexions IBL
 * (PMREM générée depuis le ciel), matériaux PBR (peinture vernie, vitres, fenêtres brillantes/émissives),
 * textures procédurales (asphalte, béton, herbe, façades), lampadaires + halos, arbres instanciés,
 * bâtiments fusionnés par matériau (peu de draw calls), voiture extrudée avec roues animées.
 *
 * CONVENTIONS : 1 unité = 1 m ; x = Est, z = Sud (Nord = -z) ; heading : avant = (sin h, cos h),
 * h augmente à gauche ; cap boussole b (°, 0 = Nord, horaire) : h = PI - b. speed : m/s signée.
 *
 * USAGE :  const w = new CarWorld3D(el); w.buildDemoCity();  /* ou await w.loadFromOverpass(lat, lng) *​/ w.start();
 */
import * as THREE from 'three';

/* ============================ 1) RÉGLAGES ============================ */
export const CONFIG = {
  renderer: { maxPixelRatio: 2, shadows: true, shadowMapSize: 2048, shadowDistance: 70, exposure: 1, viewDistance: 900 },
  geo: { originLat: 48.8566, originLng: 2.3522 },
  car: {
    color: 0xc1121f, length: 4.4, width: 1.8, wheelRadius: 0.36, wheelWidth: 0.26, wheelBase: 2.7, trackHalf: 0.93,
    maxSteerVisual: 0.55, rollFactor: 0.0035, pitchFactor: 0.0025, maxRoll: 0.07, maxPitch: 0.05,
    headlightIntensity: 600,       // candelas (lumières physiques)
  },
  time: { startHour: 16, autoCycle: true, dayLengthSeconds: 180, envUpdateHours: 0.5 },
  lighting: {
    sunIntensity: 3, moonIntensity: 0.4, starsCount: 1500,
    skyDayTop: 0x3b7fd8, skyDayHor: 0xbfd9f2, skyDusk: 0xff8a4a, skyNightTop: 0x02040b, skyNightHor: 0x101830,
  },
  ground: { rgb: [70, 98, 58], size: 4000, tile: 10 },
  roads: {
    centerLineMinWidth: 7, sidewalk: 1.6,
    widths: {   // largeur (m) par type OSM "highway" ; type absent = ignoré (sentiers…)
      motorway: 12, trunk: 11, primary: 10, secondary: 9, tertiary: 8, unclassified: 6.5, residential: 7,
      living_street: 5, service: 4, motorway_link: 7, trunk_link: 7, primary_link: 7, secondary_link: 6, tertiary_link: 6,
    },
  },
  lamps: { enabled: true, spacing: 40, minRoadWidth: 7, max: 600, glow: 3 },
  trees: { enabled: true, spacing: 24, minRoadWidth: 6, max: 900 },
  buildings: {
    max: 1800, levelHeight: 3.2, minHeight: 6, maxHeight: 24, windowTile: 12, litRatio: 0.55, windowGlow: 1.6,
    palette: [0xb9b2a6, 0xc9c1b0, 0x9aa4ad, 0xa8a29a, 0xd2c5ae, 0x8d96a0],
  },
  collision: { radius: 0.95, circleOffset: 1.3, gridCell: 40, passes: 3 },
  camera: {
    fov: 62, preset: 'chase', headingLag: 4, positionSmoothing: 9, speedFovBoost: 14, speedRef: 40,
    presets: {
      chase: { distance: 9, height: 4.2, lookAhead: 5, lookHeight: 1.2 },
      far: { distance: 18, height: 9, lookAhead: 6, lookHeight: 1 },
      top: { distance: 3, height: 55, lookAhead: 0, lookHeight: 0 },
    },
  },
  hud: { enabled: true },
  input: { keyboard: true },       // flèches/WASD, Espace = frein à main, C = caméra, N = +3 h
  testPhysics: {                   // physique arcade de TEST (remplaçable par la vôtre)
    maxSpeed: 45, acceleration: 14, brakePower: 30, reverseAcceleration: 9, maxReverseSpeed: 10,
    rollingDrag: 1.2, airDrag: 0.012, grip: 9, gripHandbrake: 1.1, slideThreshold: 6, slideGripFactor: 0.45,
    handbrakeDecel: 6, handbrakeYawBoost: 1.5, steerLow: 0.62, steerHigh: 0.16, steerResponse: 9, maxYawRate: 2.4,
    bounce: 0.25, wallFriction: 0.12,
  },
  osm: {
    radius: 350, placeCarOnRoad: true,
    endpoints: ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'],
  },
  demo: { seed: 42, blocks: 8, blockSize: 60, roadWidth: 10, parkRatio: 0.08 },
};

/* ============================ 2) OUTILS ============================ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const ROAD_Y = 0.07;   // hauteur du bitume (la voiture roule dessus)

function mulberry32(s) {
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deepMerge(t, s) {
  for (const k in s) t[k] = s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) ? deepMerge(t[k] || {}, s[k]) : s[k];
  return t;
}
const makeCanvas = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });
/** Canvas carré rempli d'un bruit de grain autour d'une couleur [r,g,b]. */
function noiseCanvas(size, [r, g, b], amp, seed) {
  const cv = makeCanvas(size), ctx = cv.getContext('2d'), img = ctx.createImageData(size, size), rnd = mulberry32(seed);
  for (let i = 0; i < size * size; i++) { const n = (rnd() - 0.5) * amp; img.data.set([r + n, g + n, b + n, 255], i * 4); }
  ctx.putImageData(img, 0, 0);
  return cv;
}
function makeTexture(cv, rx, ry, aniso, srgb = true) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** Géométrie indexée simple depuis des tableaux (positions, uv, indices), normales vers le haut. */
function flatGeometry({ p, u, i }) {
  const g = new THREE.BufferGeometry(), nrm = new Float32Array(p.length);
  for (let k = 1; k < nrm.length; k += 3) nrm[k] = 1;
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(i), 1));
  return g;
}

/* ===================== 3) PROJECTION lat/lng <-> mètres ===================== */
export class GeoProjection {
  constructor(lat0, lng0) {
    this.lat0 = lat0; this.lng0 = lng0;
    const p = lat0 * Math.PI / 180;
    this.mLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
    this.mLng = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  }
  toLocal(lat, lng) { return { x: (lng - this.lng0) * this.mLng, z: -(lat - this.lat0) * this.mLat }; }
  toGeo(x, z) { return { lat: this.lat0 - z / this.mLat, lng: this.lng0 + x / this.mLng }; }
}
export const bearingToHeading = (deg) => Math.PI - deg * Math.PI / 180;
export const headingToBearing = (h) => (((Math.PI - h) * 180 / Math.PI) % 360 + 360) % 360;

/* ===================== 4) COLLISIONS (grille + cercle/polygone) ===================== */
class CollisionGrid {
  constructor(cell) { this.cell = cell; this.map = new Map(); this.stamp = 0; }
  clear() { this.map.clear(); }
  add(pts) {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]), k = this.cell;
    const poly = { pts, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), q: 0 };
    for (let i = Math.floor(poly.x0 / k); i <= Math.floor(poly.x1 / k); i++)
      for (let j = Math.floor(poly.z0 / k); j <= Math.floor(poly.z1 / k); j++) {
        const key = i * 100003 + j;
        if (!this.map.has(key)) this.map.set(key, []);
        this.map.get(key).push(poly);
      }
  }
  near(x0, z0, x1, z1) {
    const out = [], k = this.cell; this.stamp++;
    for (let i = Math.floor(x0 / k); i <= Math.floor(x1 / k); i++)
      for (let j = Math.floor(z0 / k); j <= Math.floor(z1 / k); j++)
        for (const p of this.map.get(i * 100003 + j) || []) {
          if (p.q === this.stamp || x1 < p.x0 || x0 > p.x1 || z1 < p.z0 || z0 > p.z1) continue;
          p.q = this.stamp; out.push(p);
        }
    return out;
  }
  /** Pousse un cercle hors du polygone le plus pénétré -> {nx, nz, depth} ou null. */
  pushOut(cx, cz, r) {
    let best = null;
    for (const { pts } of this.near(cx - r, cz - r, cx + r, cz + r)) {
      let d2 = Infinity, bx = 0, bz = 0, inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [ax, az] = pts[j], [px, pz] = pts[i], dx = px - ax, dz = pz - az, l2 = dx * dx + dz * dz;
        const t = l2 ? clamp(((cx - ax) * dx + (cz - az) * dz) / l2, 0, 1) : 0, qx = ax + dx * t, qz = az + dz * t;
        const d = (cx - qx) ** 2 + (cz - qz) ** 2;
        if (d < d2) { d2 = d; bx = qx; bz = qz; }
        if ((pz > cz) !== (az > cz) && cx < (ax - px) * (cz - pz) / (az - pz) + px) inside = !inside;
      }
      const d = Math.sqrt(d2);
      let nx, nz, depth;
      if (inside) { nx = bx - cx; nz = bz - cz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; depth = d + r; }
      else if (d < r && d > 1e-6) { nx = (cx - bx) / d; nz = (cz - bz) / d; depth = r - d; }
      else continue;
      if (!best || depth > best.depth) best = { nx, nz, depth };
    }
    return best;
  }
}

/* ============================ 5) LE MONDE ============================ */
export class CarWorld3D {
  /** @param {HTMLElement} container  @param {{config?:object, useBuiltInPhysics?:boolean}} options */
  constructor(container, options = {}) {
    this.container = container;
    this.cfg = deepMerge(structuredClone(CONFIG), options.config || {});
    this.useBuiltInPhysics = options.useBuiltInPhysics !== false;
    this.car = { x: 0, z: 0, heading: 0, speed: null, steer: null, yawRate: 0, braking: false };
    this._vis = { lx: 0, lz: 0, lh: 0, ls: 0, speed: 0, spin: 0, steer: 0, roll: 0, pitch: 0, first: true };
    this._ph = { vx: 0, vz: 0, steer: 0 };
    this.input = { throttle: 0, brake: 0, left: 0, right: 0, handbrake: 0 };   // pilotable par vos boutons tactiles
    this.onBeforeUpdate = null;   // (dt, world) => void
    this.onCollision = null;      // ({impact, nx, nz}) => void (physique de test)
    this.hour = this.cfg.time.startHour; this.autoCycle = this.cfg.time.autoCycle;
    this.sunDir = new THREE.Vector3(); this._c = new THREE.Color(); this._envHour = -99;
    this.proj = new GeoProjection(this.cfg.geo.originLat, this.cfg.geo.originLng);
    this.grid = new CollisionGrid(this.cfg.collision.gridCell);
    this.roadSegs = []; this.worldGroup = null; this.camHeading = 0; this.cameraPreset = this.cfg.camera.preset;

    this._initRenderer(); this._initLights(); this._initSky(); this._createMaterials(); this._createCar();
    this._initUI();
    this._applyTime(this.hour, true);
    this.resize();
  }

  /* ---------- Initialisation ---------- */
  _initRenderer() {
    const r = this.cfg.renderer, c = this.cfg.camera;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, r.maxPixelRatio));
    this.renderer.shadowMap.enabled = r.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = r.exposure;
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    this.container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xbfd9f2, 60, r.viewDistance);
    this.camera = new THREE.PerspectiveCamera(c.fov, 1, 0.5, 2500);
  }

  _initLights() {
    const r = this.cfg.renderer, s = r.shadowDistance;
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = r.shadows;
    this.sun.shadow.mapSize.set(r.shadowMapSize, r.shadowMapSize);
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 500 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.4;
    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0);
    this.scene.add(this.sun, this.sun.target, this.moon, this.moon.target);
  }

  /** Ciel : dôme à dégradé + soleil (shader), lune, étoiles ; la même scène sert à générer les réflexions IBL. */
  _initSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uSunDir: { value: this.sunDir } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop, uHor, uSun, uSunDir; varying vec3 vD;
        void main(){
          vec3 c = mix(uHor, uTop, pow(clamp(vD.y, 0.0, 1.0), 0.5));
          float s = max(dot(normalize(vD), uSunDir), 0.0);
          c += uSun * (0.35 * pow(s, 6.0) + 1.5 * pow(s, 256.0) + 12.0 * smoothstep(0.9996, 0.9999, s));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.SphereGeometry(1000, 32, 16);
    this.dome = new THREE.Mesh(geo, this.skyMat); this.dome.frustumCulled = false; this.dome.renderOrder = -1;
    this.envScene = new THREE.Scene(); this.envScene.add(new THREE.Mesh(geo, this.skyMat));
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    const n = this.cfg.lighting.starsCount, pos = new Float32Array(n * 3), rnd = mulberry32(1234);
    for (let i = 0; i < n; i++) {
      const u = rnd(), a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - u * u);
      pos.set([rr * Math.cos(a) * 900, u * 900, rr * Math.sin(a) * 900], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starsMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starsMat); this.stars.frustumCulled = false;
    this.moonDisc = new THREE.Mesh(new THREE.SphereGeometry(30, 16, 12), new THREE.MeshBasicMaterial({ color: 0xdfe6ff, fog: false }));
    this.moonDisc.frustumCulled = false;
    this.scene.add(this.dome, this.stars, this.moonDisc);
  }

  /** Textures procédurales + matériaux partagés (monde, façades, végétation, halos). */
  _createMaterials() {
    const C = this.cfg, A = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const tex = (cv, rx, ry, srgb) => makeTexture(cv, rx, ry, A, srgb);
    const std = (o) => new THREE.MeshStandardMaterial(o);

    // Sol, bitume, béton : UV en mètres, tuile de 8 m
    const G = C.ground;
    this.groundMat = std({ map: tex(noiseCanvas(256, G.rgb, 50, 3), G.size / G.tile, G.size / G.tile), roughness: 1 });
    this.asphaltMat = std({ map: tex(noiseCanvas(256, [58, 60, 64], 26, 1), 1 / 8, 1 / 8), roughness: 0.92 });
    this.concreteMat = std({ map: tex(noiseCanvas(256, [175, 172, 165], 30, 2), 1 / 8, 1 / 8), roughness: 0.95 });
    this.roofMat = std({ map: this.concreteMat.map, color: 0x6a6e73, roughness: 0.95 });

    // Ligne centrale pointillée (alpha test)
    const dash = makeCanvas(4, 32), d = dash.getContext('2d'); d.fillStyle = '#e8e6c0'; d.fillRect(0, 0, 4, 16);
    this.dashMat = std({ map: tex(dash, 1, 1 / 8), alphaTest: 0.5, transparent: true, roughness: 0.8 });
    this.dashMat.map.magFilter = THREE.NearestFilter;

    // Façades : couleur+grain+fenêtres, émissive (fenêtres allumées), ORM (rugosité G / métal B : vitres brillantes)
    const S = 256, N = 4, c = S / N, rnd = mulberry32(7), warm = ['#ffd9a0', '#ffe8b8', '#fff4d6', '#ffcf8a'];
    const wall = noiseCanvas(S, [228, 226, 220], 20, 4), emi = makeCanvas(S), orm = makeCanvas(S);
    const g = wall.getContext('2d'), e = emi.getContext('2d'), o = orm.getContext('2d');
    e.fillStyle = '#000'; e.fillRect(0, 0, S, S); o.fillStyle = 'rgb(255,225,0)'; o.fillRect(0, 0, S, S);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = i * c, y = j * c;
      g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + c - 6, c, 6);          // corniche
      g.fillStyle = '#b8b8b2'; g.fillRect(x + 9, y + 8, c - 18, c - 22);        // cadre
      g.fillStyle = '#1d2b3d'; g.fillRect(x + 13, y + 12, c - 26, c - 30);      // vitre
      o.fillStyle = 'rgb(255,35,170)'; o.fillRect(x + 13, y + 12, c - 26, c - 30);
      if (rnd() < C.buildings.litRatio) { e.fillStyle = warm[Math.floor(rnd() * 4)]; e.fillRect(x + 13, y + 12, c - 26, c - 30); }
    }
    const r = 1 / C.buildings.windowTile, fm = tex(wall, r, r), fe = tex(emi, r, r), fo = tex(orm, r, r, false);
    this.wallMats = C.buildings.palette.map((color) => std({
      color, map: fm, emissive: 0xffffff, emissiveMap: fe, emissiveIntensity: 0, roughnessMap: fo, metalnessMap: fo, roughness: 1, metalness: 1,
    }));

    // Halo radial (flaque de lumière des lampadaires, ombre de contact de la voiture)
    const rad = makeCanvas(64), q = rad.getContext('2d'), gr = q.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    q.fillStyle = gr; q.fillRect(0, 0, 64, 64);
    this.glowTex = new THREE.CanvasTexture(rad);
    this.poolMat = new THREE.MeshBasicMaterial({ map: this.glowTex, color: 0xffd49a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2a8, emissiveIntensity: 0 });
    this.poleMat = std({ color: 0x3a3d42, roughness: 0.6, metalness: 0.5 });
    this.trunkMat = std({ color: 0x4a3626, roughness: 1 });
    this.leafMat = std({ roughness: 0.9, flatShading: true });
    // Les routes se superposent au sol : léger décalage de profondeur
    for (const m of [this.asphaltMat, this.concreteMat, this.dashMat]) Object.assign(m, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(G.size, G.size).rotateX(-Math.PI / 2), this.groundMat);
    this.ground.receiveShadow = true; this.scene.add(this.ground);
  }

  /** Voiture : silhouette extrudée (profil latéral biseauté), vitres, phares, roues (pivot -> rotation). */
  _createCar() {
    const C = this.cfg.car, W = C.width, L = C.length, sx = L / 4.4, R = C.wheelRadius, WW = C.wheelWidth;
    this.carRoot = new THREE.Group(); this.bodyGroup = new THREE.Group(); this.carRoot.add(this.bodyGroup);
    this.paintMat = new THREE.MeshPhysicalMaterial({ color: C.color, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1118, metalness: 0.9, roughness: 0.04 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x161618, roughness: 0.7 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1c8, emissiveIntensity: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x6a0000, emissive: 0xff1a1a, emissiveIntensity: 0.5 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; this.bodyGroup.add(m); return m; };
    /** Profil latéral [[z,y],...] extrudé sur la largeur w, avec biseau b. */
    const profile = (pts, w, b) => {
      const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z * sx, y)));
      return new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 6 })
        .translate(0, 0, -w / 2).rotateY(-Math.PI / 2);   // shape.x -> avant (+z), extrusion -> largeur (x)
    };
    add(profile([[-2.2, .3], [2.2, .3], [2.2, .58], [2, .76], [.9, .9], [-1.7, .92], [-2.15, .88], [-2.2, .7]], W - 0.12, 0.06), this.paintMat, 0, 0, 0);
    add(profile([[1, .9], [.35, 1.4], [-.95, 1.4], [-1.6, .92]], W - 0.3, 0.04), glass, 0, 0, 0);
    add(new THREE.BoxGeometry(W - 0.3, 0.05, 1.3 * sx), this.paintMat, 0, 1.455, -0.3 * sx);          // toit
    add(new THREE.BoxGeometry(W - 0.7, 0.14, 0.05), dark, 0, 0.42, L / 2 + 0.07);                       // calandre
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.42, 0.12, 0.06), this.headMat, s * 0.62, 0.5, L / 2 + 0.07);          // phares
      add(new THREE.BoxGeometry(0.46, 0.12, 0.06), this.tailMat, s * 0.6, 0.62, -L / 2 - 0.07);         // feux arrière
      add(new THREE.BoxGeometry(0.1, 0.1, 0.2), this.paintMat, s * 0.88, 0.98, 0.75 * sx);              // rétroviseurs
    }
    // Phares réels (projecteurs), actifs la nuit
    this.headSpots = [-1, 1].map((s) => {
      const sp = new THREE.SpotLight(0xfff0cc, 0, 70, 0.5, 0.5, 2);
      sp.position.set(s * 0.62, 0.6, L / 2); sp.target.position.set(s * 0.62, 0, L / 2 + 25);
      this.carRoot.add(sp, sp.target); return sp;
    });
    // Ombre de contact (utile la nuit, quand le soleil ne projette plus d'ombre)
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.5, L * 1.3).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
    blob.position.y = 0.03; this.carRoot.add(blob);

    // Roues
    const tireG = new THREE.CylinderGeometry(R, R, WW, 32).rotateZ(Math.PI / 2), tire = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    const discG = new THREE.CylinderGeometry(R * 0.66, R * 0.66, WW - 0.02, 24).rotateZ(Math.PI / 2), disc = new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.8, roughness: 0.4 });
    const spokeG = new THREE.BoxGeometry(WW + 0.02, R * 1.15, 0.07), spoke = new THREE.MeshStandardMaterial({ color: 0xc4cad1, metalness: 0.9, roughness: 0.25 });
    this.wheels = [];
    for (const fz of [1, -1]) for (const sxw of [-1, 1]) {
      const pivot = new THREE.Object3D(), spin = new THREE.Object3D();
      pivot.position.set(sxw * C.trackHalf, R, fz * C.wheelBase / 2);
      spin.add(new THREE.Mesh(tireG, tire), new THREE.Mesh(discG, disc));
      for (let k = 0; k < 3; k++) { const sp = new THREE.Mesh(spokeG, spoke); sp.rotation.x = k * Math.PI / 3; spin.add(sp); }
      spin.children[0].castShadow = true;
      pivot.add(spin); this.carRoot.add(pivot); this.wheels.push({ pivot, spin, front: fz > 0 });
    }
    this.scene.add(this.carRoot);
  }
  setCarColor(hex) { this.paintMat.color.set(hex); }

  _initUI() {
    this._ro = new ResizeObserver(() => this.resize()); this._ro.observe(this.container);
    if (this.cfg.hud.enabled) {
      if (getComputedStyle(this.container).position === 'static') this.container.style.position = 'relative';
      this.hud = document.createElement('div');
      this.hud.style.cssText = 'position:absolute;left:12px;bottom:12px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.55);color:#fff;font:600 14px/1.3 system-ui,sans-serif;pointer-events:none;white-space:pre';
      this.container.appendChild(this.hud);
    }
    if (!this.cfg.input.keyboard) return;
    const keys = { ArrowUp: 'throttle', KeyW: 'throttle', ArrowDown: 'brake', KeyS: 'brake', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'handbrake' };
    const handle = (e, down) => {
      if (keys[e.code]) this.input[keys[e.code]] = down ? 1 : 0;
      else if (down && !e.repeat && e.code === 'KeyC') this.cycleCameraPreset();
      else if (down && !e.repeat && e.code === 'KeyN') this.setTimeOfDay(this.hour + 3);
      else return;
      e.preventDefault();
    };
    this._kd = (e) => handle(e, true); this._ku = (e) => handle(e, false);
    this._blur = () => Object.keys(this.input).forEach((k) => (this.input[k] = 0));
    addEventListener('keydown', this._kd); addEventListener('keyup', this._ku); addEventListener('blur', this._blur);
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  /* ============================ CHARGEMENT DU MONDE ============================ */
  setOrigin(lat, lng) { this.proj = new GeoProjection(lat, lng); }

  /** Routes + bâtiments réels OpenStreetMap via Overpass (gratuit, sans clé). Un appel par zone, rayon modéré. */
  async loadFromOverpass(lat, lng, radius = this.cfg.osm.radius) {
    this.setOrigin(lat, lng);
    const dLat = radius / this.proj.mLat, dLng = radius / this.proj.mLng, bb = `${lat - dLat},${lng - dLng},${lat + dLat},${lng + dLng}`;
    const body = 'data=' + encodeURIComponent(`[out:json][timeout:25];(way["building"](${bb});way["highway"](${bb}););out geom;`);
    let lastErr = null;
    for (const url of this.cfg.osm.endpoints) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
        return this.loadFromOverpassJSON(await res.json(), lat, lng);
      } catch (err) { lastErr = err; }
    }
    throw lastErr;
  }

  /** Réponse Overpass au format "out geom". */
  loadFromOverpassJSON(json, lat0, lng0) {
    if (lat0 != null) this.setOrigin(lat0, lng0);
    const W = this.cfg.roads.widths, rnd = mulberry32(99), roads = [], buildings = [];
    for (const el of json.elements || []) {
      if (el.type !== 'way' || !el.geometry) continue;
      const pts = el.geometry.map((p) => { const l = this.proj.toLocal(p.lat, p.lon); return [l.x, l.z]; }), t = el.tags || {};
      if (t.building) buildings.push({ pts, height: this._height(t, rnd) });
      else if (W[t.highway] != null) { const w = parseFloat(t.width); roads.push({ pts, width: w > 2 ? w : W[t.highway] }); }
    }
    return this._finishLoad({ roads, buildings });
  }

  /** GeoJSON : Polygon/MultiPolygon = bâtiments ; LineString/MultiLineString + properties.highway = routes. */
  loadFromGeoJSON(fc, lat0, lng0) {
    const feats = fc.features || [];
    if (lat0 == null) {
      const all = []; const scan = (c) => (typeof c[0] === 'number' ? all.push(c) : c.forEach(scan));
      feats.forEach((f) => f.geometry && scan(f.geometry.coordinates));
      lat0 = (Math.min(...all.map((c) => c[1])) + Math.max(...all.map((c) => c[1]))) / 2;
      lng0 = (Math.min(...all.map((c) => c[0])) + Math.max(...all.map((c) => c[0]))) / 2;
    }
    this.setOrigin(lat0, lng0);
    const W = this.cfg.roads.widths, rnd = mulberry32(5), roads = [], buildings = [];
    const conv = (ring) => ring.map(([lng, lat]) => { const l = this.proj.toLocal(lat, lng); return [l.x, l.z]; });
    for (const { geometry: g, properties: p = {} } of feats) {
      if (!g) continue;
      if (g.type === 'Polygon') buildings.push({ pts: conv(g.coordinates[0]), height: this._height(p, rnd) });
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => buildings.push({ pts: conv(poly[0]), height: this._height(p, rnd) }));
      else if (/LineString/.test(g.type) && W[p.highway] != null)
        (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach((ln) => roads.push({ pts: conv(ln), width: W[p.highway] }));
    }
    return this._finishLoad({ roads, buildings });
  }

  /** Monde de démonstration : grille de rues + immeubles aléatoires (aucun réseau). */
  buildDemoCity() {
    const D = this.cfg.demo, B = this.cfg.buildings, rnd = mulberry32(D.seed), pitch = D.blockSize + D.roadWidth, N = D.blocks, half = N * pitch / 2;
    const roads = [], buildings = [], lot = D.blockSize / 2;
    for (let i = 0; i <= N; i++) {
      const p = -half + i * pitch;
      roads.push({ pts: [[p, -half], [p, half]], width: D.roadWidth }, { pts: [[-half, p], [half, p]], width: D.roadWidth });
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (rnd() < D.parkRatio) continue;
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        if (rnd() < 0.12) continue;
        const m = 3 + rnd() * 3, x0 = -half + i * pitch + D.roadWidth / 2 + a * lot + m, z0 = -half + j * pitch + D.roadWidth / 2 + b * lot + m;
        const x1 = x0 + lot - 2 * m - rnd() * 3, z1 = z0 + lot - 2 * m - rnd() * 3;
        buildings.push({ pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], height: B.minHeight + rnd() * (B.maxHeight - B.minHeight) * (rnd() < 0.2 ? 2 : 1) });
      }
    }
    return this._finishLoad({ roads, buildings }, true);
  }

  _finishLoad(data, force) {
    this.buildWorld(data);
    if (force || this.cfg.osm.placeCarOnRoad) this.placeCarOnNearestRoad(0, 0);
    return { roads: data.roads.length, buildings: data.buildings.length };
  }

  _height(tags, rnd) {
    const B = this.cfg.buildings, h = parseFloat(tags.height), lv = parseFloat(tags['building:levels'] ?? tags.levels);
    return h > 2 ? h : lv > 0 ? lv * B.levelHeight : B.minHeight + rnd() * (B.maxHeight - B.minHeight);
  }

  /** Construit la géométrie depuis { roads:[{pts:[[x,z]..],width}], buildings:[{pts:[[x,z]..],height}] } (mètres locaux). */
  buildWorld({ roads = [], buildings = [] }) {
    this.clearWorld();
    this.worldGroup = new THREE.Group(); this.scene.add(this.worldGroup);
    this._buildRoads(roads); this._buildProps(roads); this._buildBuildings(buildings);
    this._applyTime(this.hour);
  }

  clearWorld() {
    if (this.worldGroup) {
      this.worldGroup.traverse((o) => o.geometry?.dispose());
      this.scene.remove(this.worldGroup); this.worldGroup = null;
    }
    this.grid.clear(); this.roadSegs = [];
  }

  /* ---------- Routes : trottoir, bitume, ligne pointillée (3 maillages fusionnés) ---------- */
  _buildRoads(roads) {
    const sw = this.cfg.roads.sidewalk, R = { side: { p: [], u: [], i: [] }, road: { p: [], u: [], i: [] }, dash: { p: [], u: [], i: [] } };
    for (const r of roads) {
      this._ribbon(R.side, r.pts, r.width + 2 * sw, ROAD_Y - 0.03, false);
      this._ribbon(R.road, r.pts, r.width, ROAD_Y, false);
      if (r.width >= this.cfg.roads.centerLineMinWidth) this._ribbon(R.dash, r.pts, 0.2, ROAD_Y + 0.01, true);
      for (let i = 0; i < r.pts.length - 1; i++) this.roadSegs.push([...r.pts[i], ...r.pts[i + 1]]);
    }
    for (const [k, mat] of [['side', this.concreteMat], ['road', this.asphaltMat], ['dash', this.dashMat]]) {
      if (!R[k].p.length) continue;
      const m = new THREE.Mesh(flatGeometry(R[k]), mat); m.receiveShadow = true; this.worldGroup.add(m);
    }
  }

  /** Ruban le long d'une polyligne (joints en onglet). UV : mètres (u = 0 / largeur), ou 0..1 pour les pointillés. */
  _ribbon(R, pts, w, y, dash) {
    const P = [];
    for (const p of pts) { const q = P[P.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.05) P.push(p); }
    const n = P.length; if (n < 2) return;
    const D = [];
    for (let i = 0; i < n - 1; i++) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dz); D.push([dx / l, dz / l, l]); }
    const base = R.p.length / 3; let dist = 0;
    for (let i = 0; i < n; i++) {
      const a = D[Math.max(i - 1, 0)], c = D[Math.min(i, n - 2)];
      let tx = a[0] + c[0], tz = a[1] + c[1]; const l = Math.hypot(tx, tz);
      if (l < 1e-4) { tx = c[0]; tz = c[1]; } else { tx /= l; tz /= l; }
      const nx = -tz, nz = tx, h = w / 2 / Math.max(0.5, -nx * c[1] + nz * c[0]);
      R.p.push(P[i][0] + nx * h, y, P[i][1] + nz * h, P[i][0] - nx * h, y, P[i][1] - nz * h);
      R.u.push(0, dist, dash ? 1 : w, dist);
      if (i < n - 1) dist += D[i][2];
    }
    for (let i = 0; i < n - 1; i++) { const a = base + 2 * i; R.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }

  /** Points régulièrement espacés le long des routes, alternativement de chaque côté. */
  _along(roads, minW, spacing, phase, max, extra) {
    const out = []; let side = 1;
    for (const r of roads) {
      if (r.width < minW) continue;
      let next = phase, trav = 0;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], len = Math.hypot(bx - ax, bz - az);
        if (len < 1e-3) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        for (; next <= trav + len; next += spacing) {
          if (out.length >= max) return out;
          const t = next - trav, o = (r.width / 2 + extra) * (side = -side);
          out.push([ax + dx * t - dz * o, az + dz * t + dx * o]);
        }
        trav += len;
      }
    }
    return out;
  }

  /** Lampadaires (+ flaques de lumière additives) et arbres, en InstancedMesh. */
  _buildProps(roads) {
    const dummy = new THREE.Object3D(), rnd = mulberry32(11);
    const instanced = (geo, mat, spots, place, shadow) => {
      const m = new THREE.InstancedMesh(geo, mat, spots.length);
      spots.forEach((s, i) => { dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); place(dummy, s, i, m); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
      m.instanceMatrix.needsUpdate = true; m.frustumCulled = false; m.castShadow = !!shadow;
      this.worldGroup.add(m); return m;
    };
    const L = this.cfg.lamps, T = this.cfg.trees;
    if (L.enabled) {
      const s = this._along(roads, L.minRoadWidth, L.spacing, L.spacing / 2, L.max, 1.0);
      if (s.length) {
        instanced(new THREE.CylinderGeometry(0.07, 0.1, 6.4, 6), this.poleMat, s, (o, p) => o.position.set(p[0], 3.2 + ROAD_Y, p[1]), true);
        instanced(new THREE.SphereGeometry(0.3, 10, 8), this.lampMat, s, (o, p) => o.position.set(p[0], 6.5 + ROAD_Y, p[1]));
        instanced(new THREE.PlaneGeometry(14, 14).rotateX(-Math.PI / 2), this.poolMat, s, (o, p) => o.position.set(p[0], ROAD_Y + 0.04, p[1]));
      }
    }
    if (T.enabled) {
      const s = this._along(roads, T.minRoadWidth, T.spacing, T.spacing / 4, T.max, 2.2);
      if (s.length) {
        instanced(new THREE.CylinderGeometry(0.12, 0.18, 2.4, 6), this.trunkMat, s, (o, p) => o.position.set(p[0], 1.2, p[1]), true);
        const col = new THREE.Color();
        instanced(new THREE.IcosahedronGeometry(1.6, 1), this.leafMat, s, (o, p, i, m) => {
          const k = 0.8 + rnd() * 0.6;
          o.position.set(p[0], 3.6 + k, p[1]); o.scale.set(k, k * 1.2, k); o.rotation.y = rnd() * 6;
          m.setColorAt(i, col.setHSL(0.24 + rnd() * 0.08, 0.5, 0.2 + rnd() * 0.12));
        }, true);
      }
    }
  }

  /** Bâtiments extrudés, fusionnés : 1 maillage par couleur de mur + 1 pour les toits. */
  _buildBuildings(list) {
    const B = this.cfg.buildings, nM = this.wallMats.length, mk = () => ({ p: [], n: [], u: [] });
    const roof = mk(), walls = this.wallMats.map(mk); let count = 0;
    const push = (t, g, a, b) => {
      for (const [dst, name, k] of [[t.p, 'position', 3], [t.n, 'normal', 3], [t.u, 'uv', 2]]) {
        const arr = g.attributes[name].array; for (let i = a * k; i < b * k; i++) dst.push(arr[i]);
      }
    };
    for (const b of list) {
      if (count >= B.max) break;
      const pts = b.pts.slice(), f = pts[0], l = pts[pts.length - 1];
      if (pts.length > 1 && f[0] === l[0] && f[1] === l[1]) pts.pop();
      if (pts.length < 3) continue;
      try {
        // Contour dans le plan (x, -z), extrusion puis rotation : (x,y,z) -> (x, z, -y)
        const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: Math.max(3, b.height), bevelEnabled: false }).rotateX(-Math.PI / 2);
        for (const gr of g.groups) push(gr.materialIndex ? walls[count % nM] : roof, g, gr.start, gr.start + gr.count);   // groupe 0 = toits, 1 = murs
        g.dispose(); this.grid.add(pts); count++;
      } catch (err) { /* polygone invalide : ignoré */ }
    }
    const build = (t, mat) => {
      if (!t.p.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(t.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(t.u, 2));
      const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; this.worldGroup.add(m);
    };
    build(roof, this.roofMat); walls.forEach((t, i) => build(t, this.wallMats[i]));
  }

  /* ============================ VOITURE / CARTE ============================ */
  /** À appeler à chaque frame par VOTRE physique. speed (m/s signée), steer (rad, + = gauche), braking : optionnels. */
  setCarState({ x, z, heading, speed = null, steer = null, braking }) {
    Object.assign(this.car, { x, z, heading, speed, steer });
    if (braking != null) this.car.braking = !!braking;
  }
  setCarGeo({ lat, lng, bearingDeg = 0 }) { const l = this.proj.toLocal(lat, lng); this._teleport(l.x, l.z, bearingToHeading(bearingDeg)); }
  /** Position GPS, cap boussole et vitesse (pour votre mini-carte Leaflet). */
  getCarGeo() { const g = this.proj.toGeo(this.car.x, this.car.z); return { ...g, bearingDeg: headingToBearing(this.car.heading), speedKmh: Math.abs(this._vis.speed) * 3.6 }; }

  _teleport(x, z, heading) {
    Object.assign(this.car, { x, z, heading, speed: null, steer: null, yawRate: 0, braking: false });
    Object.assign(this._ph, { vx: 0, vz: 0, steer: 0 }); this._vis.first = true;
    this.camHeading = heading; this._updateCamera(0, true);
  }

  placeCarOnNearestRoad(x = 0, z = 0) {
    let best = Infinity, bx = x, bz = z, bh = 0;
    for (const [ax, az, cx, cz] of this.roadSegs) {
      const dx = cx - ax, dz = cz - az, l2 = dx * dx + dz * dz; if (l2 < 1e-6) continue;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1), px = ax + dx * t, pz = az + dz * t, d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < best) { best = d; bx = px; bz = pz; bh = Math.atan2(dx, dz); }
    }
    this._teleport(bx, bz, bh);
  }

  /** Collision voiture (2 cercles) / bâtiments -> position corrigée + normale du choc. À utiliser dans votre physique. */
  collide(x, z, heading) {
    const K = this.cfg.collision, s = Math.sin(heading), c = Math.cos(heading); let nx = 0, nz = 0, hit = false;
    for (let pass = 0; pass < K.passes; pass++) {
      let any = false;
      for (const sign of [1, -1]) {
        const r = this.grid.pushOut(x + s * K.circleOffset * sign, z + c * K.circleOffset * sign, K.radius);
        if (r) { x += r.nx * r.depth; z += r.nz * r.depth; nx += r.nx; nz += r.nz; any = hit = true; }
      }
      if (!any) break;
    }
    const l = Math.hypot(nx, nz) || 1;
    return { x, z, hit, nx: nx / l, nz: nz / l };
  }

  /* ============================ JOUR / NUIT ============================ */
  setTimeOfDay(h) { this.hour = ((h % 24) + 24) % 24; this._applyTime(this.hour); }
  setAutoCycle(on) { this.autoCycle = !!on; }

  _applyTime(hour, forceEnv) {
    const L = this.cfg.lighting, a = ((hour - 6) / 12) * Math.PI, e = Math.sin(a), c = this._c;
    this.sunDir.set(Math.cos(a) * 0.8, e, 0.5).normalize();          // 6 h lever, 12 h zénith, 18 h coucher
    const day = smooth(-0.15, 0.3, e), night = 1 - day, dusk = clamp(1 - Math.abs(e) / 0.35, 0, 1), U = this.skyMat.uniforms;
    U.uTop.value.set(L.skyNightTop).lerp(c.set(L.skyDayTop), day);
    U.uHor.value.set(L.skyNightHor).lerp(c.set(L.skyDayHor), day).lerp(c.set(L.skyDusk), dusk * 0.7);
    U.uSun.value.set(0xfff0d0).lerp(c.set(0xff9a50), dusk).multiplyScalar(smooth(-0.08, 0.08, e));
    this.scene.fog.color.copy(U.uHor.value);
    this.sun.intensity = L.sunIntensity * smooth(-0.05, 0.25, e);
    this.sun.color.set(0xffffff).lerp(c.set(0xffa860), dusk * 0.7);
    this.moon.intensity = L.moonIntensity * night;
    this.wallMats.forEach((m) => (m.emissiveIntensity = night * this.cfg.buildings.windowGlow));
    this.lampMat.emissiveIntensity = night * this.cfg.lamps.glow;
    this.poolMat.opacity = night * 0.6;
    this.headSpots.forEach((s) => (s.intensity = night * this.cfg.car.headlightIntensity));
    this.headMat.emissiveIntensity = 0.2 + night * 2.2;
    this.starsMat.opacity = clamp((night - 0.35) / 0.65, 0, 1);
    this.stars.rotation.x = (hour / 24) * Math.PI * 2;
    this._night = night;
    // Réflexions IBL : régénérées de temps en temps seulement (coûteux)
    const dh = Math.abs(hour - this._envHour);
    if (forceEnv || Math.min(dh, 24 - dh) > this.cfg.time.envUpdateHours) {
      this._envHour = hour;
      const rt = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
      this.scene.environment = rt.texture; this.envRT?.dispose(); this.envRT = rt;
    }
  }

  /* ============================ CAMÉRA ============================ */
  cycleCameraPreset() { const n = Object.keys(this.cfg.camera.presets); this.cameraPreset = n[(n.indexOf(this.cameraPreset) + 1) % n.length]; }
  setCameraPreset(name) { if (this.cfg.camera.presets[name]) this.cameraPreset = name; }

  _updateCamera(dt, snap = false) {
    const K = this.cfg.camera, P = K.presets[this.cameraPreset], c = this.car;
    this.camHeading += wrapPi(c.heading - this.camHeading) * (snap ? 1 : 1 - Math.exp(-K.headingLag * dt));   // retard de cap : dérives lisibles
    const fx = Math.sin(this.camHeading), fz = Math.cos(this.camHeading), p = this.camera.position;
    const tx = c.x - fx * P.distance, ty = Math.max(1, P.height), tz = c.z - fz * P.distance, k = snap ? 1 : 1 - Math.exp(-K.positionSmoothing * dt);
    p.set(lerp(p.x, tx, k), lerp(p.y, ty, k), lerp(p.z, tz, k));
    this.camera.lookAt(c.x + fx * P.lookAhead, P.lookHeight, c.z + fz * P.lookAhead);
    const fov = K.fov + K.speedFovBoost * clamp(Math.abs(this._vis.speed) / K.speedRef, 0, 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = lerp(this.camera.fov, fov, snap ? 1 : 0.1); this.camera.updateProjectionMatrix(); }
  }

  /** Ombres, ciel et astres suivent la voiture / la caméra. */
  _follow() {
    const { x, z } = this.car, d = this.sunDir, cp = this.camera.position;
    this.sun.position.set(x + d.x * 200, d.y * 200 + 10, z + d.z * 200); this.sun.target.position.set(x, 0, z);
    this.moon.position.set(x - d.x * 200, Math.max(20, -d.y * 200), z - d.z * 200); this.moon.target.position.set(x, 0, z);
    this.ground.position.set(x, 0, z);
    const m = this.groundMat.map, g = this.cfg.ground;
    m.offset.set(x / g.tile, -z / g.tile);                       // la texture reste ancrée dans le monde
    this.dome.position.copy(cp); this.stars.position.copy(cp);
    this.moonDisc.position.set(cp.x - d.x * 800, cp.y - d.y * 800, cp.z - d.z * 800);
    this.moonDisc.visible = d.y < 0.1;
  }

  /* ============================ ANIMATION DE LA VOITURE ============================ */
  _updateCarVisual(dt) {
    const C = this.cfg.car, c = this.car, v = this._vis;
    if (v.first) { Object.assign(v, { lx: c.x, lz: c.z, lh: c.heading, ls: 0, speed: 0, first: false }); }
    const s = Math.sin(c.heading), co = Math.cos(c.heading), dx = c.x - v.lx, dz = c.z - v.lz, ok = dt > 0 && Math.hypot(dx, dz) < 20;
    const speed = c.speed ?? (ok ? (dx * s + dz * co) / dt : 0), yaw = ok ? wrapPi(c.heading - v.lh) / dt : 0, acc = dt > 0 ? (speed - v.ls) / dt : 0;
    c.yawRate = yaw; v.speed = speed;
    this.carRoot.position.set(c.x, ROAD_Y, c.z); this.carRoot.rotation.y = c.heading;

    v.spin += (speed * dt) / C.wheelRadius;     // rotation des roues = distance / rayon
    const vv = Math.abs(speed) < 1 ? (speed >= 0 ? 1 : -1) : speed;
    const steerT = clamp(c.steer ?? Math.atan((yaw * C.wheelBase) / vv) * smooth(0.2, 1.5, Math.abs(speed)), -C.maxSteerVisual, C.maxSteerVisual);
    v.steer += (steerT - v.steer) * (1 - Math.exp(-12 * dt));
    for (const w of this.wheels) { w.spin.rotation.x = v.spin; if (w.front) w.pivot.rotation.y = v.steer; }

    const k = 1 - Math.exp(-8 * dt);            // roulis (centrifuge) et tangage (accélération)
    v.roll += (clamp(speed * yaw * C.rollFactor * 9.81, -C.maxRoll, C.maxRoll) - v.roll) * k;
    v.pitch += (clamp(-acc * C.pitchFactor, -C.maxPitch, C.maxPitch) - v.pitch) * k;
    this.bodyGroup.rotation.set(v.pitch, 0, v.roll);

    this.tailMat.emissiveIntensity = 0.5 + this._night * 0.8 + (c.braking || (speed > 1 && acc < -6) ? 3 : 0);
    Object.assign(v, { lx: c.x, lz: c.z, lh: c.heading, ls: speed });
  }

  /* ============================ PHYSIQUE ARCADE DE TEST ============================ */
  _stepTestPhysics(dt) {
    const P = this.cfg.testPhysics, c = this.car, i = this.input, ph = this._ph;
    let s = Math.sin(c.heading), co = Math.cos(c.heading);       // avant = (s, co), gauche = (co, -s)
    let vF = ph.vx * s + ph.vz * co, vL = ph.vx * co - ph.vz * s, braking = false;
    if (i.throttle > 0) {
      if (vF < -0.5) { vF += P.brakePower * dt; braking = true; }
      else vF += P.acceleration * i.throttle * (1 - clamp(vF / P.maxSpeed, 0, 1)) * dt;
    }
    if (i.brake > 0) {
      if (vF > 0.5) { vF -= P.brakePower * dt; braking = true; }
      else vF -= P.reverseAcceleration * i.brake * (1 - clamp(-vF / P.maxReverseSpeed, 0, 1)) * dt;
    }
    const decel = (d) => { vF = Math.abs(vF) <= d ? 0 : vF - Math.sign(vF) * d; };
    if (i.throttle <= 0 && i.brake <= 0) decel((P.rollingDrag + P.airDrag * Math.abs(vF)) * dt);
    const hb = i.handbrake > 0; if (hb) { decel(P.handbrakeDecel * dt); braking = true; }
    // Adhérence latérale faible au frein à main / en glissade => drift arcade
    vL *= Math.exp(-(hb ? P.gripHandbrake : P.grip) * (Math.abs(vL) > P.slideThreshold ? P.slideGripFactor : 1) * dt);
    // Direction dépendant de la vitesse (modèle bicyclette)
    const target = (i.left - i.right) * lerp(P.steerLow, P.steerHigh, clamp(Math.abs(vF) / P.maxSpeed, 0, 1));
    ph.steer += (target - ph.steer) * (1 - Math.exp(-P.steerResponse * dt));
    let yaw = (vF / this.cfg.car.wheelBase) * Math.tan(ph.steer);
    if (hb && Math.abs(vF) > 5) yaw *= P.handbrakeYawBoost;
    yaw = clamp(yaw, -P.maxYawRate, P.maxYawRate);
    // Vitesse monde (ancienne base) puis rotation du cap : la dérive apparaît naturellement
    let vx = s * vF + co * vL, vz = co * vF - s * vL;
    c.heading += yaw * dt; c.x += vx * dt; c.z += vz * dt;
    const res = this.collide(c.x, c.z, c.heading);
    if (res.hit) {
      c.x = res.x; c.z = res.z;
      const vn = vx * res.nx + vz * res.nz;
      if (vn < 0) {
        const f = 1 - P.wallFriction;
        vx = (vx - (1 + P.bounce) * vn * res.nx) * f; vz = (vz - (1 + P.bounce) * vn * res.nz) * f;
        this.onCollision?.({ impact: -vn, nx: res.nx, nz: res.nz });
      }
    }
    ph.vx = vx; ph.vz = vz; s = Math.sin(c.heading); co = Math.cos(c.heading);
    Object.assign(c, { speed: vx * s + vz * co, steer: ph.steer, braking });
  }

  /* ============================ BOUCLE ============================ */
  /** Une frame complète : hook -> physique de test -> temps -> visuel -> caméra -> rendu. */
  update(dt) {
    dt = clamp(dt, 0, 0.05);
    this.onBeforeUpdate?.(dt, this);
    if (this.useBuiltInPhysics) this._stepTestPhysics(dt);
    if (this.autoCycle) this.setTimeOfDay(this.hour + (dt * 24) / this.cfg.time.dayLengthSeconds);
    this._updateCarVisual(dt); this._updateCamera(dt); this._follow();
    if (this.hud) {
      const h = Math.floor(this.hour), m = Math.floor((this.hour % 1) * 60);
      this.hud.textContent = `${Math.round(Math.abs(this._vis.speed) * 3.6)} km/h\n${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    this.renderer.render(this.scene, this.camera);
  }
  start() {
    if (this._running) return;
    this._running = true; let last = performance.now();
    const loop = (t) => { if (!this._running) return; this._raf = requestAnimationFrame(loop); this.update((t - last) / 1000); last = t; };
    this._raf = requestAnimationFrame(loop);
  }
  stop() { this._running = false; cancelAnimationFrame(this._raf); }

  dispose() {
    this.stop(); this._ro.disconnect();
    if (this._kd) { removeEventListener('keydown', this._kd); removeEventListener('keyup', this._ku); removeEventListener('blur', this._blur); }
    this.clearWorld();
    this.scene.traverse((o) => { o.geometry?.dispose(); [].concat(o.material || []).forEach((m) => { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }); });
    this.envRT?.dispose(); this.pmrem.dispose(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.hud?.remove();
  }
}

/** Démo autonome : createDemo(document.getElementById('game3d')) */
export function createDemo(container, config = {}) {
  const w = new CarWorld3D(container, { config });
  w.buildDemoCity(); w.start();
  return w;
}
