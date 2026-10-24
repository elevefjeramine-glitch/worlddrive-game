/* =============================================================================
 *  CarGame — module physique / gameplay / personnages pour jeu de voiture
 *  en monde ouvert sur carte réelle (Leaflet + OpenStreetMap).
 *
 *  - Aucune clé d'API, aucun service payant (tuiles OSM publiques).
 *  - Un seul fichier, sans dépendance autre que Leaflet (window.L).
 *  - Fonctionne seul pour test : il suffit de charger Leaflet puis ce fichier,
 *    la partie démarre automatiquement (désactivable, voir plus bas).
 *
 *  UTILISATION RAPIDE
 *  ------------------
 *    <link rel="stylesheet" href=".../leaflet.css">
 *    <script src=".../leaflet.js"></script>
 *    <script src="cargame.js"></script>        <!-- démarrage auto (test) -->
 *
 *  UTILISATION DANS TON PROJET
 *  ---------------------------
 *    window.CARGAME_NO_AUTOBOOT = true;         // avant de charger le module
 *    const game = CarGame.create({
 *      map: maCarteLeaflet,                     // optionnel (sinon créée seule)
 *      start: { lat: 48.8566, lng: 2.3522 },    // surcharge de la config
 *      physics: { gripNormal: 7 }               // surcharge partielle
 *    });
 *    game.on('collision', e => console.log(e.impact, e.damage));
 *    game.addObstacle({ lat: 48.857, lng: 2.353, radius: 3 });
 *    game.start('slick');                       // ou game.openSelect()
 *
 *  CONTRÔLES
 *  ---------
 *    Flèches ou WASD (touches physiques : ZQSD sur AZERTY fonctionne aussi)
 *    Espace / Shift : frein à main (drift)      R : réapparaître
 *    Échap : retour au choix du personnage      Boutons tactiles auto sur mobile
 *
 *  Note OSM : les tuiles publiques tile.openstreetmap.org sont faites pour un
 *  usage léger. Pour un vrai déploiement, utilise ton propre serveur de tuiles
 *  (changer `view.tileUrl` ci-dessous).
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CarGame = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ===========================================================================
   *  1) VALEURS RÉGLABLES  (tout se règle ici)
   * ========================================================================= */
  const CONFIG = {

    /* Point de départ sur la carte */
    start: {
      lat: 48.8566,          // latitude
      lng: 2.3522,           // longitude
      headingDeg: 0,         // 0 = nord, 90 = est, 180 = sud, 270 = ouest
      zoom: 18               // zoom initial (17-19 conseillé)
    },

    /* Carte principale / caméra (groupe 'view' ; l'option `map` sert à passer ta carte Leaflet) */
    view: {
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      minZoom: 15,
      maxZoom: 19,
      cameraLookAheadSec: 0.7,   // la caméra regarde vers l'avant (secondes de vitesse)
      cameraSmoothing: 8         // plus grand = caméra plus rigide / réactive
    },

    /* Dimensions de la voiture (mètres) */
    car: {
      lengthM: 4.4,
      widthM: 1.9,
      circleRadius: 1.15,        // 2 cercles de collision (avant / arrière)
      circleOffset: 1.15,        // distance de chaque cercle au centre
      minIconPx: 14              // taille minimale de l'icône à l'écran
    },

    /* Physique */
    physics: {
      fixedStep: 1 / 60,         // pas de simulation (s)

      /* Conversion note (1..10) -> valeur réelle */
      topSpeedBaseKmh: 120,   topSpeedPerRatingKmh: 9,    // vmax = 120 + 9*note
      accelBase: 4,           accelPerRating: 0.9,        // m/s² = 4 + 0.9*note
      yawBase: 1.6,           yawPerRating: 0.14,         // rad/s max de rotation
      hpBase: 60,             hpPerRating: 14,            // points de vie
      damageMulBase: 1.25,    damageMulPerRating: 0.085,  // dégâts subis (plus la résistance monte, moins on en prend)

      /* Accélération progressive */
      accelCurveExp: 3,          // forme de la courbe (plus grand = reste vive jusqu'près de la vmax)
      throttleRise: 2.5,         // montée de l'accélérateur (par seconde)
      throttleFall: 5,           // relâchement de l'accélérateur

      /* Freinage / marche arrière */
      brakeDecel: 28,            // m/s²
      handbrakeDecel: 3.5,       // m/s² en plus avec le frein à main
      reverseAccel: 7,           // m/s²
      reverseMaxKmh: 45,

      /* Inertie / friction */
      rollingResistance: 1.5,    // m/s² constant (frottements)
      airDrag: 0.0002,           // m/s² par (m/s)² (résistance de l'air)

      /* Direction */
      steerRise: 4.0,            // vitesse à laquelle le volant se tourne
      steerReturn: 7.0,          // retour au centre
      steerFalloffKmh: 110,      // vitesse où la direction devient 2x moins vive
      steerFalloffPow: 1.5,
      lowSpeedRef: 3,            // m/s : en dessous, la direction est atténuée
      slideSteerMin: 0.5,        // direction minimale conservée pendant un drift

      /* Adhérence & drift (arcade) */
      gripNormal: 9,             // adhérence latérale normale (1/s)
      gripSlide: 3.6,            // adhérence quand la voiture glisse
      gripHandbrake: 1.6,        // adhérence avec le frein à main
      slideEnter: 7,             // m/s de glissement latéral pour entrer en drift
      slideExit: 1.8,            // m/s de glissement latéral pour en sortir
      gripTransferNormal: 0.9,   // part de la vitesse latérale reconvertie en avant (virage)
      gripTransferSlide: 0.6,    // idem en drift (plus petit = on perd plus de vitesse)
      slipScrub: 0.10,           // perte de vitesse par glissement
      handbrakeYawBoost: 1.35,   // la voiture tourne plus avec le frein à main
      slideYawBoost: 1.0,            // 1 = pas de bonus de rotation pendant la glisse

      maxSpeedOverrun: 1.02      // tolérance au-dessus de la vitesse max
    },

    /* Collisions */
    collision: {
      restitution: 0.35,         // rebond (obstacles durs)
      softRestitution: 0.05,     // rebond (cônes, objets mous)
      wallFriction: 0.15,        // perte de vitesse à chaque choc
      damageThresholdMs: 4,      // m/s : en dessous, aucun dégât
      damageScale: 3.2,          // PV perdus par m/s au-dessus du seuil
      worldRadiusM: 0            // 0 = désactivé ; sinon mur invisible autour du départ
    },

    /* Gameplay */
    game: {
      respawnDelaySec: 2.5,
      respawnAtStart: true,
      drift: {
        minAngleDeg: 12,         // angle mini pour compter un drift
        minSpeedKmh: 25,
        scoreRate: 0.12,         // points = temps * vitesse * angle * scoreRate
        holdSec: 1.0             // délai avant d'encaisser le score
      }
    },

    /* Obstacles de test générés autour du départ */
    world: {
      generateTestProps: true,
      propCount: 70,
      minDistM: 25,
      maxDistM: 450,
      seed: 1337,
      skidMarksMax: 120,
      kinds: {                   // rayons agrandis exprès (lisibles à l'écran)
        cone:   { radius: 1.1, soft: true,  color: '#ff8c1a' },
        barrel: { radius: 1.3, soft: false, color: '#3a86ff' },
        crate:  { radius: 1.8, soft: false, color: '#a0703c' },
        pillar: { radius: 2.6, soft: false, color: '#8d99ae' }
      }
    },

    /* Interface */
    ui: {
      touchControls: 'auto',     // 'auto' | true | false
      minimap: true,
      minimapSize: 140,          // px
      minimapZoom: 16,
      lang: {
        title: 'Choisis ton conducteur',
        play: 'Démarrer',
        hint: 'Flèches / WASD · Espace = frein à main (drift) · R = réapparaître · Échap = menu',
        topSpeed: 'Vitesse max', acceleration: 'Accélération',
        handling: 'Maniabilité', resistance: 'Résistance',
        wrecked: 'Épave ! Réapparition…', respawned: 'C\'est reparti !',
        drift: 'DRIFT', brake: 'FREIN', gas: 'GAZ', handbrake: 'DRIFT'
      }
    }
  };

  /* ===========================================================================
   *  2) PERSONNAGES  (notes de 1 à 10 ; modifie / ajoute les tiens ici)
   *  Personnages originaux inspirés des archétypes "bodybuilder légendaire"
   *  et "gens de la rue" façon GTA.
   * ========================================================================= */
  const CHARACTERS = [
    {
      id: 'ironmack', name: 'Mack « Iron » Hargrove', color: '#d62828',
      description: 'Légende old-school du bodybuilding. Pas le plus rapide, mais un vrai char d\'assaut : rien ne l\'arrête.',
      stats: { topSpeed: 6, acceleration: 7, handling: 5, resistance: 10 }
    },
    {
      id: 'leviathan', name: 'Léon « Léviathan » Kowal', color: '#f77f00',
      description: 'Géant tout en muscles et en sourire calme. Puissance brute, vire comme un paquebot.',
      stats: { topSpeed: 9, acceleration: 6, handling: 3, resistance: 9 }
    },
    {
      id: 'slick', name: 'Tony « Slick » Marino', color: '#00b4d8',
      description: 'Ex-livreur de pizzas devenu pilote de rue. Rapide, nerveux, mais fragile comme du verre.',
      stats: { topSpeed: 8, acceleration: 8, handling: 8, resistance: 3 }
    },
    {
      id: 'cobra', name: 'Lola « Cobra » Vega', color: '#ff4ecd',
      description: 'Reine du drift des parkings de nuit. Démarre en trombe et dérape avec le sourire.',
      stats: { topSpeed: 6, acceleration: 9, handling: 10, resistance: 4 }
    },
    {
      id: 'tank', name: 'Rico « Tank » Delgado', color: '#2d6a4f',
      description: 'Convoyeur de camionnettes "empruntées". Lourd, solide, il passe à travers tout.',
      stats: { topSpeed: 5, acceleration: 5, handling: 6, resistance: 9 }
    },
    {
      id: 'ghost', name: 'Jaxon « Ghost » Rivera', color: '#7b2cbf',
      description: 'Coursier de nuit discret. Équilibré partout, parfait pour débuter dans les rues.',
      stats: { topSpeed: 7, acceleration: 7, handling: 7, resistance: 6 }
    },
    {
      id: 'mikeohearn', name: 'Mike O\'Hearn', color: '#ffb703',
      description: 'Légende du bodybuilding, le Titan. Puissance et résistance maximales, une voiture qui encaisse tout.',
      stats: { topSpeed: 7, acceleration: 7, handling: 6, resistance: 10 }
    },
    {
      id: 'kevinlevrone', name: 'Kevin Levrone', color: '#ff6d00',
      description: 'La Maryland Muscle Machine. Vitesse et puissance de sprinteur, maniabilité plus lourde.',
      stats: { topSpeed: 9, acceleration: 8, handling: 5, resistance: 8 }
    }
  ];

  /* ===========================================================================
   *  3) OUTILS
   * ========================================================================= */
  const DEG = Math.PI / 180;
  const M_PER_DEG_LAT = 111320;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
  const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const mPerDegLng = lat => M_PER_DEG_LAT * Math.cos(lat * DEG);

  function mulberry32(a) {                       // petit générateur pseudo-aléatoire reproductible
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function deepMerge(base, extra) {              // fusion récursive (retourne un nouvel objet)
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!extra || typeof extra !== 'object') return out;
    Object.keys(extra).forEach(k => {
      const v = extra[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null && !(v instanceof Element_)) {
        out[k] = deepMerge(out[k], v);
      } else out[k] = v;
    });
    return out;
  }
  const Element_ = (typeof Element !== 'undefined') ? Element : function () {};

  /** Convertit un personnage (notes 1..10) en valeurs physiques réelles. */
  function deriveSpec(ch, P) {
    const s = ch.stats;
    return {
      id: ch.id, name: ch.name, color: ch.color,
      vMax: (P.topSpeedBaseKmh + s.topSpeed * P.topSpeedPerRatingKmh) / 3.6,   // m/s
      accel: P.accelBase + s.acceleration * P.accelPerRating,                  // m/s²
      yawMax: P.yawBase + s.handling * P.yawPerRating,                         // rad/s
      maxHp: P.hpBase + s.resistance * P.hpPerRating,
      damageMul: Math.max(0.25, P.damageMulBase - s.resistance * P.damageMulPerRating),
      vReverse: P.reverseMaxKmh / 3.6
    };
  }

  /* ===========================================================================
   *  4) VOITURE : physique pure (sans DOM, testable seule)
   *  Repère local : x = est, y = nord (mètres). cap 0 = nord, sens horaire.
   * ========================================================================= */
  const NO_INPUT = { up: false, down: false, left: false, right: false, handbrake: false };

  class Car {
    constructor(cfg, spec, start) {
      this.cfg = cfg; this.P = cfg.physics; this.spec = spec;
      this.start = start;
      this.reset();
    }

    reset() {
      const s = this.start;
      this.lat = s.lat; this.lng = s.lng;
      this.heading = (s.headingDeg || 0) * DEG;
      this.vx = 0; this.vy = 0;                 // vitesse (m/s) est / nord
      this.throttle = 0; this.steer = 0;
      this.sliding = false;
      this.hp = this.spec.maxHp;
      this.wrecked = false;
      this.speed = 0; this.kmh = 0; this.vF = 0; this.vR = 0; this.driftAngleDeg = 0;
    }

    setSpec(spec) { this.spec = spec; this.hp = spec.maxHp; }

    /** Avance la simulation d'un pas dt. */
    step(dt, input, obstacles) {
      const P = this.P, S = this.spec;
      const inp = this.wrecked ? NO_INPUT : input;

      /* --- Entrées -> accélérateur / frein / volant (avec lissage) --- */
      const fx0 = Math.sin(this.heading), fy0 = Math.cos(this.heading);
      let vF = this.vx * fx0 + this.vy * fy0;

      let thrTarget = 0, braking = false;
      const up = inp.up && !inp.down, down = inp.down && !inp.up;
      if (up)        { if (vF < -0.5) braking = true; else thrTarget = 1; }
      else if (down) { if (vF > 0.5)  braking = true; else thrTarget = -1; }

      const thrRate = Math.abs(thrTarget) > Math.abs(this.throttle) ? P.throttleRise : P.throttleFall;
      this.throttle = approach(this.throttle, thrTarget, thrRate * dt);

      const steerTarget = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let steerRate = P.steerRise;
      if (steerTarget === 0) steerRate = P.steerReturn;
      else if (this.steer !== 0 && Math.sign(steerTarget) !== Math.sign(this.steer)) steerRate = P.steerRise * 1.8;
      this.steer = approach(this.steer, steerTarget, steerRate * dt);

      /* --- Rotation : dépend de la vitesse (plus vite = direction plus lente) --- */
      const speedAbs = Math.abs(vF), kmhF = speedAbs * 3.6;
      let falloff = 1 / (1 + Math.pow(kmhF / P.steerFalloffKmh, P.steerFalloffPow));
      if (this.sliding) falloff = Math.max(falloff, P.slideSteerMin);
      const ramp = clamp(speedAbs / P.lowSpeedRef, 0, 1);       // pas de rotation à l'arrêt
      let yaw = this.steer * S.yawMax * falloff * ramp * (vF >= 0 ? 1 : -1);
      if (inp.handbrake && speedAbs > 3) yaw *= P.handbrakeYawBoost;
      else if (this.sliding) yaw *= P.slideYawBoost;
      this.heading = wrapPi(this.heading + yaw * dt);

      /* --- Décomposition de la vitesse sur le nouveau cap --- */
      const fx = Math.sin(this.heading), fy = Math.cos(this.heading);   // avant
      const rx = Math.cos(this.heading), ry = -Math.sin(this.heading);  // droite
      vF = this.vx * fx + this.vy * fy;
      let vR = this.vx * rx + this.vy * ry;                             // glissement latéral

      /* --- Longitudinal : moteur, frein, friction, inertie --- */
      let a = 0;
      if (this.throttle > 0) {
        const c = Math.max(0, 1 - Math.pow(Math.max(vF, 0) / S.vMax, P.accelCurveExp));
        a = S.accel * this.throttle * c;                                 // progressive : s'essouffle vers vmax
      } else if (this.throttle < 0) {
        const c = Math.max(0, 1 - Math.pow(Math.max(-vF, 0) / S.vReverse, 2));
        a = P.reverseAccel * this.throttle * c;                          // marche arrière
      }
      vF += a * dt;

      let decel = P.rollingResistance + P.airDrag * vF * vF;
      if (braking) decel += P.brakeDecel;
      if (inp.handbrake) decel += P.handbrakeDecel;
      const dv = decel * dt;
      if (Math.abs(vF) <= dv) vF = 0; else vF -= Math.sign(vF) * dv;

      /* --- Adhérence latérale : normal / glisse / frein à main --- */
      if (!this.sliding && (Math.abs(vR) > P.slideEnter || (inp.handbrake && speedAbs > 6))) this.sliding = true;
      else if (this.sliding && !inp.handbrake && Math.abs(vR) < P.slideExit) this.sliding = false;

      let grip = this.sliding ? P.gripSlide : P.gripNormal;
      if (inp.handbrake) grip = Math.min(grip, P.gripHandbrake);
      const removed = vR * (1 - Math.exp(-grip * dt));
      vR -= removed;
      // La vitesse latérale retirée est (en partie) reconvertie vers l'avant : on tourne sans perdre de vitesse
      vF += (vF >= 0 ? 1 : -1) * Math.abs(removed) * (this.sliding ? P.gripTransferSlide : P.gripTransferNormal);
      if (this.sliding) vF -= Math.sign(vF) * Math.min(Math.abs(vF), P.slipScrub * Math.abs(vR) * dt);

      vF = clamp(vF, -S.vReverse * 1.05, S.vMax * P.maxSpeedOverrun);

      /* --- Recomposition + intégration de la position (m -> degrés) --- */
      this.vx = fx * vF + rx * vR;
      this.vy = fy * vF + ry * vR;
      this.lat += (this.vy * dt) / M_PER_DEG_LAT;
      this.lng += (this.vx * dt) / mPerDegLng(this.lat);

      /* --- Collisions --- */
      this.lastImpact = null;
      this._collide(obstacles);

      /* --- Télémétrie --- */
      this.speed = Math.hypot(this.vx, this.vy);
      this.kmh = this.speed * 3.6;
      this.vF = this.vx * fx + this.vy * fy;
      this.vR = this.vx * rx + this.vy * ry;
      if (this.speed > 1 && this.vF > 0) {
        this.driftAngleDeg = Math.abs(wrapPi(Math.atan2(this.vx, this.vy) - this.heading)) / DEG;
      } else this.driftAngleDeg = 0;
    }

    /** Décalage (mètres) le long du cap / latéral -> {lat, lng} */
    offsetLatLng(along, lateral) {
      const fx = Math.sin(this.heading), fy = Math.cos(this.heading);
      const rx = Math.cos(this.heading), ry = -Math.sin(this.heading);
      const dx = fx * along + rx * lateral, dy = fy * along + ry * lateral;
      return { lat: this.lat + dy / M_PER_DEG_LAT, lng: this.lng + dx / mPerDegLng(this.lat) };
    }

    /* Collisions cercle/cercle avec les obstacles + mur circulaire optionnel */
    _collide(obstacles) {
      const C = this.cfg.collision, car = this.cfg.car;
      const mLng = mPerDegLng(this.lat);
      const fx = Math.sin(this.heading), fy = Math.cos(this.heading);

      for (const off of [car.circleOffset, -car.circleOffset]) {
        for (let i = 0; i < obstacles.length; i++) {
          const o = obstacles[i];
          // position du cercle de la voiture par rapport à l'obstacle (mètres)
          const cx = (this.lng - o.lng) * mLng + fx * off;
          const cy = (this.lat - o.lat) * M_PER_DEG_LAT + fy * off;
          if (Math.abs(cx) > 30 || Math.abs(cy) > 30) continue;            // rejet rapide
          const d = Math.hypot(cx, cy), minD = o.radius + car.circleRadius;
          if (d >= minD || d < 1e-6) continue;
          this._resolve(cx / d, cy / d, minD - d, o.soft, o, C);
        }
        // Mur invisible circulaire autour du point de départ
        if (C.worldRadiusM > 0) {
          const wx = (this.lng - this.start.lng) * mLng + fx * off;
          const wy = (this.lat - this.start.lat) * M_PER_DEG_LAT + fy * off;
          const wd = Math.hypot(wx, wy), lim = C.worldRadiusM - car.circleRadius;
          if (wd > lim && wd > 1e-6) this._resolve(-wx / wd, -wy / wd, wd - lim, false, null, C);
        }
      }
    }

    _resolve(nx, ny, pen, soft, obstacle, C) {
      // 1) on sort la voiture de l'obstacle
      this.lat += (ny * pen) / M_PER_DEG_LAT;
      this.lng += (nx * pen) / mPerDegLng(this.lat);
      // 2) rebond sur la normale
      const vn = this.vx * nx + this.vy * ny;
      if (vn >= 0) return;
      const impact = -vn, rest = soft ? C.softRestitution : C.restitution;
      this.vx -= (1 + rest) * vn * nx;
      this.vy -= (1 + rest) * vn * ny;
      const loss = 1 - C.wallFriction * (soft ? 0.3 : 1);
      this.vx *= loss; this.vy *= loss;
      // 3) dégâts
      let damage = 0;
      if (!soft && impact > C.damageThresholdMs) {
        damage = (impact - C.damageThresholdMs) * C.damageScale * this.spec.damageMul;
        this.hp = Math.max(0, this.hp - damage);
      }
      if (!this.lastImpact || impact > this.lastImpact.impact) {
        this.lastImpact = { impact, damage, obstacle, soft };
      }
    }
  }

  /* ===========================================================================
   *  5) STYLES DE L'INTERFACE (injectés une seule fois)
   * ========================================================================= */
  const CSS = `
  .cg-root{position:absolute;inset:0;z-index:1000;pointer-events:none;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;user-select:none;-webkit-user-select:none}
  .cg-root *{box-sizing:border-box}
  .cg-hide{display:none!important}
  .cg-speed{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);min-width:150px;text-align:center;background:rgba(10,12,18,.74);padding:8px 18px 10px;border-radius:14px;backdrop-filter:blur(4px)}
  .cg-touch-on .cg-speed{bottom:96px}
  .cg-speed b{display:block;font-size:44px;line-height:1;font-variant-numeric:tabular-nums}
  .cg-speed small{opacity:.7;font-size:12px;letter-spacing:.12em}
  .cg-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.18);overflow:hidden;margin-top:6px}
  .cg-bar>i{display:block;height:100%;width:0;background:#4cc9f0;transition:width .08s linear}
  .cg-chip{position:absolute;left:12px;top:12px;min-width:170px;max-width:55vw;background:rgba(10,12,18,.74);padding:8px 12px;border-radius:12px;font-size:13px}
  .cg-chip .cg-name{display:flex;align-items:center;gap:8px;font-weight:700}
  .cg-chip .cg-dot{width:12px;height:12px;border-radius:50%;flex:none;border:2px solid #fff}
  .cg-chip .cg-bar>i{background:#6ee7a0}
  .cg-minimap{position:absolute;right:12px;top:12px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.5);background:#222;isolation:isolate;transform:translateZ(0)}
  .cg-mm-arrow{width:20px;height:20px;margin:-10px 0 0 -10px;font-size:18px;line-height:20px;text-align:center;color:#e63946;text-shadow:0 0 3px #fff,0 0 3px #fff}
  .cg-drift{position:absolute;left:50%;top:18%;transform:translateX(-50%);font-size:28px;font-weight:900;font-style:italic;letter-spacing:.06em;text-shadow:0 2px 8px rgba(0,0,0,.7);color:#ffd60a;opacity:0;transition:opacity .2s}
  .cg-drift.on{opacity:1}
  .cg-toast{position:absolute;left:50%;top:38%;transform:translateX(-50%);padding:10px 20px;border-radius:12px;background:rgba(10,12,18,.82);font-weight:700;font-size:20px;opacity:0;transition:opacity .25s;text-align:center}
  .cg-toast.on{opacity:1}
  .cg-flash{position:absolute;inset:0;background:radial-gradient(transparent 40%,rgba(230,57,70,.55));opacity:0}
  .cg-flash.on{animation:cgflash .35s ease-out}
  @keyframes cgflash{0%{opacity:1}100%{opacity:0}}
  .cg-touch{position:absolute;inset:0;pointer-events:none}
  .cg-btn{position:absolute;width:64px;height:64px;border-radius:50%;border:2px solid rgba(255,255,255,.7);background:rgba(10,12,18,.55);color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;backdrop-filter:blur(3px)}
  .cg-btn.on{background:rgba(76,201,240,.65)}
  .cg-btn .ic{font-size:26px;line-height:1}
  .cg-select{position:absolute;inset:0;pointer-events:auto;overflow:auto;background:linear-gradient(160deg,rgba(8,10,20,.94),rgba(30,16,40,.94));padding:20px 14px 110px;text-align:center}
  .cg-select h1{margin:6px 0 4px;font-size:clamp(22px,5vw,34px);letter-spacing:.04em;text-transform:uppercase}
  .cg-select p.hint{margin:0 0 18px;opacity:.65;font-size:12px}
  .cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;max-width:980px;margin:0 auto}
  .cg-card{background:rgba(255,255,255,.07);border:2px solid transparent;border-radius:14px;padding:12px;text-align:left;cursor:pointer;transition:transform .12s,border-color .12s,background .12s}
  .cg-card:hover{transform:translateY(-2px);background:rgba(255,255,255,.11)}
  .cg-card.sel{border-color:var(--c);background:rgba(255,255,255,.14)}
  .cg-car-sw{height:34px;display:flex;align-items:center;margin-bottom:6px}
  .cg-car-sw i{display:block;width:62px;height:26px;border-radius:9px 14px 14px 9px;background:var(--c);position:relative;box-shadow:inset 0 -4px 0 rgba(0,0,0,.25)}
  .cg-car-sw i:after{content:"";position:absolute;left:22px;top:4px;width:20px;height:18px;border-radius:6px;background:rgba(20,30,50,.75)}
  .cg-card h3{margin:0 0 4px;font-size:15px}
  .cg-card p{margin:0 0 8px;font-size:12px;line-height:1.35;opacity:.8;min-height:48px}
  .cg-st{display:grid;grid-template-columns:86px 1fr;align-items:center;gap:6px;font-size:11px;margin:3px 0}
  .cg-st .cg-bar{margin:0}
  .cg-st .cg-bar>i{background:var(--c);transition:none}
  .cg-go{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);padding:14px 38px;font-size:18px;font-weight:800;border:0;border-radius:30px;background:#ffd60a;color:#111;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.5);pointer-events:auto}
  .cg-car-wrap{width:0;height:0;overflow:visible}
  .cg-car{position:absolute;left:0;top:0;transform:translate(-50%,-50%);will-change:transform}
  .cg-car .body{position:absolute;inset:0;border-radius:28% 28% 22% 22%/16% 16% 12% 12%;background:var(--c,#d62828);border:1px solid rgba(0,0,0,.6);box-shadow:0 0 0 1px rgba(255,255,255,.55),0 2px 6px rgba(0,0,0,.5)}
  .cg-car .win{position:absolute;left:12%;right:12%;top:22%;height:30%;border-radius:20%;background:rgba(15,25,45,.85)}
  .cg-car .win2{position:absolute;left:14%;right:14%;top:68%;height:14%;border-radius:20%;background:rgba(15,25,45,.7)}
  .cg-car .hl{position:absolute;top:2%;width:20%;height:5%;background:#fff6b0;border-radius:30%}
  `;

  function injectCSS() {
    if (typeof document === 'undefined' || document.getElementById('cg-style')) return;
    const s = document.createElement('style'); s.id = 'cg-style'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ===========================================================================
   *  6) JEU : carte, boucle, entrées, interface
   * ========================================================================= */
  const KEYMAP = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'handbrake', ShiftLeft: 'handbrake', ShiftRight: 'handbrake'
  };

  class Game {
    constructor(options) {
      if (typeof L === 'undefined') throw new Error('CarGame : Leaflet (window.L) doit être chargé avant le module.');
      injectCSS();
      options = options || {};
      const rest = Object.assign({}, options);
      delete rest.map; delete rest.container; delete rest.characters;   // ce ne sont pas des réglages
      this.cfg = deepMerge(CONFIG, rest);
      this.characters = options.characters || CHARACTERS;
      this.listeners = {};
      this.obstacles = [];
      this.kb = { up: false, down: false, left: false, right: false, handbrake: false };
      this.touch = { up: false, down: false, left: false, right: false, handbrake: false };
      this.pressed = new Set();
      this.state = 'select';                 // 'select' | 'playing'
      this.selectedIndex = 0;
      this.acc = 0; this.last = 0;
      this.cam = null;
      this.drift = { active: false, score: 0, time: 0, idle: 0, total: 0 };
      this.wreckTimer = 0;
      this._skid = [];
      this._lastSkid = [null, null];
      this._skidClock = 0;
      this._mmClock = 0;
      this._carPx = [0, 0];
      this._hudCache = {};

      this._buildMap(options);
      this._buildCar();
      this._buildUI();
      if (this.cfg.world.generateTestProps) this._generateProps();
      this._bindEvents();
      this.openSelect();
      this._raf = requestAnimationFrame(t => this._frame(t));
    }

    /* ---------- petit système d'évènements ---------- */
    on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); return this; }
    emit(name, data) { (this.listeners[name] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

    /* ---------- carte ---------- */
    _buildMap(options) {
      const M = this.cfg.view, S = this.cfg.start;
      if (options.map) {
        this.map = options.map; this._ownMap = false;
      } else {
        let cont = options.container;
        if (typeof cont === 'string') cont = document.getElementById(cont);
        if (!cont) {
          cont = h('div'); cont.id = 'cargame-map';
          cont.style.cssText = 'position:fixed;inset:0;background:#1b1b1b';
          document.body.appendChild(cont);
        }
        this._mapEl = cont; this._ownMap = true;
        this.map = L.map(cont, {
          center: [S.lat, S.lng], zoom: S.zoom, minZoom: M.minZoom, maxZoom: M.maxZoom,
          zoomControl: true, dragging: false, keyboard: false, doubleClickZoom: false,
          boxZoom: false, touchZoom: false, tap: false, zoomSnap: 1, zoomAnimation: false, fadeAnimation: false
        });
        L.tileLayer(M.tileUrl, { maxZoom: M.maxZoom, attribution: M.attribution }).addTo(this.map);
      }
      this.propLayer = L.layerGroup().addTo(this.map);
      this.skidLayer = L.layerGroup().addTo(this.map);
    }

    /* ---------- voiture + icône ---------- */
    _buildCar() {
      this.spec = deriveSpec(this.characters[0], this.cfg.physics);
      this.car = new Car(this.cfg, this.spec, this.cfg.start);
      this.carEl = h('div', 'cg-car',
        '<div class="body"></div><div class="win"></div><div class="win2"></div>' +
        '<div class="hl" style="left:10%"></div><div class="hl" style="right:10%"></div>');
      const wrap = h('div', 'cg-car-wrap'); wrap.appendChild(this.carEl);
      this.marker = L.marker([this.car.lat, this.car.lng], {
        icon: L.divIcon({ html: wrap, className: '', iconSize: [0, 0], iconAnchor: [0, 0] }),
        interactive: false, keyboard: false, zIndexOffset: 1000
      }).addTo(this.map);
      this._applyCarColor();
    }

    _applyCarColor() { this.carEl.style.setProperty('--c', this.spec.color); }

    /* ---------- interface ---------- */
    _buildUI() {
      const T = this.cfg.ui.lang, U = this.cfg.ui;
      const root = this.root = h('div', 'cg-root');
      this.map.getContainer().appendChild(root);

      this.elFlash = h('div', 'cg-flash'); root.appendChild(this.elFlash);

      // Fiche personnage + PV
      this.elChip = h('div', 'cg-chip',
        '<div class="cg-name"><span class="cg-dot"></span><span class="cg-nm"></span></div>' +
        '<div class="cg-bar"><i></i></div>');
      root.appendChild(this.elChip);

      // Compteur de vitesse
      this.elSpeed = h('div', 'cg-speed', '<b>0</b><small>KM/H</small><div class="cg-bar"><i></i></div>');
      root.appendChild(this.elSpeed);

      // Drift & messages
      this.elDrift = h('div', 'cg-drift'); root.appendChild(this.elDrift);
      this.elToast = h('div', 'cg-toast'); root.appendChild(this.elToast);

      // Mini-carte (une 2e petite carte Leaflet qui suit la voiture)
      if (U.minimap) {
        const sz = U.minimapSize;
        this.elMini = h('div', 'cg-minimap');
        this.elMini.style.width = this.elMini.style.height = sz + 'px';
        root.appendChild(this.elMini);
        this.mini = L.map(this.elMini, {
          center: [this.car.lat, this.car.lng], zoom: U.minimapZoom, zoomControl: false,
          attributionControl: false, dragging: false, keyboard: false, scrollWheelZoom: false,
          doubleClickZoom: false, boxZoom: false, touchZoom: false, tap: false,
          zoomAnimation: false, fadeAnimation: false
        });
        L.tileLayer(this.cfg.view.tileUrl, { maxZoom: this.cfg.view.maxZoom }).addTo(this.mini);
        this.miniArrowEl = h('div', 'cg-mm-arrow', '▲');
        this.miniMarker = L.marker([this.car.lat, this.car.lng], {
          icon: L.divIcon({ html: this.miniArrowEl, className: '', iconSize: [0, 0] }), interactive: false
        }).addTo(this.mini);
        setTimeout(() => this.mini.invalidateSize(), 50);
      }

      // Boutons tactiles
      const isTouch = U.touchControls === true ||
        (U.touchControls === 'auto' && typeof window !== 'undefined' &&
          ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0));
      this.elTouch = h('div', 'cg-touch' + (isTouch ? '' : ' cg-hide'));
      const mk = (act, label, icon, css) => {
        const b = h('div', 'cg-btn', icon ? '<span class="ic">' + icon + '</span>' : label);
        b.style.cssText = css; b.dataset.act = act; this.elTouch.appendChild(b);
        const set = v => { this.touch[act] = v; b.classList.toggle('on', v); };
        b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); set(true); });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => b.addEventListener(ev, () => set(false)));
        b.addEventListener('contextmenu', e => e.preventDefault());
      };
      mk('left',  '', '◀', 'left:14px;bottom:14px');
      mk('right', '', '▶', 'left:84px;bottom:14px');
      mk('up',    '', '▲', 'right:14px;bottom:84px');
      mk('down',  '', '▼', 'right:14px;bottom:14px');
      mk('handbrake', T.handbrake, '', 'right:84px;bottom:14px');
      root.appendChild(this.elTouch);
      if (isTouch) root.classList.add('cg-touch-on');

      // Écran de sélection
      this.elSelect = h('div', 'cg-select cg-hide');
      this.elSelect.appendChild(h('h1', null, T.title));
      this.elSelect.appendChild(h('p', 'hint', T.hint));
      const grid = h('div', 'cg-grid'); this.elSelect.appendChild(grid);
      this.cards = this.characters.map((ch, i) => {
        const c = h('div', 'cg-card');
        c.style.setProperty('--c', ch.color);
        c.innerHTML =
          '<div class="cg-car-sw"><i></i></div><h3></h3><p></p>' +
          ['topSpeed', 'acceleration', 'handling', 'resistance'].map(k =>
            '<div class="cg-st"><span>' + T[k] + '</span><div class="cg-bar"><i style="width:' + ch.stats[k] * 10 + '%"></i></div></div>'
          ).join('');
        c.querySelector('h3').textContent = ch.name;
        c.querySelector('p').textContent = ch.description;
        c.addEventListener('click', () => this._select(i));
        grid.appendChild(c); return c;
      });
      this.elGo = h('button', 'cg-go cg-hide', T.play);
      this.elGo.addEventListener('click', () => this.start(this.characters[this.selectedIndex].id));
      L.DomEvent.disableScrollPropagation(this.elSelect);
      L.DomEvent.disableClickPropagation(this.elSelect);
      root.appendChild(this.elSelect); root.appendChild(this.elGo);
    }

    _select(i) {
      this.selectedIndex = clamp(i, 0, this.characters.length - 1);
      this.cards.forEach((c, k) => c.classList.toggle('sel', k === this.selectedIndex));
      this._setCharacter(this.characters[this.selectedIndex]);
      this.emit('select', this.characters[this.selectedIndex]);
    }

    _setCharacter(ch) {
      this.character = ch;
      this.spec = deriveSpec(ch, this.cfg.physics);
      this.car.setSpec(this.spec);
      this._applyCarColor();
      this.elChip.querySelector('.cg-nm').textContent = ch.name;
      this.elChip.querySelector('.cg-dot').style.background = ch.color;
    }

    /* ---------- obstacles ---------- */
    /** Ajoute un obstacle : {lat, lng, radius, soft?, kind?, color?} */
    addObstacle(o) {
      const kind = this.cfg.world.kinds[o.kind] || {};
      const ob = {
        lat: o.lat, lng: o.lng,
        radius: o.radius != null ? o.radius : (kind.radius || 2),
        soft: o.soft != null ? o.soft : !!kind.soft,
        color: o.color || kind.color || '#8d99ae'
      };
      ob.layer = L.circle([ob.lat, ob.lng], {
        radius: ob.radius, color: '#111', weight: 1, fillColor: ob.color, fillOpacity: 0.9, interactive: false
      }).addTo(this.propLayer);
      this.obstacles.push(ob);
      return ob;
    }

    clearObstacles() { this.obstacles.length = 0; this.propLayer.clearLayers(); }

    _generateProps() {
      const W = this.cfg.world, S = this.cfg.start, rnd = mulberry32(W.seed);
      const kinds = Object.keys(W.kinds), weights = [0.4, 0.25, 0.2, 0.15];
      for (let i = 0; i < W.propCount; i++) {
        const ang = rnd() * Math.PI * 2;
        const dist = W.minDistM + rnd() * (W.maxDistM - W.minDistM);
        let r = rnd(), k = 0; while (k < kinds.length - 1 && r > weights[k]) { r -= weights[k]; k++; }
        this.addObstacle({
          kind: kinds[k],
          lat: S.lat + (Math.cos(ang) * dist) / M_PER_DEG_LAT,
          lng: S.lng + (Math.sin(ang) * dist) / mPerDegLng(S.lat)
        });
      }
    }

    /* ---------- entrées ---------- */
    _bindEvents() {
      this._onKeyDown = e => {
        if (this.state === 'select') {
          if (e.code === 'ArrowRight') { this._select(this.selectedIndex + 1); e.preventDefault(); }
          else if (e.code === 'ArrowLeft') { this._select(this.selectedIndex - 1); e.preventDefault(); }
          else if (e.code === 'Enter' || e.code === 'Space') { this.start(this.characters[this.selectedIndex].id); e.preventDefault(); }
          return;
        }
        if (e.code === 'Escape') { this.openSelect(); return; }
        if (e.code === 'KeyR') { this.respawn(); return; }
        if (KEYMAP[e.code]) { this.pressed.add(e.code); this._syncKeys(); e.preventDefault(); }
      };
      this._onKeyUp = e => {
        if (KEYMAP[e.code]) { this.pressed.delete(e.code); this._syncKeys(); e.preventDefault(); }
      };
      this._onBlur = () => { this.pressed.clear(); this._syncKeys(); };
      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      window.addEventListener('blur', this._onBlur);
    }

    _syncKeys() {
      const k = { up: false, down: false, left: false, right: false, handbrake: false };
      this.pressed.forEach(code => { k[KEYMAP[code]] = true; });
      this.kb = k;
    }

    _input() {
      const a = this.kb, b = this.touch;
      return {
        up: a.up || b.up, down: a.down || b.down, left: a.left || b.left,
        right: a.right || b.right, handbrake: a.handbrake || b.handbrake
      };
    }

    /* ---------- API publique : états ---------- */
    openSelect() {
      this.state = 'select';
      this.pressed.clear(); this._syncKeys();
      Object.keys(this.touch).forEach(k => { this.touch[k] = false; });
      this.elSelect.classList.remove('cg-hide'); this.elGo.classList.remove('cg-hide');
      this._select(this.selectedIndex);
    }

    /** Démarre la partie avec le personnage `id` (ou celui sélectionné). */
    start(id) {
      if (id) {
        const i = this.characters.findIndex(c => c.id === id);
        if (i >= 0) this._select(i);
      }
      this.elSelect.classList.add('cg-hide'); this.elGo.classList.add('cg-hide');
      this.state = 'playing';
      this.respawn(true);
      this.map.setZoom(this.cfg.start.zoom, { animate: false });
      this.emit('start', this.character);
    }

    respawn(silent) {
      this.car.start = this.cfg.game.respawnAtStart ? this.cfg.start : { lat: this.car.lat, lng: this.car.lng, headingDeg: this.car.heading / DEG };
      this.car.reset();
      this.wreckTimer = 0;
      this.cam = null;
      this._lastSkid = [null, null];
      this.drift = { active: false, score: 0, time: 0, idle: 0, total: this.drift.total || 0 };
      if (!silent) { this._toast(this.cfg.ui.lang.respawned, 900); this.emit('respawn', null); }
    }

    getState() {
      const c = this.car;
      return {
        lat: c.lat, lng: c.lng, headingDeg: c.heading / DEG, kmh: c.kmh, hp: c.hp, maxHp: this.spec.maxHp,
        sliding: c.sliding, driftAngleDeg: c.driftAngleDeg, driftTotal: this.drift.total, character: this.character
      };
    }

    destroy() {
      cancelAnimationFrame(this._raf);
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      window.removeEventListener('blur', this._onBlur);
      if (this.mini) this.mini.remove();
      this.root.remove();
      this.map.removeLayer(this.marker); this.map.removeLayer(this.propLayer); this.map.removeLayer(this.skidLayer);
      if (this._ownMap) { this.map.remove(); if (this._mapEl && this._mapEl.id === 'cargame-map') this._mapEl.remove(); }
    }

    /* ---------- boucle principale ---------- */
    _frame(t) {
      this._raf = requestAnimationFrame(tt => this._frame(tt));
      const dt = this.last ? Math.min(0.1, (t - this.last) / 1000) : 0;
      this.last = t;
      const P = this.cfg.physics;

      if (this.state === 'playing') {
        this.acc += dt;
        const inp = this._input();
        while (this.acc >= P.fixedStep) {
          this.car.step(P.fixedStep, inp, this.obstacles);
          this._afterStep(P.fixedStep);
          this.acc -= P.fixedStep;
        }
        this._updateDrift(dt);
        this._updateSkids(dt);
        this._updateWreck(dt);
      }
      this._render(dt);
      this.emit('tick', dt);
    }

    _afterStep() {
      const imp = this.car.lastImpact;
      if (!imp || imp.impact < 1.5) return;      // on ignore les simples frottements contre un obstacle
      if (imp.damage > 0 || imp.impact > 6) {
        this.elFlash.classList.remove('on'); void this.elFlash.offsetWidth;
        if (imp.damage > 0) this.elFlash.classList.add('on');
      }
      this.emit('collision', { impact: imp.impact, damage: imp.damage, soft: imp.soft, obstacle: imp.obstacle, hp: this.car.hp });
      if (this.car.hp <= 0 && !this.car.wrecked) {
        this.car.wrecked = true; this.wreckTimer = this.cfg.game.respawnDelaySec;
        this._toast(this.cfg.ui.lang.wrecked, this.cfg.game.respawnDelaySec * 1000);
        this.emit('wreck', null);
      }
    }

    _updateWreck(dt) {
      if (!this.car.wrecked) return;
      this.car.vx *= Math.exp(-2 * dt); this.car.vy *= Math.exp(-2 * dt);
      this.wreckTimer -= dt;
      if (this.wreckTimer <= 0) this.respawn();
    }

    _updateDrift(dt) {
      const D = this.cfg.game.drift, c = this.car, d = this.drift;
      const on = c.sliding && c.kmh > D.minSpeedKmh && c.driftAngleDeg > D.minAngleDeg && !c.wrecked;
      if (on) {
        d.active = true; d.idle = 0; d.time += dt;
        d.score += dt * c.kmh * c.driftAngleDeg * D.scoreRate;
        if (d.time - dt <= 0) this.emit('drift', { state: 'start' });
      } else if (d.active) {
        d.idle += dt;
        if (d.idle > D.holdSec) {
          d.total += Math.round(d.score);
          this.emit('drift', { state: 'end', score: Math.round(d.score), total: d.total });
          d.active = false; d.score = 0; d.time = 0; d.idle = 0;
        }
      }
    }

    _updateSkids(dt) {
      const c = this.car, limit = this.cfg.world.skidMarksMax;
      if (!(c.sliding && c.kmh > 8) || c.wrecked) { this._lastSkid = [null, null]; return; }
      this._skidClock += dt;
      if (this._skidClock < 0.05) return;
      this._skidClock = 0;
      [-0.8, 0.8].forEach((lat, i) => {
        const p = c.offsetLatLng(-1.3, lat), prev = this._lastSkid[i];
        if (prev) {
          const pl = L.polyline([[prev.lat, prev.lng], [p.lat, p.lng]], { color: '#000', weight: 3, opacity: 0.35, interactive: false }).addTo(this.skidLayer);
          this._skid.push(pl);
        }
        this._lastSkid[i] = p;
      });
      while (this._skid.length > limit) this.skidLayer.removeLayer(this._skid.shift());
    }

    /* ---------- rendu ---------- */
    _render(dt) {
      const c = this.car, M = this.cfg.view;

      // Icône de la voiture : taille réelle en mètres -> pixels selon le zoom
      this.marker.setLatLng([c.lat, c.lng]);
      const zoom = this.map.getZoom();
      const mpp = 156543.03392 * Math.cos(c.lat * DEG) / Math.pow(2, zoom);
      const w = Math.max(this.cfg.car.minIconPx * 0.5, Math.round(this.cfg.car.widthM / mpp));
      const hgt = Math.max(this.cfg.car.minIconPx, Math.round(this.cfg.car.lengthM / mpp));
      if (this._carPx[0] !== w || this._carPx[1] !== hgt) {
        this.carEl.style.width = w + 'px'; this.carEl.style.height = hgt + 'px'; this._carPx = [w, hgt];
      }
      this.carEl.style.transform = 'translate(-50%,-50%) rotate(' + (c.heading / DEG).toFixed(2) + 'deg)';

      // Caméra : suit la voiture avec un peu d'avance et de lissage
      const tLat = c.lat + (c.vy * M.cameraLookAheadSec) / M_PER_DEG_LAT;
      const tLng = c.lng + (c.vx * M.cameraLookAheadSec) / mPerDegLng(c.lat);
      if (!this.cam) this.cam = { lat: tLat, lng: tLng };
      else {
        const k = 1 - Math.exp(-M.cameraSmoothing * dt);
        this.cam.lat += (tLat - this.cam.lat) * k; this.cam.lng += (tLng - this.cam.lng) * k;
      }
      this.map.setView([this.cam.lat, this.cam.lng], zoom, { animate: false });

      this._renderHUD(dt);

      // Mini-carte (mise à jour ~10 fois/s)
      if (this.mini) {
        this._mmClock += dt;
        this.miniArrowEl.style.transform = 'rotate(' + (c.heading / DEG).toFixed(0) + 'deg)';
        if (this._mmClock > 0.1) {
          this._mmClock = 0;
          this.miniMarker.setLatLng([c.lat, c.lng]);
          this.mini.setView([c.lat, c.lng], this.cfg.ui.minimapZoom, { animate: false });
        }
      }
    }

    _renderHUD() {
      const c = this.car, H = this._hudCache, T = this.cfg.ui.lang;
      const kmh = Math.round(c.kmh);
      if (H.kmh !== kmh) {
        H.kmh = kmh; this.elSpeed.querySelector('b').textContent = kmh;
        const pct = clamp(c.kmh / (this.spec.vMax * 3.6), 0, 1) * 100;
        const bar = this.elSpeed.querySelector('.cg-bar>i');
        bar.style.width = pct.toFixed(0) + '%';
        bar.style.background = pct > 85 ? '#ff5d5d' : pct > 60 ? '#ffd60a' : '#4cc9f0';
      }
      const hp = Math.round((c.hp / this.spec.maxHp) * 100);
      if (H.hp !== hp) {
        H.hp = hp;
        const bar = this.elChip.querySelector('.cg-bar>i');
        bar.style.width = hp + '%';
        bar.style.background = hp > 55 ? '#6ee7a0' : hp > 25 ? '#ffd60a' : '#ff5d5d';
      }
      const d = this.drift, show = d.active && d.score > 5;
      const txt = show ? T.drift + '  ' + Math.round(d.score) : '';
      if (H.drift !== txt) { H.drift = txt; this.elDrift.textContent = txt; this.elDrift.classList.toggle('on', show); }
    }

    _toast(text, ms) {
      this.elToast.textContent = text; this.elToast.classList.add('on');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.elToast.classList.remove('on'), ms || 1200);
    }
  }

  /* ===========================================================================
   *  7) API PUBLIQUE + DÉMARRAGE AUTOMATIQUE (test autonome)
   * ========================================================================= */
  const api = {
    create: options => new Game(options),
    Car, deriveSpec, CONFIG, CHARACTERS,
    defaults: CONFIG
  };

  // Démarrage auto si Leaflet est chargé (mets window.CARGAME_NO_AUTOBOOT = true pour l'empêcher)
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.CARGAME_NO_AUTOBOOT) {
    const boot = () => {
      if (window.L) window.cargame = api.create(window.CARGAME_OPTIONS || {});
      else console.error('CarGame : charge Leaflet avant cargame.js');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  return api;
}));
