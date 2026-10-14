/* Les Lauriers — interactions : drone au défilement, révélations, défilement horizontal, visionneuse.
   Aucune dépendance : tout est en JavaScript natif. */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSmall = () => matchMedia('(max-width: 820px)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const html = document.documentElement;
  const nf = (n, d = 0) => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pad = n => String(n).padStart(2, '0');

  /* ============================================================
     1. DRONE — la séquence d'images avance avec le défilement
     ============================================================ */
  const hero = $('#accueil');
  const stage = $('#droneStage');
  const canvas = $('#droneCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const N = 91;                                   // nombre d'images (d-001..d-091.webp)
  // Téléphone en portrait : images recadrées sur le canyon et la rivière (sans la roche).
  // Autrement (ordinateur, tablette large, téléphone couché) : images larges.
  const portraitPhone = () => matchMedia('(max-width: 820px) and (orientation: portrait)').matches;
  const wantedDir = () => (portraitPhone() ? 'm-' : 'd-');
  let dir = wantedDir();
  let gen = 0;
  const frames = new Array(N).fill(null);
  const have = new Uint8Array(N);
  const FIRST_PASS = 10;                          // images chargées avant d'ouvrir le site (1 sur 10)

  const loaderEl = $('#loader');
  const loaderFill = $('#loaderFill');
  const loaderPct = $('#loaderPct');
  let firstDone = false, revealed = false, minTime = false;

  function setLoad(k) {
    loaderFill.style.transform = 'scaleX(' + clamp(k) + ')';
    loaderPct.textContent = Math.round(clamp(k) * 100);
  }
  function reveal() {
    if (revealed) return;
    revealed = true;
    setLoad(1);
    hero.classList.add('is-ready');
    loaderEl.classList.add('is-done');
    html.classList.remove('is-loading');
    setTimeout(() => { loaderEl.style.display = 'none'; }, 1500);
    $$('.lieu img').forEach(i => { i.loading = 'eager'; });
    measureLieu();
  }
  function maybeReveal() { if (firstDone && minTime) reveal(); }

  function loadFrame(i, g) {
    return new Promise(resolve => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => {
        if (g !== gen) return resolve(i);
        frames[i] = im; have[i] = 1;
        (im.decode ? im.decode() : Promise.resolve()).catch(() => {}).then(() => resolve(i));
      };
      im.onerror = () => resolve(i);
      im.src = dir + String(i + 1).padStart(3, '0') + '.webp';
    });
  }
  function loadOrder() {
    const out = [], seen = new Set();
    const add = i => { if (!seen.has(i)) { seen.add(i); out.push(i); } };
    for (let i = 0; i < N; i += 10) add(i);
    add(N - 1);
    for (let i = 0; i < N; i += 5) add(i);
    for (let i = 0; i < N; i += 2) add(i);
    for (let i = 0; i < N; i++) add(i);
    return out;
  }
  async function loadAll() {
    const q = loadOrder(), g = gen;
    let k = 0, done = 0;
    const worker = async () => {
      while (k < q.length && g === gen) {
        const i = q[k++];
        await loadFrame(i, g);
        done++;
        if (done <= FIRST_PASS + 1) setLoad(done / (FIRST_PASS + 1));
        if (done === FIRST_PASS + 1) { firstDone = true; maybeReveal(); }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (!firstDone && g === gen) { firstDone = true; maybeReveal(); }
  }
  function swapSet() {                             // rotation du téléphone, fenêtre redimensionnée
    const d = wantedDir();
    if (d === dir) return;
    dir = d; gen++; frames.fill(null); have.fill(0); lastRenderKey = '';
    loadAll();
  }
  setTimeout(() => { minTime = true; maybeReveal(); }, reduce ? 200 : 1500);
  setTimeout(reveal, 9000);                       // filet de sécurité si le réseau est très lent

  let cw = 0, ch = 0;
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.round(stage.clientWidth * dpr), h = Math.round(stage.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    cw = canvas.width; ch = canvas.height;
  }
  function cover(img, fx, fy, zoom) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const s = Math.max(cw / iw, ch / ih) * zoom;
    const dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (cw - dw) * fx, (ch - dh) * fy, dw, dh);
  }
  function nearest(i) {
    if (have[i]) return i;
    for (let d = 1; d < N; d++) {
      if (i - d >= 0 && have[i - d]) return i - d;
      if (i + d < N && have[i + d]) return i + d;
    }
    return -1;
  }
  let lastRenderKey = '';
  function render(p) {
    if (!Number.isFinite(p)) return;
    const f = p * (N - 1);
    const i0 = Math.floor(f), t = f - i0, i1 = Math.min(N - 1, i0 + 1);
    const a = nearest(i0), b = nearest(i1);
    if (a < 0) return;
    const key = a + '|' + b + '|' + t.toFixed(3) + '|' + cw + 'x' + ch + '|' + p.toFixed(3);
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    const baked = dir === 'm-';            // images déjà recadrées pour le portrait
    const zoom = 1 + p * (baked ? .03 : .05);
    let fx = .5;
    if (!baked && cw / ch < 1) {
      // image large sur écran portrait : même cadrage que sur téléphone, centré sur la rivière, loin de la roche
      const v = Math.min(1, (cw / ch) / (frames[a].naturalWidth / frames[a].naturalHeight) / zoom);
      fx = clamp((.295 + .14 * Math.pow(p, 1.5) - v / 2) / Math.max(.01, 1 - v));
    }
    ctx.globalAlpha = 1;
    cover(frames[a], fx, .5, zoom);
    if (b !== a && t > .02) { ctx.globalAlpha = t; cover(frames[b], fx, .5, zoom); ctx.globalAlpha = 1; }
    hero.classList.add('is-drawn');                         // le canvas n'apparaît qu'une fois la première image dessinée
  }

  /* HUD de vol (décoratif) : altitude, distance, coordonnées */
  const hud = { alt: $('#hudAlt'), dist: $('#hudDist'), gps: $('#hudGps'), fill: $('#hudFill'), pct: $('#hudPct') };
  const dms = (v, plus, minus) => Math.floor(Math.abs(v)) + '°' + pad(Math.floor((Math.abs(v) % 1) * 60)) + '′' + (v >= 0 ? plus : minus);
  function updateHud(p) {
    const e = ease(p);
    hud.alt.textContent = nf(Math.round(lerp(980, 634, e) / 2) * 2) + ' m';
    hud.dist.textContent = nf(lerp(18.4, 0, e), 1) + ' km';
    hud.gps.textContent = dms(lerp(43.7508, 43.8419, p), 'N', 'S') + ' · ' + dms(lerp(6.3367, 6.2181, p), 'E', 'O');
    hud.fill.style.transform = 'scaleY(' + p.toFixed(4) + ')';
    hud.pct.textContent = String(Math.round(p * 100)).padStart(3, '0');
  }

  /* textes qui apparaissent et disparaissent le long du vol */
  const beats = $$('.beat').map(el => ({ el, a: parseFloat(el.dataset.in), b: parseFloat(el.dataset.out) }));
  const cue = $('#droneCue');
  function updateBeats(p) {
    for (const bt of beats) {
      const fin = bt.a <= 0 ? 1 : clamp((p - bt.a) / .06);
      const fout = clamp((p - bt.b) / .06);
      const o = ease(fin) * (1 - ease(fout));
      const y = (1 - ease(fin)) * 40 - ease(fout) * 34;
      bt.el.style.setProperty('--o', o.toFixed(3));
      bt.el.style.setProperty('--y', y.toFixed(1) + 'px');
      bt.el.classList.toggle('is-on', o > .01);
      bt.el.classList.toggle('is-live', o > .6);
    }
    cue.style.opacity = String(1 - clamp(p / .05));
  }

  /* ============================================================
     2. EN-TÊTE, MENU, BARRE MOBILE
     ============================================================ */
  const head = $('#head');
  const burger = $('#burger');
  const menu = $('#menu');
  const stickybar = $('#stickybar');
  const bookSection = $('#reserver');
  let lastY = window.scrollY;

  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    menu.setAttribute('aria-hidden', String(!open));
  }
  burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  $$('#menu a').forEach(a => a.addEventListener('click', () => setMenu(false)));
  addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

  function updateHeader(heroRect) {
    const y = window.scrollY;
    const past = heroRect.bottom <= innerHeight + 24;
    head.classList.toggle('is-solid', past);
    if (past && y > lastY + 6 && !document.body.classList.contains('menu-open')) head.classList.add('is-hidden');
    else if (y < lastY - 6 || !past) head.classList.remove('is-hidden');
    lastY = y;
    const bk = bookSection.getBoundingClientRect();
    const inBook = bk.top < innerHeight * .85 && bk.bottom > 0;
    stickybar.classList.toggle('is-on', past && !inBook);
  }

  /* ============================================================
     3. RÉVÉLATIONS (titres mot à mot, blocs, compteurs)
     ============================================================ */
  function splitWords(root) {
    let i = 0;
    const walk = node => {
      Array.from(node.childNodes).forEach(c => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w';
            const s = document.createElement('span'); s.textContent = part; s.style.setProperty('--i', i++);
            w.appendChild(s); frag.appendChild(w);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1 && c.tagName !== 'BR') walk(c);
      });
    };
    walk(root);
  }
  $$('[data-split]').forEach(splitWords);

  const countEls = $$('[data-count]');
  countEls.forEach(el => { el.textContent = nf(0, +el.dataset.dec || 0); });
  function countUp(el) {
    const to = parseFloat(el.dataset.count), dec = +el.dataset.dec || 0;
    if (reduce) { el.textContent = nf(to, dec); return; }
    const t0 = performance.now(), dur = 1700;
    (function step(t) {
      const k = clamp((t - t0) / dur);
      el.textContent = nf(to * (1 - Math.pow(1 - k, 4)), dec);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      $$('[data-count]', e.target).forEach(countUp);
      io.unobserve(e.target);
    });
  }, { threshold: .18, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal],[data-split]').forEach(el => io.observe(el));

  /* manifeste : les mots s'allument au fil du défilement */
  const man = $('#manifesto');
  const manWords = [];
  (function splitManifesto() {
    const walk = node => {
      Array.from(node.childNodes).forEach(c => {
        if (c.nodeType === 3) {
          const frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const s = document.createElement('span'); s.className = 'mw'; s.textContent = part;
            manWords.push(s); frag.appendChild(s);
          });
          c.replaceWith(frag);
        } else if (c.nodeType === 1) walk(c);
      });
    };
    walk(man);
  })();
  let manLit = 0;
  function updateManifesto() {
    const r = man.getBoundingClientRect();
    const p = clamp((innerHeight * .86 - r.top) / (r.height + innerHeight * .1));
    const n = Math.min(manWords.length, reduce ? manWords.length : Math.round(p * manWords.length * 1.12));
    if (n === manLit) return;
    if (n > manLit) for (let i = manLit; i < n && i < manWords.length; i++) manWords[i].classList.add('on');
    else for (let i = n; i < manLit; i++) manWords[i].classList.remove('on');
    manLit = n;
  }

  /* ============================================================
     4. LE LIEU — défilement horizontal piloté par le défilement vertical
     ============================================================ */
  const lieu = $('#lieu');
  const track = $('#lieuTrack');
  const lieuFill = $('#lieuFill');
  let lieuMax = 0, lp = 0, lieuOn = false;
  function measureLieu() {
    lieuOn = !isSmall();
    if (!lieuOn) { lieu.style.height = ''; track.style.transform = ''; return; }
    lieuMax = Math.max(0, track.scrollWidth - window.innerWidth);
    lieu.style.height = Math.round(lieuMax + innerHeight * 1.1) + 'px';
  }
  function updateLieu() {
    if (!lieuOn) return;
    const r = lieu.getBoundingClientRect();
    const target = clamp(-r.top / Math.max(1, r.height - innerHeight));
    lp = reduce ? target : lp + (target - lp) * .12;
    if (Math.abs(target - lp) < .0004) lp = target;
    track.style.transform = 'translate3d(' + (-lp * lieuMax).toFixed(1) + 'px,0,0)';
    lieuFill.style.transform = 'scaleX(' + lp.toFixed(4) + ')';
  }

  /* parallaxe des photos de la chambre */
  const pxImgs = $$('[data-parallax]');
  function updateParallax() {
    if (reduce) return;
    for (const im of pxImgs) {
      const r = im.parentElement.getBoundingClientRect();
      if (r.bottom < -50 || r.top > innerHeight + 50) continue;
      const k = (r.top + r.height / 2 - innerHeight / 2) / (innerHeight / 2 + r.height / 2);
      im.style.transform = 'translate3d(0,' + (clamp(k, -1, 1) * -6).toFixed(2) + '%,0)';
    }
  }

  /* ============================================================
     5. BOUCLE PRINCIPALE
     ============================================================ */
  let sp = clamp(-hero.getBoundingClientRect().top / Math.max(1, hero.offsetHeight - innerHeight));
  function frame() {
    requestAnimationFrame(frame);                  // d'abord : une erreur ne doit jamais arrêter la boucle
    const hr = hero.getBoundingClientRect();
    const target = clamp(-hr.top / Math.max(1, hr.height - innerHeight));
    if (sp !== target) {
      sp = reduce ? target : sp + (target - sp) * .1;
      if (Math.abs(target - sp) < .0003) sp = target;
    }
    const heroVisible = hr.bottom > -50 && hr.top < innerHeight + 50;
    if (heroVisible) {
      if (firstDone) render(sp);
      updateHud(sp);
      updateBeats(sp);
    }
    updateHeader(hr);
    updateManifesto();
    updateLieu();
    updateParallax();
  }

  function onResize() { resizeCanvas(); swapSet(); lastRenderKey = ''; measureLieu(); }
  addEventListener('resize', onResize);
  addEventListener('load', () => { onResize(); setTimeout(measureLieu, 400); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureLieu);
  resizeCanvas();
  measureLieu();
  updateBeats(sp);
  updateHud(sp);
  requestAnimationFrame(frame);
  loadAll();

  /* ============================================================
     6. VISIONNEUSE PHOTO
     ============================================================ */
  const lb = $('#lb'), lbImg = $('#lbImg'), lbCap = $('#lbCap');
  const lbItems = $$('[data-lightbox]');
  let lbIdx = 0, lbFocus = null;
  function openLb(i) {
    lbIdx = (i + lbItems.length) % lbItems.length;
    const el = lbItems[lbIdx];
    lbImg.src = el.dataset.lightbox;
    lbImg.alt = el.alt || '';
    lbCap.textContent = el.dataset.cap || '';
    if (lb.hidden) { lbFocus = document.activeElement; lb.hidden = false; document.body.classList.add('lb-open'); $('#lbClose').focus(); }
  }
  function closeLb() { lb.hidden = true; document.body.classList.remove('lb-open'); lbImg.removeAttribute('src'); if (lbFocus) lbFocus.focus(); }
  lbItems.forEach((el, i) => {
    el.addEventListener('click', () => openLb(i));
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLb(i); } });
  });
  $('#lbClose').addEventListener('click', closeLb);
  $('#lbPrev').addEventListener('click', () => openLb(lbIdx - 1));
  $('#lbNext').addEventListener('click', () => openLb(lbIdx + 1));
  lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
  addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'ArrowLeft') openLb(lbIdx - 1);
    if (e.key === 'ArrowRight') openLb(lbIdx + 1);
  });
  let tx = 0;
  lb.addEventListener('touchstart', e => { tx = e.changedTouches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - tx;
    if (Math.abs(dx) > 50) openLb(lbIdx + (dx < 0 ? 1 : -1));
  }, { passive: true });

  /* ============================================================
     7. DÉTAILS : curseur, boutons magnétiques, carte, FAQ, barre de dates
     ============================================================ */
  if (finePointer && !reduce) {
    const cur = $('#cursor');
    let x = 0, y = 0, cx = 0, cy = 0;
    addEventListener('pointermove', e => { x = e.clientX; y = e.clientY; cur.classList.add('is-on'); }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => cur.classList.remove('is-on'));
    (function loop() { cx += (x - cx) * .24; cy += (y - cy) * .24; cur.style.transform = 'translate3d(' + cx + 'px,' + cy + 'px,0)'; requestAnimationFrame(loop); })();
    document.addEventListener('pointerover', e => {
      const view = !!e.target.closest('[data-lightbox]');
      const link = !view && !!e.target.closest('a,button:not(.day),summary');
      cur.classList.toggle('is-view', view);
      cur.classList.toggle('is-link', link);
    });
    $$('.btn--magnetic').forEach(b => {
      b.addEventListener('pointermove', e => {
        const r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * .2).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * .28).toFixed(1) + 'px)';
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }

  $('#mapBtn').addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.title = 'Carte OpenStreetMap : Les Lauriers, Moustiers-Sainte-Marie';
    f.loading = 'lazy';
    f.src = 'https://www.openstreetmap.org/export/embed.html?bbox=6.2090%2C43.8385%2C6.2275%2C43.8455&layer=mapnik&marker=43.841886%2C6.21811';
    $('#map').appendChild(f);
    $('#mapBtn').remove();
  });

  const faq = $$('.faq__list details');
  faq.forEach(d => d.addEventListener('toggle', () => { if (d.open) faq.forEach(o => { if (o !== d) o.open = false; }); }));

  $('#year').textContent = new Date().getFullYear();

  /* barre « Arrivée / Départ / Voyageurs » du héros */
  const qb = $('#quickbar'), qbIn = $('#qbIn'), qbOut = $('#qbOut'), qbG = $('#qbGuests');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = new Date();
  qbIn.min = iso(today); qbOut.min = iso(today);
  qbIn.addEventListener('change', () => {
    if (!qbIn.value) return;
    const d = new Date(qbIn.value + 'T12:00:00'); d.setDate(d.getDate() + 1);
    qbOut.min = iso(d);
    if (!qbOut.value || qbOut.value < qbOut.min) qbOut.value = qbOut.min;
  });
  qb.addEventListener('submit', e => {
    e.preventDefault();
    if (window.LauriersBooking) window.LauriersBooking.prefill({ arrival: qbIn.value, departure: qbOut.value, guests: +qbG.value });
    $('#reserver').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  });
})();
