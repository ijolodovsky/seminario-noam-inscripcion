(() => {
  'use strict';

  const TURNOS = [
    { key: 'inst', bloque: 'INST', hora: '10:30', cls: '', titulo: 'Workshops con instituciones', sub: 'Primeras capacitaciones · Elegí 1' },
    { key: 'w1', bloque: 'HAD', hora: '12:30', cls: 'bloque__hora--b', titulo: 'Workshop 1 · Fortalecer nuestra hadrajá', sub: '¡Manos a la obra! · Elegí 1' },
    { key: 'w2', bloque: 'HAD', hora: '14:45', cls: 'bloque__hora--c', titulo: 'Workshop 2 · Fortalecer nuestra hadrajá', sub: 'Seguimos creando · Elegí 1 distinto al anterior' },
  ];
  const DEMO = !window.API_URL;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    dni: '', persona: null, turnos: null, inscripcion: null, borrador: null, actividades: [], abierta: true,
    admin: null, adminClave: '', preview: false, previewTipo: 'Madrij', tab: 'vista',
  };

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
        // espera creciente con algo de azar para que no reintenten todos a la vez
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
    ['#paso-dni', '#paso-elegir', '#paso-listo', '#admin-bar', '#panel'].forEach((s) => ($(s).hidden = true));
    (Array.isArray(id) ? id : [id]).forEach((s) => ($(s).hidden = false));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function error(el, msg) {
    const e = $(el);
    e.textContent = msg || '';
    e.hidden = !msg;
  }
  const habilitados = (tipo) => {
    const t = String(tipo || '').toLowerCase();
    const had = t === 'madrij' || t === 'nofim';
    return { inst: t !== 'nofim' && t !== 'staff', w1: had, w2: had };
  };

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
    setLoading(true, 'Buscando tu inscripción…');
    const data = await llamar('GET', { action: 'lookup', dni: /^\d+$/.test(soloNumeros) ? soloNumeros : raw });
    setLoading(false);
    if (!data.ok) return error('#dni-error', data.msg);

    if (data.admin) {
      state.admin = data; state.adminClave = raw; state.actividades = data.actividades; state.abierta = data.abierta;
      $('#dni').value = '';
      return abrirAdmin();
    }
    state.dni = soloNumeros;
    state.persona = data.persona;
    state.turnos = data.turnos;
    state.inscripcion = data.inscripcion;
    state.actividades = data.actividades;
    state.abierta = data.abierta;
    state.preview = false;
    renderElegir();
    show('#paso-elegir');
  });

  $('#btn-salir').addEventListener('click', salir);
  $('#btn-salir-admin').addEventListener('click', salir);
  $('#btn-modificar').addEventListener('click', () => { renderElegir(); show(state.preview ? ['#admin-bar', '#paso-elegir'] : '#paso-elegir'); });

  function salir() {
    Object.assign(state, { dni: '', persona: null, inscripcion: null, admin: null, adminClave: '', preview: false });
    $('#dni').value = '';
    show('#paso-dni');
    $('#dni').focus();
  }

  /* ------------------------------------------------------------ */
  /*  Paso 2: elegir                                              */
  /* ------------------------------------------------------------ */
  function renderElegir() {
    const p = state.persona;
    $('#nombre').textContent = p.nombre;
    $('#comunidad').textContent = p.comunidad;
    $('#preview-banner').hidden = !state.preview;
    $('#ya-inscripto').hidden = !state.inscripcion || !state.abierta || state.preview;
    $('#cerrada').hidden = state.abierta;
    $('#btn-salir').hidden = state.preview;
    error('#elegir-error', '');

    const sel = state.borrador || state.inscripcion || {};
    state.borrador = null;
    const html = [];
    let avisoHadrajaHecho = false;

    for (const t of TURNOS) {
      const head = `<div class="bloque__head"><span class="bloque__hora ${t.cls}">${t.hora}</span>
        <h3 class="bloque__titulo">${esc(t.titulo)}<span class="bloque__sub" style="display:block">${esc(t.sub)}</span></h3></div>`;

      if (!state.turnos[t.key]) {
        if (t.key === 'inst' && p.tipo === 'Nofim') {
          html.push(`<section class="bloque">${head.replace(esc(t.sub), 'Espacio Nofim')}
            <div class="aviso"><span class="aviso__icon">★</span><p>Como madrij de <b>Nofim</b>, en este horario tenés <b>un espacio propio de Nofim</b>. No tenés que anotarte a ningún workshop de este bloque.</p></div></section>`);
        } else if (t.key !== 'inst' && !avisoHadrajaHecho) {
          avisoHadrajaHecho = true;
          html.push(`<section class="bloque"><div class="bloque__head"><span class="bloque__hora bloque__hora--b">12:30</span><span class="bloque__hora bloque__hora--c">14:45</span>
            <h3 class="bloque__titulo">Workshops para fortalecer nuestra hadrajá</h3></div>
            <div class="aviso"><span class="aviso__icon">i</span><p>Estos workshops son para <b>madrijim</b>. Como director/a o coordinador/a, <b>no tenés que anotarte</b> a estos bloques.</p></div></section>`);
        }
        continue;
      }

      const opciones = state.actividades.filter((a) => a.bloque === t.bloque).map((a) => {
        const libres = a.libres[t.key];
        const checked = sel[t.key] === a.id;
        const cupoTxt = libres === 0 ? 'Completo' : libres <= 5 ? `¡Quedan ${libres}!` : `${libres} lugares`;
        const cupoCls = libres === 0 ? 'opcion__cupo--lleno' : libres <= 5 ? 'opcion__cupo--poco' : '';
        return `<label class="opcion" data-turno="${t.key}" data-id="${esc(a.id)}" data-libres="${libres}">
          <input type="radio" name="${t.key}" value="${esc(a.id)}" ${checked ? 'checked' : ''}>
          <span class="opcion__box">
            <span class="opcion__radio"></span>
            <span>
              <span class="opcion__org">${esc(a.aCargo)}</span>
              <span class="opcion__titulo">${esc(a.titulo)}</span>
              ${a.descripcion ? `<span class="opcion__desc">${esc(a.descripcion)}</span>` : ''}
              <span class="opcion__motivo" hidden></span>
            </span>
            <span class="opcion__cupo ${cupoCls}">${cupoTxt}</span>
          </span>
        </label>`;
      }).join('');
      html.push(`<section class="bloque" id="bloque-${t.key}">${head}<div class="opciones">${opciones}</div></section>`);
    }

    $('#bloques').innerHTML = html.join('');
    const algo = TURNOS.some((t) => state.turnos[t.key]);
    $('#btn-guardar').hidden = !algo || !state.abierta;
    $('#btn-guardar').textContent = state.preview ? 'Probar confirmación (no se guarda)' : (state.inscripcion ? 'Guardar cambios' : 'Confirmar inscripción');
    actualizarDisponibles();
  }

  $('#bloques').addEventListener('change', actualizarDisponibles);

  function actualizarDisponibles() {
    const elegido = (k) => ($(`input[name="${k}"]:checked`) || {}).value || '';
    const guardado = state.inscripcion || {};
    $$('.opcion').forEach((lab) => {
      const t = lab.dataset.turno, id = lab.dataset.id, libres = Number(lab.dataset.libres);
      const input = lab.querySelector('input');
      const motivo = lab.querySelector('.opcion__motivo');
      let razon = '';
      if (!state.abierta) razon = ' ';
      else if (libres === 0 && guardado[t] !== id) razon = 'Sin lugares';
      else if (t === 'w1' && elegido('w2') === id) razon = 'Ya lo elegiste para el Workshop 2';
      else if (t === 'w2' && elegido('w1') === id) razon = 'Ya lo elegiste para el Workshop 1';
      input.disabled = !!razon;
      if (razon && input.checked && razon !== ' ') input.checked = false;
      lab.classList.toggle('opcion--off', !!razon && !input.checked);
      motivo.textContent = razon.trim();
      motivo.hidden = !razon.trim() || razon === 'Sin lugares';
    });
  }

  $('#form-elegir').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error('#elegir-error', '');
    const body = { action: 'inscribir', dni: state.dni };
    for (const t of TURNOS) {
      if (!state.turnos[t.key]) continue;
      const v = ($(`input[name="${t.key}"]:checked`) || {}).value;
      if (!v) {
        error('#elegir-error', `Te falta elegir el bloque de las ${t.hora} (${t.titulo}).`);
        $(`#bloque-${t.key}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      body[t.key] = v;
    }
    if (body.w1 && body.w1 === body.w2) return error('#elegir-error', 'No podés elegir el mismo workshop en los dos turnos.');

    if (state.preview) return mostrarListo(body);

    $('#btn-guardar').disabled = true;
    setLoading(true, 'Guardando tu lugar…');
    const data = await llamar('POST', null, body);
    setLoading(false);
    $('#btn-guardar').disabled = false;

    if (data.actividades) state.actividades = data.actividades;
    if (!data.ok) {
      if (data.code === 'SIN_CUPO') {
        state.borrador = Object.assign({}, body);
        (data.llenos || []).forEach((k) => { state.borrador[k] = ''; });
        renderElegir();
        error('#elegir-error', data.msg);
        const primero = (data.llenos || [])[0];
        if (primero) $(`#bloque-${primero}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      return error('#elegir-error', data.msg);
    }
    state.inscripcion = data.inscripcion;
    mostrarListo(data.inscripcion);
  });

  function mostrarListo(eleccion) {
    const porId = Object.fromEntries(state.actividades.map((a) => [a.id, a]));
    const items = TURNOS.map((t) => {
      if (state.turnos[t.key] && eleccion[t.key]) {
        const a = porId[eleccion[t.key]] || {};
        return `<li><span class="bloque__hora ${t.cls}">${t.hora}</span><span><span class="t">${esc(a.titulo)}</span><br><small>${esc(a.aCargo)}</small></span></li>`;
      }
      if (t.key === 'inst' && state.persona.tipo === 'Nofim') {
        return `<li><span class="bloque__hora">${t.hora}</span><span class="t">Espacio Nofim</span></li>`;
      }
      return '';
    }).join('');
    $('#resumen').innerHTML = items || '<li>No tenés que anotarte a ningún bloque. ¡Nos vemos en el seminario!</li>';
    show(state.preview ? ['#admin-bar', '#paso-listo'] : '#paso-listo');
  }

  /* ------------------------------------------------------------ */
  /*  Admin                                                       */
  /* ------------------------------------------------------------ */
  function abrirAdmin() {
    state.preview = true;
    setTab(state.tab || 'vista');
  }

  function prepararPreview() {
    const tipo = state.previewTipo;
    state.dni = '';
    state.persona = { nombre: 'Así te ve un/a ' + (tipo === 'Coordinador' ? 'coordinador/a' : tipo === 'Nofim' ? 'madrij de Nofim' : 'madrij'), comunidad: 'Vista previa', tipo };
    state.turnos = habilitados(tipo);
    state.inscripcion = null;
    renderElegir();
  }

  function setTab(tab) {
    state.tab = tab;
    $$('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    $('#vista-como').hidden = tab !== 'vista';
    if (tab === 'vista') { prepararPreview(); show(['#admin-bar', '#paso-elegir']); }
    else { renderPanel(); show(['#admin-bar', '#panel']); }
  }

  $$('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $$('.seg button').forEach((b) => b.addEventListener('click', () => {
    $$('.seg button').forEach((x) => x.classList.toggle('is-on', x === b));
    state.previewTipo = b.dataset.tipo;
    prepararPreview();
    show(['#admin-bar', '#paso-elegir']);
  }));

  $('#btn-refrescar').addEventListener('click', async () => {
    setLoading(true, 'Actualizando…');
    const data = await llamar('GET', { action: 'panel', clave: state.adminClave });
    setLoading(false);
    if (data.ok) { state.admin = data; state.actividades = data.actividades; state.abierta = data.abierta; renderPanel(); }
  });

  function barra(n, total, libresCls) {
    const pct = total ? Math.min(100, Math.round((n / total) * 100)) : 0;
    return `<div class="barra__track"><div class="barra__fill ${libresCls || ''}" style="width:${pct}%"></div></div>`;
  }

  function renderPanel() {
    const d = state.admin.panel;
    const pct = d.totalParticipantes ? Math.round((d.totalInscriptos / d.totalParticipantes) * 100) : 0;
    const tipos = Object.fromEntries(d.porTipo.map((t) => [t.tipo, t]));
    const kp = (v, l, accent) => `<div class="kpi ${accent ? 'kpi--accent' : ''}"><div class="kpi__v">${v}</div><div class="kpi__l">${l}</div></div>`;
    $('#kpis').innerHTML =
      kp(`${d.totalInscriptos}/${d.totalParticipantes}`, `Inscriptos (${pct}%)`, true) +
      kp(d.totalParticipantes - d.totalInscriptos, 'Faltan inscribirse') +
      ['Madrij', 'Nofim', 'Coordinador', 'Director', 'Staff']
        .filter((t) => tipos[t] && t !== 'Staff')
        .map((t) => kp(`${tipos[t].inscriptos}/${tipos[t].total}`, t === 'Madrij' ? 'Madrijim' : t === 'Coordinador' ? 'Coordinadores' : t === 'Director' ? 'Directores' : t))
        .join('');

    $('#panel-hora').textContent = (state.abierta ? 'Inscripción abierta' : 'Inscripción CERRADA') + ' · actualizado ' + new Date(d.generado).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

    $('#panel-cupos').innerHTML = TURNOS.map((t) => {
      const filas = state.actividades.filter((a) => a.bloque === t.bloque).map((a) => {
        const usados = a.cupo - a.libres[t.key];
        const cls = a.libres[t.key] === 0 ? 'barra__fill--lleno' : a.libres[t.key] <= 5 ? 'barra__fill--poco' : '';
        return `<div class="barra"><span>${esc(a.aCargo)} · ${esc(a.titulo)}</span><span class="barra__n">${usados}/${a.cupo}</span>${barra(usados, a.cupo, cls)}</div>`;
      }).join('');
      return `<div class="cupo-grupo"><h4>${t.hora} · ${esc(t.titulo)}</h4>${filas}</div>`;
    }).join('');

    $('#panel-com').innerHTML = d.comunidades.map((c) => `
      <details class="com">
        <summary><span>${esc(c.comunidad)}</span><span class="barra__n">${c.inscriptos}/${c.total}</span>${barra(c.inscriptos, c.total)}</summary>
        ${c.pendientes.length ? `<ul>${c.pendientes.map((p) => `<li>${esc(p.nombre)} ${p.tipo !== 'Madrij' ? `<span class="tag">${esc(p.tipo)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="hint">¡Están todos inscriptos!</p>'}
      </details>`).join('');

    $('#panel-ultimas').innerHTML = d.ultimas.length ? d.ultimas.map((u) => `
      <div class="ult"><b>${esc(u.nombre)}</b> · ${esc(u.comunidad)}
        <small>${new Date(u.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${[u.inst, u.w1, u.w2].filter(Boolean).map(esc).join(' / ')}</small></div>`).join('')
      : '<p class="hint">Todavía no hay inscripciones.</p>';
  }

  /* ------------------------------------------------------------ */
  /*  Modo demo (sin backend)                                     */
  /* ------------------------------------------------------------ */
  function demoApi(method, params, body) {
    const db = demoApi.db || (demoApi.db = crearDemo());
    const conCupo = () => db.acts.map((a) => {
      const libres = {};
      TURNOS.forEach((t) => { if (t.bloque === a.bloque) libres[t.key] = Math.max(0, a.cupo - (db.usados[t.key + a.id] || 0)); });
      return Object.assign({}, a, { libres });
    });
    return sleep(400).then(() => {
      if (method === 'GET') {
        const k = String(params.dni || params.clave || '').toLowerCase();
        if (k === 'admin') {
          return { ok: true, admin: true, abierta: true, actividades: conCupo(), panel: {
            generado: new Date().toISOString(), totalParticipantes: 228, totalInscriptos: 97,
            porTipo: [{ tipo: 'Madrij', total: 161, inscriptos: 70 }, { tipo: 'Nofim', total: 27, inscriptos: 12 }, { tipo: 'Coordinador', total: 23, inscriptos: 10 }, { tipo: 'Director', total: 10, inscriptos: 5 }],
            comunidades: [{ comunidad: 'Comunidad A', total: 40, inscriptos: 38, pendientes: [{ nombre: 'Persona de prueba', tipo: 'Madrij' }, { nombre: 'Otra persona', tipo: 'Coordinador' }] }, { comunidad: 'Comunidad B', total: 30, inscriptos: 30, pendientes: [] }],
            ultimas: [{ fecha: new Date().toISOString(), nombre: 'Persona de prueba', comunidad: 'Comunidad A', inst: 'Dilemas de la sociedad israelí', w1: 'Incubadora de madrijim con impacto', w2: 'S.O.S.: ¡ya no tengo ideas para mis peulot!' }],
          } };
        }
        const p = db.personas[params.dni];
        if (!p) return { ok: false, code: 'NO_ENCONTRADO', msg: 'No encontramos ese DNI en la lista de inscriptos al seminario. Revisá que esté bien escrito o hablá con tu director/a.' };
        return { ok: true, abierta: true, persona: p, turnos: habilitados(p.tipo), inscripcion: db.ins[params.dni] || null, actividades: conCupo() };
      }
      const prev = db.ins[body.dni] || {};
      TURNOS.forEach((t) => { if (prev[t.key]) db.usados[t.key + prev[t.key]]--; });
      const elec = { inst: body.inst || '', w1: body.w1 || '', w2: body.w2 || '' };
      TURNOS.forEach((t) => { if (elec[t.key]) db.usados[t.key + elec[t.key]] = (db.usados[t.key + elec[t.key]] || 0) + 1; });
      db.ins[body.dni] = elec;
      return { ok: true, inscripcion: elec, actividades: conCupo() };
    });
  }

  function crearDemo() {
    const A = (id, bloque, titulo, aCargo, descripcion) => ({ id, bloque, titulo, aCargo, descripcion, cupo: 30 });
    return {
      personas: {
        11111111: { nombre: 'Madrij', comunidad: 'Comunidad de prueba', tipo: 'Madrij' },
        22222222: { nombre: 'Nofim', comunidad: 'Comunidad de prueba', tipo: 'Nofim' },
        33333333: { nombre: 'Coordi', comunidad: 'Comunidad de prueba', tipo: 'Coordinador' },
      },
      ins: {},
      usados: { 'instINST-KKL': 27, 'instINST-TAGLIT': 30, 'w1HAD-SALUD': 30, 'w2HAD-SOS': 26 },
      acts: [
        A('INST-TAGLIT', 'INST', 'El detrás de escena de un proyecto exitoso', 'Taglit', ''),
        A('INST-KKL', 'INST', '¿Cómo acercar Israel? Recursos y propuestas del KKL', 'KKL', ''),
        A('INST-SOJNUT', 'INST', 'Israel: más que un destino, una oportunidad', 'Sojnut', ''),
        A('INST-AMIA', 'INST', 'Conociendo más sobre la comunidad judía argentina: de inmigrantes judíos a madrijim', 'AMIA', ''),
        A('INST-AHORA', 'INST', '¿Y ahora qué? Entre desafíos, preguntas y nuevas formas de hacer hadrajá', 'Joint, AMIA, KKL y Bama', 'A cargo de Melo y Juli Lekerman.'),
        A('INST-OSM', 'INST', 'Dilemas de la sociedad israelí', 'OSM', ''),
        A('INST-NOAM', 'INST', 'Más que un movimiento: una identidad que nos une', 'Noam Olami', 'Con Shoshi.'),
        A('HAD-INCUBADORA', 'HAD', 'Incubadora de madrijim con impacto', 'Sol Goyhman', 'Networking, cómo crear proyectos con impacto y qué necesita un madrij para generar un cambio real en su comunidad.'),
        A('HAD-SOS', 'HAD', 'S.O.S.: ¡ya no tengo ideas para mis peulot!', 'Martín Hamui', 'Cambiemos la perspectiva: ¿cómo sumo judaísmo a mis peulot? Estrategias para conectar el judaísmo con las necesidades de mi grupo.'),
        A('HAD-SALUD', 'HAD', 'Manual de supervivencia: salud mental en majané', 'Simón Dimerman', 'Un espacio de psicología y descarga, con herramientas concretas para cuidar la salud mental en majané.'),
        A('HAD-CONFLICTOS', 'HAD', 'Desactivemos el quilombo: resolución creativa de conflictos', 'Paula Vinocur', 'Cómo resolver conflictos sin volvernos locos: nuevas miradas y herramientas para no frustrarnos cada vez.'),
        A('HAD-INNOVACION', 'HAD', '¿Quién dijo que se hace así? Laboratorio de innovación para la hadrajá', 'Mai Ganon', 'Cómo innovar en nuestras peulot y propuestas de cada semana. Lo que siempre hicimos de una manera también puede hacerse de otra.'),
        A('HAD-STORYTELLING', 'HAD', '¿Cómo vendo mis propuestas? Storytelling y oratoria para la hadrajá', 'Bianca Soifer', 'Bianca es creadora de contenido digital y nos va a ayudar a encontrar nuevas formas de comunicar las propuestas de nuestra comunidad. También vamos a trabajar oratoria para soltarnos más en la peulá y en los mifkadim.'),
      ],
    };
  }

  if (DEMO) $('#demo-hint').hidden = false;
})();
