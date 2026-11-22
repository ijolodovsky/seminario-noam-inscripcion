(() => {
  'use strict';

  /* ------------------------------------------------------------ */
  /*  Definición del formulario                                   */
  /* ------------------------------------------------------------ */
  // Turnos de capacitación (los mismos de la inscripción). Cada persona ve solo los que le tocaban.
  const TURNOS = [
    { key: 'inst', bloque: 'INST', hora: '10:30', cls: '', titulo: 'Capacitación con instituciones' },
    { key: 'w1', bloque: 'HAD', hora: '12:30', cls: 'bloque__hora--b', titulo: 'Workshop 1 · Fortalecer nuestra hadrajá' },
    { key: 'w2', bloque: 'HAD', hora: '14:45', cls: 'bloque__hora--c', titulo: 'Workshop 2 · Fortalecer nuestra hadrajá' },
  ];
  // Actividades que no se elegían: cada tipo tuvo una fija en ese turno.
  const FIJAS = [
    { id: 'NOFIM', turno: 'inst', tipos: ['nofim'], titulo: 'Espacio Nofim', aCargo: 'Nofim' },
    { id: 'SHOSHI', turno: 'w1', tipos: ['coordinador', 'director'], titulo: 'Espacio con Shoshi', aCargo: 'Coordis y dires' },
    { id: 'TAMUTOTO', turno: 'w2', tipos: ['coordinador', 'director'], titulo: 'Capacitación Tamu y Toto', aCargo: 'Coordis y dires' },
  ];
  const fijaDe = (tipo, turno) => FIJAS.find((f) => f.turno === turno && f.tipos.includes(String(tipo || '').toLowerCase()));
  // Momentos con puntaje 1-5. `opcional`: se puede marcar "No estuve".
  const M = (key, titulo, corto, opcional = true) => ({ key, titulo, corto, opcional });
  const MOMENTOS_A = [M('logistica', '¿Qué te pareció la logística en general?', 'Logística', false), M('peula', '¿Qué te pareció la peulá del sábado a la noche?', 'Peulá'), M('fogon', '¿Qué te pareció el fogón?', 'Fogón'), M('pianobar', '¿Qué te pareció el piano bar?', 'Piano bar'), M('shajarit', '¿Qué te pareció shajarit?', 'Shajarit')];
  const MOMENTOS_B = [M('cierre', '¿Qué te pareció el cierre?', 'Cierre')];
  const ESCALA = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', 'Excelente'];
  const INTERACCION = ['Sí, mucho', 'Un poco', 'No'];
  const REPETIR = ['Sí', 'Tal vez', 'No'];

  const LOCAL = /^(localhost|127.0.0.1|[::1])$/.test(location.hostname) || location.protocol === 'file:';
  const DEMO = !window.API_URL && LOCAL;
  const SIN_BACKEND = !window.API_URL && !LOCAL;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    dni: '', persona: null, inscripcion: null, respuesta: null, actividades: [], abierto: true,
    admin: null, adminClave: '', preview: false, previewTipo: 'Madrij', tab: 'panel',
  };

  const habilitados = (tipo) => {
    const t = String(tipo || '').toLowerCase();
    const had = t === 'madrij' || t === 'nofim';
    return { inst: t !== 'nofim' && t !== 'staff', w1: had, w2: had };
  };
  const tipoVisible = (p) => p.rol || p.tipo || '';

  /* ------------------------------------------------------------ */
  /*  API con reintentos                                          */
  /* ------------------------------------------------------------ */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function llamar(method, params, body) {
    if (DEMO) return demoApi(method, params, body);
    const url = window.API_URL + (params ? '?' + new URLSearchParams(params) : '');
    const opts = method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }
      : { method: 'GET' };
    let ultimoError;
    for (let intento = 0; intento < 5; intento++) {
      try {
        const res = await fetch(url, opts);
        const txt = await res.text();
        let data;
        try { data = JSON.parse(txt); } catch (_) { throw new Error('respuesta-no-json'); }
        if (data.code === 'OCUPADO' && intento < 4) throw new Error('ocupado');
        return data;
      } catch (err) {
        ultimoError = err;
        const espera = Math.min(8000, 800 * 2 ** intento) + Math.random() * 1200;
        setLoading(true, intento === 0 ? 'Hay mucha gente conectada, reintentando…' : 'Seguimos intentando…');
        await sleep(espera);
      }
    }
    console.error(ultimoError);
    return { ok: false, code: 'RED', msg: 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.' };
  }

  /* ------------------------------------------------------------ */
  /*  UI helpers                                                  */
  /* ------------------------------------------------------------ */
  function setLoading(on, txt) {
    $('#loading').hidden = !on;
    if (txt) $('#loading-txt').textContent = txt;
  }
  function show(id) {
    ['#paso-dni', '#paso-form', '#paso-listo', '#admin-bar', '#panel'].forEach((s) => ($(s).hidden = true));
    (Array.isArray(id) ? id : [id]).forEach((s) => ($(s).hidden = false));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function error(el, msg) {
    const e = $(el);
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  /* ------------------------------------------------------------ */
  /*  Paso 1: DNI                                                 */
  /* ------------------------------------------------------------ */
  $('#form-dni').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const raw = $('#dni').value.trim();
    const soloNumeros = raw.replace(/[.\s-]/g, '');
    if (!raw) return error('#dni-error', 'Ingresá tu DNI.');
    if (/^\d+$/.test(soloNumeros) && (soloNumeros.length < 7 || soloNumeros.length > 9)) {
      return error('#dni-error', 'El DNI tiene que tener entre 7 y 8 números.');
    }
    error('#dni-error', '');
    setLoading(true, 'Buscándote en la lista…');
    const data = await llamar('GET', { action: 'lookup', dni: /^\d+$/.test(soloNumeros) ? soloNumeros : raw });
    setLoading(false);
    if (!data.ok) return error('#dni-error', data.msg);

    if (data.admin) {
      state.admin = data; state.adminClave = raw; state.actividades = data.actividades; state.abierto = data.abierto;
      $('#dni').value = '';
      return setTab('panel');
    }
    Object.assign(state, {
      dni: soloNumeros, persona: data.persona, inscripcion: data.inscripcion, respuesta: data.respuesta,
      actividades: data.actividades, abierto: data.abierto, preview: false,
    });
    renderForm();
    show('#paso-form');
  });

  $('#btn-salir').addEventListener('click', salir);
  $('#btn-salir-admin').addEventListener('click', salir);
  $('#btn-modificar').addEventListener('click', () => { renderForm(); show(state.preview ? ['#admin-bar', '#paso-form'] : '#paso-form'); });

  function salir() {
    Object.assign(state, { dni: '', persona: null, inscripcion: null, respuesta: null, admin: null, adminClave: '', preview: false });
    $('#dni').value = '';
    show('#paso-dni');
    $('#dni').focus();
  }

  /* ------------------------------------------------------------ */
  /*  Paso 2: formulario                                          */
  /* ------------------------------------------------------------ */
  const chips = (name, opciones, valor, extraCls = '') => `<div class="chips ${extraCls}">${opciones.map((o) => {
    const v = typeof o === 'string' ? o : o.v, l = typeof o === 'string' ? o : o.l;
    return `<label class="chip"><input type="radio" name="${name}" value="${esc(v)}" ${String(valor) === String(v) ? 'checked' : ''}><span>${esc(l)}</span></label>`;
  }).join('')}</div>`;

  function puntaje(key, r, opcional) {
    const v = r[key + '_p'] || '';
    const ops = [1, 2, 3, 4, 5].map((n) => ({ v: n, l: n }));
    return `<div class="rating" data-key="${key}">
      ${chips(key + '_p', ops, v, 'chips--escala')}
      <div class="rating__ends"><span>Muy malo</span><span>Excelente</span></div>
      ${opcional ? `<label class="nofui"><input type="checkbox" name="${key}_no" ${v === 'no' ? 'checked' : ''}> No estuve en este momento</label>` : ''}
      <textarea class="comentario" name="${key}_c" rows="2" maxlength="2000" placeholder="Si querés, contanos por qué (opcional)">${esc(r[key + '_c'] || '')}</textarea>
    </div>`;
  }

  const pregunta = (n, titulo, cuerpo, attrs = '') => `<section class="card pregunta" ${attrs}><h3 class="pregunta__t"><span class="pregunta__n">${n}</span>${titulo}</h3>${cuerpo}</section>`;

  function renderForm() {
    const p = state.persona;
    $('#nombre').textContent = p.nombre;
    $('#rol').textContent = tipoVisible(p);
    $('#comunidad').textContent = p.comunidad;
    $('#preview-banner').hidden = !state.preview;
    $('#ya-respondio').hidden = !state.respuesta || !state.abierto || state.preview;
    $('#cerrado').hidden = state.abierto;
    $('#btn-salir').hidden = state.preview;
    error('#form-error', '');

    const r = state.respuesta || {};
    const ins = state.inscripcion || {};
    const hab = habilitados(p.tipo);
    let n = 0;
    const html = [];

    // Comida
    html.push(pregunta(++n, 'Comida', `
      <p class="pregunta__sub">¿Tenés alguna condición especial de comida? (celiaquía, vegetariano/a, alergias, etc.)</p>
      ${chips('comida_especial', ['Sí', 'No'], r.comida_especial)}
      <div class="sub" data-si="comida_especial" hidden>
        <input class="texto" name="comida_cual" maxlength="200" placeholder="¿Cuál? (opcional)" value="${esc(r.comida_cual || '')}">
      </div>
      <p class="pregunta__sub" style="margin-top:16px">¿Qué te pareció la comida?</p>
      ${puntaje('comida', r, false)}`, 'data-q="comida"'));

    MOMENTOS_A.forEach((m) => html.push(pregunta(++n, esc(m.titulo), puntaje(m.key, r, m.opcional), `data-q="${m.key}"`)));

    // Capacitaciones
    TURNOS.forEach((t) => {
      const fija = !hab[t.key] && fijaDe(p.tipo, t.key);
      if (fija) {
        html.push(pregunta(++n, `<span class="bloque__hora ${t.cls}">${t.hora}</span> ¿Qué te pareció ${esc(fija.titulo)}?`, puntaje(t.key, r, true), `data-q="${t.key}"`));
        return;
      }
      if (!hab[t.key]) return;
      const elegida = r[t.key + '_id'] || ins[t.key] || '';
      const opciones = state.actividades.filter((a) => a.bloque === t.bloque)
        .map((a) => `<option value="${esc(a.id)}" ${elegida === a.id ? 'selected' : ''}>${esc(a.aCargo)} · ${esc(a.titulo)}</option>`).join('');
      html.push(pregunta(++n, `<span class="bloque__hora ${t.cls}">${t.hora}</span> ${esc(t.titulo)}`, `
        <label class="label" for="sel-${t.key}">¿En cuál estuviste?</label>
        <select class="select" id="sel-${t.key}" name="${t.key}_id">
          <option value="" ${elegida ? '' : 'selected'}>Elegí una…</option>
          ${opciones}
          <option value="ninguna" ${elegida === 'ninguna' ? 'selected' : ''}>No fui a ninguna</option>
        </select>
        ${ins[t.key] && !r[t.key + '_id'] ? '<p class="hint">Te marcamos la que elegiste en la inscripción. Si al final fuiste a otra, cambiala.</p>' : ''}
        <div class="sub" data-cap="${t.key}">
          <p class="pregunta__sub">¿Qué te pareció?</p>
          ${puntaje(t.key, r, false)}
        </div>`, `data-q="${t.key}"`));
    });

    MOMENTOS_B.forEach((m) => html.push(pregunta(++n, esc(m.titulo), puntaje(m.key, r, m.opcional), `data-q="${m.key}"`)));

    html.push(pregunta(++n, '¿Pudiste interactuar con otras comunidades durante el seminario?', `
      ${chips('interaccion', INTERACCION, r.interaccion)}
      <textarea class="comentario" name="interaccion_c" rows="2" maxlength="2000" placeholder="Contanos más si querés (opcional)">${esc(r.interaccion_c || '')}</textarea>`, 'data-q="interaccion"'));

    html.push(pregunta(++n, '¿Qué te llevás del seminario?', `
      <textarea class="comentario" name="llevas" rows="3" maxlength="3000" placeholder="Una idea, una herramienta, una persona, un momento…">${esc(r.llevas || '')}</textarea>`, 'data-q="llevas"'));

    html.push(pregunta(++n, '¿Te gustaría que se repita el próximo año?', chips('repetir', REPETIR, r.repetir), 'data-q="repetir"'));

    html.push(pregunta(++n, '¿Algo más que quieras destacar?', `
      <textarea class="comentario" name="extra" rows="3" maxlength="3000" placeholder="Lo que quieras (opcional)">${esc(r.extra || '')}</textarea>`, 'data-q="extra"'));

    $('#preguntas').innerHTML = html.join('');
    const form = $('#form-feedback');
    $$('input, textarea, select', form).forEach((el) => { el.disabled = !state.abierto; });
    $('#btn-enviar').hidden = !state.abierto;
    $('#btn-enviar').textContent = state.preview ? 'Probar envío (no se guarda)' : (state.respuesta ? 'Guardar cambios' : 'Enviar feedback');
    actualizarVisibles();
  }

  $('#preguntas').addEventListener('change', (ev) => {
    // marcar un puntaje destilda "No estuve" y viceversa
    const t = ev.target;
    const rating = t.closest('.rating');
    if (rating) {
      if (t.type === 'checkbox' && t.checked) $$('.chips input', rating).forEach((i) => { i.checked = false; });
      if (t.type === 'radio') { const no = $('.nofui input', rating); if (no) no.checked = false; }
    }
    $$('.pregunta--falta').forEach((q) => { if (q.contains(t)) q.classList.remove('pregunta--falta'); });
    actualizarVisibles();
  });

  function actualizarVisibles() {
    const form = $('#form-feedback');
    $$('[data-si]', form).forEach((d) => { d.hidden = (($(`input[name="${d.dataset.si}"]:checked`, form) || {}).value) !== 'Sí'; });
    $$('[data-cap]', form).forEach((d) => { const v = form.elements[d.dataset.cap + '_id'].value; d.hidden = !v || v === 'ninguna'; });
    $$('.rating', form).forEach((rt) => {
      const no = $('.nofui input', rt);
      rt.classList.toggle('rating--no', !!(no && no.checked));
    });
  }

  function leerForm() {
    const form = $('#form-feedback');
    const val = (name) => {
      const els = form.elements[name];
      if (!els) return '';
      if (els instanceof RadioNodeList) return els.value || '';
      return els.type === 'checkbox' ? els.checked : (els.value || '').trim();
    };
    const r = {};
    const faltan = [];
    const leerPuntaje = (key, qid) => {
      const no = val(key + '_no');
      r[key + '_p'] = no === true ? 'no' : val(key + '_p');
      r[key + '_c'] = no === true ? '' : val(key + '_c');
      if (!r[key + '_p']) faltan.push(qid || key);
    };

    r.comida_especial = val('comida_especial');
    if (!r.comida_especial) faltan.push('comida');
    r.comida_cual = r.comida_especial === 'Sí' ? val('comida_cual') : '';
    leerPuntaje('comida');

    MOMENTOS_A.forEach((m) => leerPuntaje(m.key));
    const hab = habilitados(state.persona.tipo);
    TURNOS.forEach((t) => {
      const fija = !hab[t.key] && fijaDe(state.persona.tipo, t.key);
      if (fija) { r[t.key + '_id'] = fija.id; leerPuntaje(t.key); return; }
      if (!hab[t.key]) return;
      r[t.key + '_id'] = val(t.key + '_id');
      if (!r[t.key + '_id']) faltan.push(t.key);
      else if (r[t.key + '_id'] === 'ninguna') { r[t.key + '_p'] = ''; r[t.key + '_c'] = ''; }
      else leerPuntaje(t.key);
    });
    MOMENTOS_B.forEach((m) => leerPuntaje(m.key));
    r.interaccion = val('interaccion');
    r.interaccion_c = val('interaccion_c');
    if (!r.interaccion) faltan.push('interaccion');
    r.llevas = val('llevas');
    r.repetir = val('repetir');
    if (!r.repetir) faltan.push('repetir');
    r.extra = val('extra');
    return { r, faltan: [...new Set(faltan)] };
  }

  $('#form-feedback').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error('#form-error', '');
    $$('.pregunta--falta').forEach((q) => q.classList.remove('pregunta--falta'));
    const { r, faltan } = leerForm();
    if (faltan.length) {
      faltan.forEach((k) => { const q = $(`[data-q="${k}"]`); if (q) q.classList.add('pregunta--falta'); });
      error('#form-error', faltan.length === 1 ? 'Te falta responder 1 pregunta (está marcada en rojo).' : `Te faltan responder ${faltan.length} preguntas (están marcadas en rojo).`);
      const primera = $('.pregunta--falta');
      if (primera) primera.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (state.preview) return show(['#admin-bar', '#paso-listo']);

    $('#btn-enviar').disabled = true;
    setLoading(true, 'Enviando…');
    const data = await llamar('POST', null, { action: 'feedback', dni: state.dni, r });
    setLoading(false);
    $('#btn-enviar').disabled = false;
    if (!data.ok) return error('#form-error', data.msg);
    state.respuesta = data.respuesta;
    show('#paso-listo');
  });

  /* ------------------------------------------------------------ */
  /*  Admin                                                       */
  /* ------------------------------------------------------------ */
  function prepararPreview() {
    const tipo = state.previewTipo;
    state.preview = true;
    state.dni = '';
    state.persona = { nombre: 'Así te ve un/a ' + (tipo === 'Coordinador' ? 'coordinador/a' : tipo === 'Nofim' ? 'madrij de Nofim' : 'madrij'), comunidad: 'Vista previa', rol: tipo, tipo };
    state.inscripcion = null;
    state.respuesta = null;
    state.abierto = state.admin.abierto;
    renderForm();
  }

  function setTab(tab) {
    state.tab = tab;
    $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('#vista-como').hidden = tab !== 'vista';
    if (tab === 'vista') { prepararPreview(); show(['#admin-bar', '#paso-form']); }
    else { state.preview = false; renderPanel(); show(['#admin-bar', '#panel']); }
  }

  $$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('.seg button').forEach((b) => b.addEventListener('click', () => {
    $$('.seg button').forEach((x) => x.classList.toggle('is-on', x === b));
    state.previewTipo = b.dataset.tipo;
    prepararPreview();
    show(['#admin-bar', '#paso-form']);
  }));

  $('#btn-refrescar').addEventListener('click', async () => {
    setLoading(true, 'Actualizando…');
    const data = await llamar('GET', { action: 'panel', clave: state.adminClave });
    setLoading(false);
    if (data.ok) { state.admin = data; state.actividades = data.actividades; renderPanel(); }
  });

  function barra(pct, cls) {
    return `<div class="barra__track"><div class="barra__fill ${cls || ''}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
  }
  const quien = (x) => `${esc(x.persona.nombre)} · ${esc(x.persona.comunidad)}`;
  const fmt = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function stats(rs, campoP, filtro) {
    const xs = rs.filter((x) => (!filtro || filtro(x)) && x[campoP] && x[campoP] !== 'no');
    const notas = xs.map((x) => Number(x[campoP])).filter((v) => v >= 1 && v <= 5);
    const dist = [0, 0, 0, 0, 0];
    notas.forEach((v) => dist[v - 1]++);
    const noFue = rs.filter((x) => (!filtro || filtro(x)) && x[campoP] === 'no').length;
    return { n: notas.length, prom: notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : 0, dist, noFue, xs };
  }

  function bloqueStats(titulo, s, comentarios, extra) {
    const cls = !s.n ? '' : s.prom < 3 ? 'barra__fill--poco' : s.prom >= 4.3 ? 'barra__fill--lleno' : '';
    const dist = s.n ? `<span class="dist">${s.dist.map((c, i) => `<span title="${ESCALA[i + 1]}"><b>${i + 1}</b>${c}</span>`).join('')}</span>` : '';
    const coms = comentarios.length
      ? `<ul class="coms">${comentarios.map((c) => `<li>${c.nota ? `<span class="nota nota--${c.nota}">${c.nota}</span>` : ''}${esc(c.txt)}<small>${c.quien}</small></li>`).join('')}</ul>`
      : '<p class="hint">Sin comentarios.</p>';
    return `<details class="com">
      <summary><span>${titulo}</span><span class="barra__n">${s.n ? fmt(s.prom) : '–'} <small>(${s.n}${s.noFue ? ` · ${s.noFue} no fue` : ''}${extra || ''})</small></span>${barra((s.prom / 5) * 100, cls)}</summary>
      ${dist}${coms}
    </details>`;
  }

  const comentariosDe = (xs, campoP, campoC) => xs.filter((x) => x[campoC]).map((x) => ({ txt: x[campoC], nota: x[campoP] && x[campoP] !== 'no' ? x[campoP] : '', quien: quien(x) }));

  function distOpciones(titulo, rs, campo, opciones) {
    const tot = rs.filter((x) => x[campo]).length;
    return `<div class="cupo-grupo"><h4>${titulo}</h4>${opciones.map((o) => {
      const c = rs.filter((x) => x[campo] === o).length;
      const pct = tot ? Math.round((c / tot) * 100) : 0;
      return `<div class="barra"><span>${esc(o)}</span><span class="barra__n">${c} · ${pct}%</span>${barra(pct)}</div>`;
    }).join('')}</div>`;
  }

  function listaTextos(rs, campo) {
    const xs = rs.filter((x) => x[campo]);
    return xs.length ? xs.map((x) => `<div class="ult">${esc(x[campo])}<small>${quien(x)}</small></div>`).join('') : '<p class="hint">Todavía no hay respuestas.</p>';
  }

  function renderPanel() {
    const d = state.admin.panel;
    const rs = d.respuestas || [];
    const tot = d.totalParticipantes;
    const pct = tot ? Math.round((rs.length / tot) * 100) : 0;
    const todos = [...MOMENTOS_A, ...MOMENTOS_B];
    const promGeneral = (() => {
      const ss = todos.map((m) => stats(rs, m.key + '_p')).filter((s) => s.n);
      return ss.length ? ss.reduce((a, s) => a + s.prom, 0) / ss.length : 0;
    })();
    const repSi = rs.filter((x) => x.repetir === 'Sí').length;
    const kp = (v, l, accent) => `<div class="kpi ${accent ? 'kpi--accent' : ''}"><div class="kpi__v">${v}</div><div class="kpi__l">${l}</div></div>`;
    $('#kpis').innerHTML =
      kp(`${rs.length}/${tot}`, `Respondieron (${pct}%)`, true) +
      kp(rs.length ? fmt(promGeneral) : '–', 'Puntaje promedio (de 5)') +
      kp(rs.length ? Math.round((repSi / rs.length) * 100) + '%' : '–', 'Quiere que se repita');

    $('#panel-hora').textContent = (state.admin.abierto ? 'Formulario abierto' : 'Formulario CERRADO') + ' · actualizado ' + new Date(d.generado).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    const conCond = (x) => x.comida_especial === 'Sí';
    const comidaComs = (filtro) => rs.filter((x) => filtro(x) && (x.comida_c || x.comida_cual))
      .map((x) => ({ txt: [x.comida_cual && `[${x.comida_cual}]`, x.comida_c].filter(Boolean).join(' '), nota: x.comida_p, quien: quien(x) }));
    $('#panel-momentos').innerHTML =
      bloqueStats('Comida', stats(rs, 'comida_p'), comidaComs(() => true)) +
      bloqueStats('Comida · con condición especial', stats(rs, 'comida_p', conCond), comidaComs(conCond)) +
      todos.map((m) => {
        const s = stats(rs, m.key + '_p');
        return bloqueStats(esc(m.corto), s, comentariosDe(s.xs, m.key + '_p', m.key + '_c'));
      }).join('');

    $('#panel-caps').innerHTML = TURNOS.map((t) => {
      const acts = state.actividades.filter((a) => a.bloque === t.bloque).concat(FIJAS.filter((f) => f.turno === t.key));
      const filas = acts.map((a) => {
        const s = stats(rs, t.key + '_p', (x) => x[t.key + '_id'] === a.id);
        return bloqueStats(`${esc(a.aCargo)} · ${esc(a.titulo)}`, s, comentariosDe(s.xs, t.key + '_p', t.key + '_c'));
      }).join('');
      const ninguna = rs.filter((x) => x[t.key + '_id'] === 'ninguna').length;
      return `<div class="cupo-grupo"><h4>Turno ${t.hora}${ninguna ? ` <small>(${ninguna} no fue a ninguna)</small>` : ''}</h4>${filas}</div>`;
    }).join('');

    const interCom = rs.filter((x) => x.interaccion_c);
    $('#panel-opciones').innerHTML =
      distOpciones('¿Interactuó con otras comunidades?', rs, 'interaccion', INTERACCION) +
      (interCom.length ? `<details class="com"><summary><span>Comentarios sobre interacción (${interCom.length})</span></summary><ul class="coms">${interCom.map((x) => `<li>${esc(x.interaccion_c)}<small>${quien(x)}</small></li>`).join('')}</ul></details>` : '') +
      distOpciones('¿Que se repita el próximo año?', rs, 'repetir', REPETIR);

    $('#panel-llevas').innerHTML = listaTextos(rs, 'llevas');
    $('#panel-extra').innerHTML = listaTextos(rs, 'extra');

    $('#panel-com').innerHTML = d.comunidades.map((c) => `
      <details class="com">
        <summary><span>${esc(c.comunidad)}</span><span class="barra__n">${c.respondieron}/${c.total}</span>${barra(c.total ? (c.respondieron / c.total) * 100 : 0)}</summary>
        ${c.pendientes.length ? `<p class="hint">Faltan responder:</p><ul>${c.pendientes.map((p) => `<li>${esc(p.nombre)} ${p.tipo !== 'Madrij' ? `<span class="tag">${esc(p.tipo)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="hint">¡Respondieron todos!</p>'}
      </details>`).join('');
  }

  /* ------------------------------------------------------------ */
  /*  Modo demo (sin backend)                                     */
  /* ------------------------------------------------------------ */
  function demoApi(method, params, body) {
    const db = demoApi.db || (demoApi.db = crearDemo());
    const panel = () => {
      const comunidades = {};
      Object.entries(db.personas).forEach(([dni, p]) => {
        const c = comunidades[p.comunidad] || (comunidades[p.comunidad] = { comunidad: p.comunidad, total: 0, respondieron: 0, pendientes: [] });
        c.total++;
        if (db.res[dni]) c.respondieron++; else c.pendientes.push({ nombre: p.nombre, tipo: p.tipo });
      });
      return { generado: new Date().toISOString(), totalParticipantes: Object.keys(db.personas).length, respuestas: Object.entries(db.res).map(([dni, r]) => Object.assign({ persona: db.personas[dni] }, r)), comunidades: Object.values(comunidades) };
    };
    return sleep(300).then(() => {
      if (method === 'GET') {
        const k = String(params.dni || params.clave || '').toLowerCase();
        if (k === 'admin') return { ok: true, admin: true, abierto: true, actividades: db.acts, panel: panel() };
        const p = db.personas[params.dni];
        if (!p) return { ok: false, code: 'NO_ENCONTRADO', msg: 'No encontramos ese DNI en la lista de participantes del seminario. Revisá que esté bien escrito o hablá con tu director/a.' };
        return { ok: true, abierto: true, persona: p, inscripcion: db.ins[params.dni] || null, respuesta: db.res[params.dni] || null, actividades: db.acts };
      }
      db.res[body.dni] = body.r;
      return { ok: true, respuesta: body.r };
    });
  }

  function crearDemo() {
    const A = (id, bloque, titulo, aCargo) => ({ id, bloque, titulo, aCargo });
    const r = (o) => Object.assign({ comida_especial: 'No', logistica_p: '4', peula_p: '5', fogon_p: '5', pianobar_p: 'no', shajarit_p: '3', comida_p: '4', cierre_p: '5', interaccion: 'Sí, mucho', repetir: 'Sí' }, o);
    return {
      personas: {
        11111111: { nombre: 'Madrij', comunidad: 'Comunidad de prueba', rol: 'Madrij de 5to grado', tipo: 'Madrij' },
        22222222: { nombre: 'Nofim', comunidad: 'Comunidad de prueba', rol: 'Madrija de 2do año', tipo: 'Nofim' },
        33333333: { nombre: 'Coordi', comunidad: 'Comunidad de prueba', rol: 'Coordinadora', tipo: 'Coordinador' },
        44444444: { nombre: 'Persona A', comunidad: 'Otra comunidad', rol: 'Madrij', tipo: 'Madrij' },
        55555555: { nombre: 'Persona B', comunidad: 'Otra comunidad', rol: 'Director', tipo: 'Director' },
      },
      ins: {
        11111111: { inst: 'INST-OSM', w1: 'HAD-SALUD', w2: 'HAD-CONFLICTOS' },
        22222222: { inst: '', w1: 'HAD-SOS', w2: 'HAD-INCUBADORA' },
        33333333: { inst: 'INST-KKL', w1: '', w2: '' },
      },
      res: {
        44444444: r({ logistica_c: 'Faltó señalizar mejor los espacios.', inst_id: 'INST-OSM', inst_p: '5', inst_c: 'Muy interesante el debate.', w1_id: 'HAD-SALUD', w1_p: '4', w2_id: 'HAD-SOS', w2_p: '5', llevas: 'Ideas nuevas para mis peulot y amigos de otras comunidades.', extra: '¡Gracias a todo el equipo!' }),
        55555555: r({ comida_especial: 'Sí', comida_cual: 'Vegetariana', comida_p: '2', comida_c: 'Hubo pocas opciones.', fogon_p: '4', interaccion: 'Un poco', repetir: 'Sí', inst_id: 'INST-AHORA', inst_p: '4', w1_id: 'SHOSHI', w1_p: '5', w1_c: 'Muy necesario.', w2_id: 'TAMUTOTO', w2_p: 'no', llevas: 'Ganas de seguir.' }),
      },
      acts: [
        A('INST-TAGLIT', 'INST', 'El detrás de escena de un proyecto exitoso', 'Taglit'),
        A('INST-KKL', 'INST', '¿Cómo acercar Israel? Recursos y propuestas del KKL', 'KKL'),
        A('INST-SOJNUT', 'INST', 'Israel: más que un destino, una oportunidad', 'Sojnut'),
        A('INST-AMIA', 'INST', 'Conociendo más sobre la comunidad judía argentina: de inmigrantes judíos a madrijim', 'AMIA'),
        A('INST-AHORA', 'INST', '¿Y ahora qué? Entre desafíos, preguntas y nuevas formas de hacer hadrajá', 'Joint, AMIA, KKL y Bama'),
        A('INST-OSM', 'INST', 'Dilemas de la sociedad israelí', 'OSM'),
        A('INST-NOAM', 'INST', 'Más que un movimiento: una identidad que nos une', 'Noam Olami'),
        A('HAD-INCUBADORA', 'HAD', 'Incubadora de madrijim con impacto', 'Sol Goyhman'),
        A('HAD-SOS', 'HAD', 'S.O.S.: ¡ya no tengo ideas para mis peulot!', 'Martín Hamui'),
        A('HAD-SALUD', 'HAD', 'Manual de supervivencia: salud mental en majané', 'Simón Dimerman'),
        A('HAD-CONFLICTOS', 'HAD', 'Desactivemos el quilombo: resolución creativa de conflictos', 'Paula Vinocur'),
        A('HAD-INNOVACION', 'HAD', '¿Quién dijo que se hace así? Laboratorio de innovación para la hadrajá', 'Mai Ganon'),
        A('HAD-STORYTELLING', 'HAD', '¿Cómo vendo mis propuestas? Storytelling y oratoria para la hadrajá', 'Bianca Soifer'),
      ],
    };
  }

  if (DEMO) $('#demo-hint').hidden = false;
  if (SIN_BACKEND) {
    $('#form-dni').hidden = true;
    $('#paso-dni .card__lead').textContent = 'El formulario de feedback abre pronto. ¡Volvé a entrar en un rato!';
  }
})();
