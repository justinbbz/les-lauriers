/* Les Lauriers — réservation : calendrier de disponibilités, estimation du prix, envoi vers l'agenda.
   Réglages dans assets/js/config.js. Contrat du webhook Make : voir RESERVATION-AGENDA.md. */
(() => {
  'use strict';

  const CFG = window.LAURIERS || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const pad = n => String(n).padStart(2, '0');
  const DAY = 864e5;

  /* ---------- dates : on manipule des chaînes AAAA-MM-JJ, calculées à midi pour éviter les décalages d'heure d'été ---------- */
  const keyOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (k, n) => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d); };
  const addMonths = (k, n) => { const d = parse(k); d.setDate(1); d.setMonth(d.getMonth() + n); return keyOf(d); };
  const diff = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
  const todayKey = keyOf(new Date());
  const monthStart = k => k.slice(0, 8) + '01';
  const fmtLong = k => parse(k).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = k => parse(k).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
  const eur = n => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

  const MIN = CFG.MIN_NIGHTS || 1, MAX = CFG.MAX_NIGHTS || 14;
  const MAX_GUESTS = CFG.MAX_GUESTS || 3, BASE_GUESTS = CFG.BASE_GUESTS || 2;
  const EXTRA = CFG.EXTRA_GUEST_PER_NIGHT || 0;
  const LAST_MONTH = addMonths(monthStart(todayKey), CFG.MONTHS_AHEAD || 12);

  /* ---------- état ---------- */
  const S = { start: null, end: null, hover: null, guests: 2, month: monthStart(todayKey), busy: new Set(), sending: false, lastRef: '', lastPayload: null };

  const calEl = $('#cal'), statusEl = $('#calStatus');
  const vIn = $('#vIn'), vOut = $('#vOut'), vNights = $('#vNights'), fIn = $('#fIn'), fOut = $('#fOut');
  const form = $('#bookForm'), submit = $('#submitBtn'), recap = $('#recap');
  const gVal = $('#gVal'), gMinus = $('#gMinus'), gPlus = $('#gPlus'), gHint = $('#guestsHint');
  const grid = $('.book__grid'), done = $('#done');
  if (!calEl || !form) return;

  /* ---------- disponibilités ---------- */
  function demoBusy() {
    // Exemple de démonstration : nuits « déjà prises » relatives à aujourd'hui.
    const ranges = [[6, 9], [17, 20], [31, 35], [48, 50], [62, 66], [80, 83], [101, 104], [130, 134], [160, 163], [200, 205]];
    const set = new Set();
    ranges.forEach(([a, b]) => { for (let i = a; i < b; i++) set.add(addDays(todayKey, i)); });
    return set;
  }
  function pairsToSet(list) {
    const set = new Set();
    (list || []).forEach(item => {
      const s = Array.isArray(item) ? item[0] : item.start, e = Array.isArray(item) ? item[1] : item.end;
      if (!s || !e) return;
      for (let k = s.slice(0, 10); k < e.slice(0, 10) && set.size < 5000; k = addDays(k, 1)) set.add(k);
    });
    return set;
  }
  async function loadAvailability() {
    if (CFG.AVAILABILITY_URL) {
      statusEl.textContent = 'Chargement des disponibilités…';
      try {
        const u = CFG.AVAILABILITY_URL + (CFG.AVAILABILITY_URL.includes('?') ? '&' : '?') + 'from=' + todayKey + '&to=' + addDays(todayKey, 460);
        const r = await fetch(u, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        S.busy = pairsToSet(j.busy);
        statusEl.textContent = '';
      } catch (e) {
        S.busy = new Set();
        statusEl.textContent = 'Disponibilités momentanément indisponibles : l’hôte vérifiera vos dates.';
      }
    } else if (CFG.DEMO_MODE) {
      S.busy = demoBusy();
    }
    paint();
  }

  /* ---------- tarifs ---------- */
  function seasonFor(k) {
    const md = k.slice(5);
    for (const s of CFG.SEASONS || []) {
      const inside = s.from <= s.to ? (md >= s.from && md <= s.to) : (md >= s.from || md <= s.to);
      if (inside) return s;
    }
    return (CFG.SEASONS || [{ rate: 75, label: '' }])[0];
  }
  function quote() {
    if (!S.start || !S.end) return null;
    const nights = diff(S.start, S.end);
    const groups = new Map();
    let total = 0;
    for (let k = S.start; k < S.end; k = addDays(k, 1)) {
      const s = seasonFor(k);
      const g = groups.get(s.rate + s.label) || { rate: s.rate, label: s.label, n: 0 };
      g.n++; groups.set(s.rate + s.label, g); total += s.rate;
    }
    const extraGuests = Math.max(0, S.guests - BASE_GUESTS);
    const extraTotal = extraGuests * EXTRA * nights;
    return { nights, groups: [...groups.values()], extraGuests, extraTotal, total: total + extraTotal };
  }

  /* ---------- règles de sélection ---------- */
  const isPast = k => k < todayKey;
  const isBusy = k => S.busy.has(k);
  function firstBusyAfter(start) {
    for (let i = 1; i <= MAX + 1; i++) { const k = addDays(start, i); if (isBusy(k)) return k; }
    return null;
  }
  function validEnd(start, k) {
    if (k <= start) return false;
    const n = diff(start, k);
    if (n < MIN || n > MAX) return false;
    for (let x = start; x < k; x = addDays(x, 1)) if (isBusy(x)) return false;
    return true;
  }
  function pick(k) {
    statusEl.textContent = '';
    if (isPast(k)) return;
    if (!S.start || S.end) {
      if (isBusy(k)) return;
      S.start = k; S.end = null; S.hover = null;
    } else if (k <= S.start) {
      if (isBusy(k)) return;
      S.start = k;
    } else if (validEnd(S.start, k)) {
      S.end = k; S.hover = null;
    } else {
      const n = diff(S.start, k);
      if (n > MAX) statusEl.textContent = 'Séjour limité à ' + MAX + ' nuits par demande : appelez l’hôte pour plus longtemps.';
      else if (n < MIN) statusEl.textContent = 'Séjour minimum : ' + MIN + ' nuit' + (MIN > 1 ? 's' : '') + '.';
      else statusEl.textContent = 'Une partie de ces nuits est déjà prise : choisissez un autre départ.';
      if (!isBusy(k)) { S.start = k; S.end = null; }
    }
    paint(); summary();
  }

  /* ---------- calendrier ---------- */
  const monthsShown = () => (window.innerWidth > 820 ? 2 : 1);
  let builtFor = '';
  function build() {
    const count = monthsShown();
    builtFor = S.month + '|' + count;
    calEl.innerHTML = '';
    calEl.style.gridTemplateColumns = count === 1 ? '1fr' : '';
    for (let i = 0; i < count; i++) {
      const first = addMonths(S.month, i), d = parse(first);
      const m = document.createElement('div'); m.className = 'month';
      const title = document.createElement('div'); title.className = 'month__title';
      title.textContent = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
      m.appendChild(title);
      if (i === 0) m.appendChild(navBtn('prev', S.month <= monthStart(todayKey)));
      if (i === count - 1) m.appendChild(navBtn('next', addMonths(S.month, count - 1) >= LAST_MONTH));
      const dow = document.createElement('div'); dow.className = 'dow';
      ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].forEach(x => { const s = document.createElement('span'); s.textContent = x; dow.appendChild(s); });
      m.appendChild(dow);
      const days = document.createElement('div'); days.className = 'days'; days.setAttribute('role', 'grid');
      const lead = (d.getDay() + 6) % 7, dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      for (let b = 0; b < lead; b++) { const e = document.createElement('span'); e.className = 'day is-blank'; days.appendChild(e); }
      for (let n = 1; n <= dim; n++) {
        const k = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(n);
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'day'; btn.dataset.k = k; btn.tabIndex = -1;
        btn.innerHTML = '<span>' + n + '</span>';
        days.appendChild(btn);
      }
      m.appendChild(days);
      calEl.appendChild(m);
    }
    paint();
  }
  function navBtn(dir, disabled) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'month__nav month__nav--' + dir; b.disabled = disabled;
    b.setAttribute('aria-label', dir === 'prev' ? 'Mois précédent' : 'Mois suivant');
    b.innerHTML = '<svg aria-hidden="true"><use href="#i-chev"/></svg>';
    b.addEventListener('click', () => { S.month = addMonths(S.month, dir === 'prev' ? -1 : 1); build(); });
    return b;
  }

  function paint() {
    if (builtFor !== S.month + '|' + monthsShown()) return build();
    const choosingEnd = S.start && !S.end;
    const previewEnd = choosingEnd && S.hover && validEnd(S.start, S.hover) ? S.hover : null;
    const rangeEnd = S.end || previewEnd;
    let tabSet = false;
    $$('.day[data-k]', calEl).forEach(b => {
      const k = b.dataset.k;
      const past = isPast(k), busy = isBusy(k);
      const endok = choosingEnd && busy && validEnd(S.start, k);
      const closed = choosingEnd && !busy && !past && k > S.start && !validEnd(S.start, k);
      const sel = k === S.start || k === S.end;
      b.classList.toggle('is-past', past);
      b.classList.toggle('is-busy', busy && !endok && !past);
      b.classList.toggle('is-endok', !!endok);
      b.classList.toggle('is-closed', !!closed);
      b.classList.toggle('is-today', k === todayKey);
      b.classList.toggle('is-sel', sel);
      b.classList.toggle('is-start', k === S.start);
      b.classList.toggle('is-end', k === S.end);
      b.classList.toggle('has-end', k === S.start && !!rangeEnd);
      b.classList.toggle('in-range', !!rangeEnd && k > S.start && k < rangeEnd);
      b.disabled = past || (busy && !endok);
      let label = fmtLong(k);
      if (past) label += ', passé'; else if (busy && !endok) label += ', déjà pris'; else label += ', libre';
      if (k === S.start) label += ', arrivée'; if (k === S.end) label += ', départ';
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-pressed', String(sel));
      if (!tabSet && !b.disabled && (k === S.start || (!S.start && true))) { b.tabIndex = 0; tabSet = true; } else b.tabIndex = -1;
    });
  }

  calEl.addEventListener('click', e => { const b = e.target.closest('.day[data-k]'); if (b && !b.disabled) pick(b.dataset.k); });
  calEl.addEventListener('mouseover', e => {
    const b = e.target.closest('.day[data-k]');
    if (!b || !S.start || S.end) return;
    if (S.hover !== b.dataset.k) { S.hover = b.dataset.k; paint(); }
  });
  calEl.addEventListener('mouseleave', () => { if (S.hover) { S.hover = null; paint(); } });
  calEl.addEventListener('focusin', e => {
    const b = e.target.closest('.day[data-k]'); if (!b) return;
    $$('.day[data-k]', calEl).forEach(x => { x.tabIndex = -1; }); b.tabIndex = 0;
  });
  calEl.addEventListener('keydown', e => {
    const b = e.target.closest('.day[data-k]'); if (!b) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!step) return;
    e.preventDefault();
    const k = addDays(b.dataset.k, step);
    if (k < todayKey) return;
    let t = $('.day[data-k="' + k + '"]', calEl);
    if (!t) {
      // le jour visé est dans un autre mois : on décale l'affichage
      const target = monthStart(k);
      S.month = target < S.month ? target : addMonths(target, -(monthsShown() - 1));
      if (S.month < monthStart(todayKey)) S.month = monthStart(todayKey);
      build();
      t = $('.day[data-k="' + k + '"]', calEl);
    }
    if (t) t.focus();
  });
  window.addEventListener('resize', () => { if (builtFor !== S.month + '|' + monthsShown()) build(); });

  fIn.addEventListener('click', () => { S.start = null; S.end = null; S.hover = null; statusEl.textContent = ''; paint(); summary(); });
  fOut.addEventListener('click', () => { if (!S.start) statusEl.textContent = 'Choisissez d’abord votre date d’arrivée.'; });

  /* ---------- voyageurs ---------- */
  function setGuests(n) {
    S.guests = Math.max(1, Math.min(MAX_GUESTS, n));
    gVal.textContent = S.guests;
    gMinus.disabled = S.guests <= 1; gPlus.disabled = S.guests >= MAX_GUESTS;
    gHint.textContent = S.guests > BASE_GUESTS
      ? S.guests + ' personnes : la ' + S.guests + 'e est possible sur demande (+' + EXTRA + ' € par nuit)'
      : S.guests + ' personne' + (S.guests > 1 ? 's' : '') + ', lit de 160 × 200';
    summary();
  }
  gMinus.addEventListener('click', () => setGuests(S.guests - 1));
  gPlus.addEventListener('click', () => setGuests(S.guests + 1));

  /* ---------- résumé ---------- */
  function summary() {
    vIn.textContent = S.start ? fmtShort(S.start) : 'Choisir';
    vOut.textContent = S.end ? fmtShort(S.end) : 'Choisir';
    fIn.classList.toggle('is-active', !S.start || !!S.end);
    fOut.classList.toggle('is-active', !!S.start && !S.end);
    const q = quote();
    submit.disabled = !q;
    if (!q) {
      vNights.textContent = S.start ? 'Choisissez maintenant votre date de départ.' : '';
      recap.innerHTML = '<p class="recap__empty">Choisissez vos dates pour voir l’estimation.</p>';
      return;
    }
    vNights.textContent = q.nights + ' nuit' + (q.nights > 1 ? 's' : '') + ' · ' + fmtLong(S.start).replace(/ \d{4}$/, '') + ' → ' + fmtLong(S.end).replace(/ \d{4}$/, '');
    let rows = '';
    q.groups.forEach(g => { rows += '<div><dt>' + g.n + ' nuit' + (g.n > 1 ? 's' : '') + ' × ' + eur(g.rate) + (g.label ? ' <small>(' + g.label.toLowerCase() + ')</small>' : '') + '</dt><dd>' + eur(g.n * g.rate) + '</dd></div>'; });
    if (q.extraGuests) rows += '<div><dt>Personne supplémentaire · ' + q.nights + ' × ' + eur(EXTRA) + '</dt><dd>' + eur(q.extraTotal) + '</dd></div>';
    rows += '<div class="total"><dt>Total estimé</dt><dd>' + eur(q.total) + '</dd></div>';
    recap.innerHTML = '<dl>' + rows + '</dl><p class="recap__note">Estimation indicative, confirmée par l’hôte. Taxe de séjour en sus. Arrivée à partir de ' + (CFG.CHECKIN || '15:00').replace(':', ' h ').replace(/ 00$/, '') + ', départ avant ' + (CFG.CHECKOUT || '10:30').replace(':', ' h ') + '.</p>';
  }

  /* ---------- validation ---------- */
  const rules = {
    name: v => (v.trim().length >= 2 ? '' : 'Indiquez votre nom.'),
    email: v => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Adresse e-mail invalide.'),
    phone: v => { const d = v.replace(/[^\d]/g, ''); return d.length >= 9 && d.length <= 15 ? '' : 'Numéro de téléphone invalide.'; },
    consent: () => ($('#fConsent').checked ? '' : 'Merci de cocher cette case pour envoyer la demande.')
  };
  const fields = { name: $('#fName'), email: $('#fEmail'), phone: $('#fPhone'), consent: $('#fConsent') };
  function check(name, focus) {
    const msg = rules[name](fields[name].value || '');
    const slot = $('[data-err="' + name + '"]', form);
    if (slot) slot.textContent = msg;
    if (name !== 'consent') fields[name].classList.toggle('is-bad', !!msg);
    fields[name].setAttribute('aria-invalid', String(!!msg));
    return msg;
  }
  ['name', 'email', 'phone'].forEach(n => fields[n].addEventListener('blur', () => check(n)));
  ['name', 'email', 'phone'].forEach(n => fields[n].addEventListener('input', () => { if (fields[n].classList.contains('is-bad')) check(n); }));

  /* ---------- envoi ---------- */
  function makeRef() {
    const a = S.start.replace(/-/g, '').slice(2);
    const r = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    return 'LAU-' + a + '-' + r;
  }
  async function post(payload) {
    if (!CFG.BOOKING_WEBHOOK) return { ok: true, demo: true };
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(CFG.BOOKING_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload), signal: ctrl.signal });
      clearTimeout(to);
      let j = {};
      try { j = await r.json(); } catch (e) { /* réponse non JSON */ }
      if (!r.ok || j.ok === false) return { ok: false, conflict: !!(j && j.conflict) };
      return { ok: true, data: j };
    } catch (e) { clearTimeout(to); return { ok: false, network: true }; }
  }
  function msgBox() {
    let m = $('#formMsg');
    if (!m) { m = document.createElement('p'); m.id = 'formMsg'; m.className = 'book__fine'; m.setAttribute('role', 'alert'); m.style.color = '#b3261e'; m.style.fontWeight = '600'; submit.parentNode.insertBefore(m, submit); }
    return m;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (S.sending) return;
    const q = quote(); if (!q) return;
    let bad = '';
    ['name', 'email', 'phone', 'consent'].forEach(n => { const m = check(n); if (m && !bad) { bad = n; } });
    if (bad) { fields[bad].focus(); return; }
    if ($('#fHp').value) { showDone(makeRef(), q, true); return; }       // pot de miel : on fait semblant, rien n'est envoyé

    S.sending = true; submit.disabled = true;
    const label = submit.querySelector('span'), old = label.textContent;
    label.textContent = 'Envoi en cours…';
    const ref = makeRef();
    const payload = {
      ref, arrival: S.start, departure: S.end, nights: q.nights, guests: S.guests,
      arrivalTime: $('#fTime').value, name: fields.name.value.trim(), email: fields.email.value.trim(), phone: fields.phone.value.trim(),
      message: $('#fMsg').value.trim(), estimate: q.total, currency: 'EUR', locale: 'fr', page: location.href, sentAt: new Date().toISOString()
    };
    const res = await post(payload);
    S.sending = false; label.textContent = old; submit.disabled = false;
    if (res.ok) { msgBox().textContent = ''; S.lastPayload = payload; showDone(ref, q, !!res.demo); }
    else if (res.conflict) { msgBox().textContent = 'Ces dates viennent d’être réservées. Merci d’en choisir d’autres.'; S.start = S.end = null; await loadAvailability(); summary(); }
    else { msgBox().textContent = 'L’envoi n’a pas pu être confirmé. Appelez l’hôte au ' + (CFG.PHONE_DISPLAY || '') + ' ou réessayez dans un instant.'; }
  });

  /* ---------- confirmation, agenda du voyageur ---------- */
  const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const compact = (k, t) => k.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
  function fold(line) { const out = []; while (line.length > 72) { out.push(line.slice(0, 72)); line = ' ' + line.slice(72); } out.push(line); return out.join('\r\n'); }
  function buildIcs(ref, p) {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Les Lauriers//Reservation//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT', 'UID:' + ref + '@les-lauriers', 'DTSTAMP:' + now,
      'DTSTART:' + compact(p.arrival, CFG.CHECKIN || '15:00'), 'DTEND:' + compact(p.departure, CFG.CHECKOUT || '10:30'),
      'SUMMARY:' + icsEsc('Séjour aux Lauriers, Moustiers-Sainte-Marie'),
      'LOCATION:' + icsEsc(CFG.ADDRESS || ''),
      'DESCRIPTION:' + icsEsc('Demande ' + ref + ' · ' + p.nights + ' nuit(s) · ' + p.guests + ' personne(s) · Hôte : ' + (CFG.PHONE_DISPLAY || '') + ' · Estimation ' + p.estimate + ' € (à confirmer avec l’hôte)'),
      'END:VEVENT', 'END:VCALENDAR'
    ];
    return lines.map(fold).join('\r\n');
  }
  function showDone(ref, q, demo) {
    const p = S.lastPayload || { arrival: S.start, departure: S.end, nights: q.nights, guests: S.guests, estimate: q.total, name: fields.name.value.trim() };
    const first = (p.name || '').split(/\s+/)[0] || '';
    grid.hidden = true; done.hidden = false;
    $('#doneTitle').textContent = demo ? 'Demande préparée' : 'Demande envoyée';
    const thanks = first ? 'Merci ' + first + ' ! ' : 'Merci ! ';
    $('#doneText').textContent = demo
      ? thanks + 'Voici le récapitulatif de votre demande. Une fois le site relié à l’agenda, ce même formulaire y enregistre vos nuits et prévient l’hôte.'
      : thanks + (CFG.HOST_NAME ? CFG.HOST_NAME : 'L’hôte') + ' a bien reçu vos dates et vous confirme sa disponibilité très vite, par téléphone ou par e-mail. Gardez votre référence.';
    $('#doneSum').innerHTML = [
      ['Arrivée', fmtShort(p.arrival)], ['Départ', fmtShort(p.departure)],
      ['Voyageurs', String(p.guests)], ['Estimation', eur(p.estimate)], ['Référence', ref]
    ].map(r => '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>').join('');
    $('#doneDemo').hidden = !demo;
    const ics = buildIcs(ref, p);
    const a = $('#btnIcs'); if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })); a.dataset.url = a.href;
    a.download = 'sejour-les-lauriers-' + p.arrival + '.ics';
    $('#btnGcal').href = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Séjour aux Lauriers, Moustiers-Sainte-Marie') +
      '&dates=' + compact(p.arrival, CFG.CHECKIN || '15:00') + '/' + compact(p.departure, CFG.CHECKOUT || '10:30') +
      '&location=' + encodeURIComponent(CFG.ADDRESS || '') + '&details=' + encodeURIComponent('Demande ' + ref + ' — hôte : ' + (CFG.PHONE_DISPLAY || '')) + '&ctz=Europe/Paris';
    const wa = 'Bonjour, je viens de faire une demande de séjour aux Lauriers du ' + fmtLong(p.arrival) + ' au ' + fmtLong(p.departure) + ' pour ' + p.guests + ' personne' + (p.guests > 1 ? 's' : '') + ' (réf. ' + ref + '). Pouvez-vous me confirmer la disponibilité ? ' + (p.name || '');
    $('#btnWa').href = 'https://wa.me/' + String(CFG.PHONE_TEL || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(wa);
    S.lastRef = ref;
    done.focus({ preventScroll: true });
    $('#bookCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('#doneBack').addEventListener('click', () => { done.hidden = true; grid.hidden = false; $('#bookCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  /* ---------- API publique + démarrage ---------- */
  function prefill(o) {
    if (o.guests) setGuests(o.guests);
    const a = o.arrival, d = o.departure;
    if (!a || a < todayKey) return;
    S.start = a; S.end = null; S.hover = null; S.month = monthStart(a);
    if (S.month > LAST_MONTH) S.month = LAST_MONTH;
    if (d && validEnd(a, d) && !isBusy(a)) S.end = d;
    else if (d) statusEl.textContent = 'Ces nuits ne sont pas toutes disponibles : choisissez un autre départ.';
    if (isBusy(a)) { S.start = null; statusEl.textContent = 'Cette date d’arrivée est déjà prise : choisissez-en une autre.'; }
    build(); summary();
  }
  window.LauriersBooking = { prefill };

  if (CFG.DEMO_MODE) { const b = $('#demoBanner'); if (b) b.hidden = false; }
  setGuests(2);
  build();
  summary();
  loadAvailability();
  const qs = new URLSearchParams(location.search);
  if (qs.get('arrivee')) prefill({ arrival: qs.get('arrivee'), departure: qs.get('depart'), guests: +qs.get('voyageurs') || 2 });
})();
