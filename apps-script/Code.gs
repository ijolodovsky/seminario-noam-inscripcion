/**
 * Backend del formulario de feedback · Seminario NOAM
 *
 * Va pegado en el Apps Script de la planilla "Inscripcion Workshops Noam 2026"
 * (Extensiones → Apps Script), en un archivo nuevo (ej. "Feedback.gs").
 * Todo vive dentro de `Feedback` para no chocar con el código de la inscripción.
 * Lo único global son doGet, doPost y configurarFeedback: en el archivo viejo hay que
 * renombrar (o borrar) su doGet y su doPost, porque solo puede haber uno de cada uno. Usa las hojas que ya existen:
 *   - Participantes  (DNI, Nombre, Comunidad, Rol, Tipo)
 *   - Inscripciones  (DNI, ID inst, ID w1, ID w2)  → para precargar en qué capacitación estuvo cada uno
 *   - Actividades    (ID, Bloque, Título, A cargo de)
 *   - Config         (columna A = nombre, columna B = valor)
 * y crea la hoja "Feedback", donde queda una fila por persona (si vuelve a responder, se pisa su fila).
 *
 * Primera vez: elegí la función `configurarFeedback` arriba y tocá "Ejecutar".
 * Crea la hoja Feedback y agrega en Config las filas "Feedback abierto" y "Clave admin".
 * Cambiá la clave en Config antes de publicar.
 */

function doGet(e) { return Feedback.doGet(e); }
function doPost(e) { return Feedback.doPost(e); }
function configurarFeedback() { Feedback.configurar(); }

const Feedback = (() => {
  const HOJA_FEEDBACK = 'Feedback';

  // Columnas de la hoja Feedback, en orden. key = campo que manda la web.
  const CAMPOS = [
    ['comida_especial', 'Condición especial de comida'],
    ['comida_cual', 'Cuál'],
    ['comida_p', 'Comida (1-5)'],
    ['comida_c', 'Comida · comentario'],
    ['logistica_p', 'Logística (1-5)'],
    ['logistica_c', 'Logística · comentario'],
    ['peula_p', 'Peulá (1-5)'],
    ['peula_c', 'Peulá · comentario'],
    ['fogon_p', 'Fogón (1-5)'],
    ['fogon_c', 'Fogón · comentario'],
    ['pianobar_p', 'Piano bar (1-5)'],
    ['pianobar_c', 'Piano bar · comentario'],
    ['shajarit_p', 'Shajarit (1-5)'],
    ['shajarit_c', 'Shajarit · comentario'],
    ['inst_id', 'Turno 10:30 (Instituciones / Espacio Nofim)'],
    ['inst_p', 'Turno 10:30 (1-5)'],
    ['inst_c', 'Turno 10:30 · comentario'],
    ['w1_id', 'Turno 12:30 (Workshop 1 / Espacio con Shoshi)'],
    ['w1_p', 'Turno 12:30 (1-5)'],
    ['w1_c', 'Turno 12:30 · comentario'],
    ['w2_id', 'Turno 14:45 (Workshop 2 / Tamu y Toto)'],
    ['w2_p', 'Turno 14:45 (1-5)'],
    ['w2_c', 'Turno 14:45 · comentario'],
    ['deporte_p', 'Momento deportivo (1-5)'],
    ['deporte_c', 'Momento deportivo · comentario'],
    ['cierre_p', 'Cierre (1-5)'],
    ['cierre_c', 'Cierre · comentario'],
    ['interaccion', 'Interactuó con otras comunidades'],
    ['interaccion_c', 'Interacción · comentario'],
    ['llevas', 'Qué se lleva'],
    ['repetir', '¿Que se repita?'],
    ['extra', 'Algo más'],
  ];
  // Actividades fijas (no se elegían): Nofim a las 10:30, coordis y dires a las 12:30 y 14:45.
  const FIJAS = { NOFIM: 'Espacio Nofim', SHOSHI: 'Espacio con Shoshi', TAMUTOTO: 'Capacitación Tamu y Toto' };

  const CABECERA = ['Fecha', 'DNI', 'Nombre', 'Comunidad', 'Rol', 'Tipo']
    .concat(CAMPOS.map((c) => c[1]))
    .concat(['_json']);

  /* ------------------------------------------------------------------ */
  /*  Entrada                                                            */
  /* ------------------------------------------------------------------ */
  function doGet_(e) {
    const p = (e && e.parameter) || {};
    try {
      if (p.action === 'lookup') return json(lookup(p.dni));
      if (p.action === 'panel') return json(esAdmin(p.clave) ? Object.assign({ ok: true }, datosPanel()) : noAutorizado());
      return json({ ok: false, code: 'ACCION', msg: 'Acción desconocida.' });
    } catch (err) {
      console.error(err);
      return json({ ok: false, code: 'ERROR', msg: 'Hubo un error. Probá de nuevo en un rato.' });
    }
  }

  function doPost_(e) {
    let body = {};
    try { body = JSON.parse(e.postData.contents); } catch (_) { return json({ ok: false, code: 'BODY', msg: 'Pedido inválido.' }); }
    try {
      if (body.action === 'feedback') return json(guardar(body));
      return json({ ok: false, code: 'ACCION', msg: 'Acción desconocida.' });
    } catch (err) {
      console.error(err);
      return json({ ok: false, code: 'ERROR', msg: 'Hubo un error guardando. Probá de nuevo.' });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Acciones                                                           */
  /* ------------------------------------------------------------------ */
  function lookup(raw) {
    const clave = String(raw || '').trim();
    if (esAdmin(clave)) return Object.assign({ ok: true, admin: true, abierto: abierto(), actividades: actividades() }, datosPanel());

    const dni = limpiarDni(clave);
    const persona = participantes()[dni];
    if (!persona) {
      return { ok: false, code: 'NO_ENCONTRADO', msg: 'No encontramos ese DNI en la lista de participantes del seminario. Revisá que esté bien escrito o hablá con tu director/a.' };
    }
    return {
      ok: true,
      abierto: abierto(),
      persona: persona,
      inscripcion: inscripciones()[dni] || null,
      respuesta: respuestas()[dni] || null,
      actividades: actividades(),
    };
  }

  function guardar(body) {
    if (!abierto()) return { ok: false, code: 'CERRADO', msg: 'El formulario de feedback ya está cerrado. ¡Gracias igual!' };
    const dni = limpiarDni(body.dni);
    const persona = participantes()[dni];
    if (!persona) return { ok: false, code: 'NO_ENCONTRADO', msg: 'No encontramos ese DNI en la lista de participantes.' };

    const r = {};
    CAMPOS.forEach((c) => { r[c[0]] = recortar(body.r && body.r[c[0]]); });

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return { ok: false, code: 'OCUPADO', msg: 'Hay mucha gente respondiendo, probá de nuevo.' };
    try {
      const sh = hojaFeedback();
      const nombresAct = Object.assign(Object.fromEntries(actividades().map((a) => [a.id, a.titulo])), FIJAS);
      const visible = (k, v) => {
        if (/_id$/.test(k)) return v === 'ninguna' ? 'No fue' : (nombresAct[v] || v);
        if (/_p$/.test(k)) return v === 'no' ? 'No estuve' : (v ? Number(v) : '');
        return v;
      };
      const fila = [new Date(), dni, persona.nombre, persona.comunidad, persona.rol, persona.tipo]
        .concat(CAMPOS.map((c) => visible(c[0], r[c[0]])))
        .concat([JSON.stringify(r)]);

      const dnis = sh.getLastRow() > 1 ? sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues().map((x) => limpiarDni(x[0])) : [];
      const i = dnis.indexOf(dni);
      if (i >= 0) sh.getRange(i + 2, 1, 1, fila.length).setValues([fila]);
      else sh.appendRow(fila);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    return { ok: true, respuesta: r };
  }

  function datosPanel() {
    const ps = participantes();
    const rs = respuestas();
    const respuestasArr = Object.keys(rs).map((dni) => Object.assign({ persona: ps[dni] || { nombre: '?', comunidad: '?', tipo: '' } }, rs[dni]));
    const porCom = {};
    Object.keys(ps).forEach((dni) => {
      const p = ps[dni];
      const c = porCom[p.comunidad] || (porCom[p.comunidad] = { comunidad: p.comunidad, total: 0, respondieron: 0, pendientes: [] });
      c.total++;
      if (rs[dni]) c.respondieron++;
      else c.pendientes.push({ nombre: p.nombre, tipo: p.tipo });
    });
    return {
      panel: {
        generado: new Date().toISOString(),
        totalParticipantes: Object.keys(ps).length,
        respuestas: respuestasArr,
        comunidades: Object.keys(porCom).sort().map((k) => porCom[k]),
      },
      actividades: actividades(),
      abierto: abierto(),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Lectura de hojas                                                   */
  /* ------------------------------------------------------------------ */
  function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

  function filas(nombreHoja) {
    const sh = ss().getSheetByName(nombreHoja);
    if (!sh || sh.getLastRow() < 2) return [];
    const vals = sh.getDataRange().getValues();
    const head = vals[0].map((h) => String(h).trim());
    return vals.slice(1).map((row) => Object.fromEntries(head.map((h, i) => [h, row[i]])));
  }

  function participantes() {
    const out = {};
    filas('Participantes').forEach((f) => {
      const dni = limpiarDni(f['DNI']);
      if (!dni) return;
      out[dni] = {
        nombre: String(f['Nombre'] || '').trim(),
        comunidad: String(f['Comunidad'] || '').trim(),
        rol: String(f['Rol'] || '').trim(),
        tipo: String(f['Tipo'] || '').trim(),
      };
    });
    return out;
  }

  function inscripciones() {
    const out = {};
    filas('Inscripciones').forEach((f) => {
      const dni = limpiarDni(f['DNI']);
      if (dni) out[dni] = { inst: String(f['ID inst'] || ''), w1: String(f['ID w1'] || ''), w2: String(f['ID w2'] || '') };
    });
    return out;
  }

  function actividades() {
    return filas('Actividades').filter((f) => f['ID']).map((f) => ({
      id: String(f['ID']).trim(),
      bloque: String(f['Bloque']).trim(),
      titulo: String(f['Título'] || '').trim(),
      aCargo: String(f['A cargo de'] || '').trim(),
    }));
  }

  function respuestas() {
    const sh = ss().getSheetByName(HOJA_FEEDBACK);
    const out = {};
    if (!sh || sh.getLastRow() < 2) return out;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, CABECERA.length).getValues();
    vals.forEach((row) => {
      const dni = limpiarDni(row[1]);
      if (!dni) return;
      try { out[dni] = Object.assign(JSON.parse(row[CABECERA.length - 1] || '{}'), { fecha: row[0] }); } catch (_) {}
    });
    return out;
  }

  function config() {
    const sh = ss().getSheetByName('Config');
    const out = {};
    if (!sh) return out;
    sh.getDataRange().getValues().forEach((r) => { if (r[0]) out[String(r[0]).trim().toLowerCase()] = r[1]; });
    return out;
  }
  function abierto() {
    const v = config()['feedback abierto'];
    return v === undefined || v === '' ? true : v === true || String(v).toUpperCase() === 'TRUE';
  }
  function esAdmin(clave) {
    const c = String(config()['clave admin'] || '').trim();
    return !!c && c !== 'CAMBIAME' && String(clave || '').trim() === c;
  }

  /* ------------------------------------------------------------------ */
  /*  Setup                                                              */
  /* ------------------------------------------------------------------ */
  function hojaFeedback() {
    let sh = ss().getSheetByName(HOJA_FEEDBACK);
    if (!sh) {
      sh = ss().insertSheet(HOJA_FEEDBACK);
      sh.getRange(1, 1, 1, CABECERA.length).setValues([CABECERA]).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.getRange('B:B').setNumberFormat('@');
      sh.hideColumns(CABECERA.length);
    }
    return sh;
  }

  function configurar_() {
    hojaFeedback();
    const sh = ss().getSheetByName('Config') || ss().insertSheet('Config');
    const c = config();
    if (!('feedback abierto' in c)) {
      sh.appendRow(['Feedback abierto', true]);
      sh.getRange(sh.getLastRow(), 2).insertCheckboxes().check();
    }
    if (!('clave admin' in c)) sh.appendRow(['Clave admin', 'CAMBIAME']);
  }

  /* ------------------------------------------------------------------ */
  /*  Utilidades                                                         */
  /* ------------------------------------------------------------------ */
  function limpiarDni(v) { return String(v == null ? '' : v).replace(/[^\d]/g, ''); }
  function recortar(v) { return String(v == null ? '' : v).slice(0, 3000); }
  function noAutorizado() { return { ok: false, code: 'NO_AUTORIZADO', msg: 'Clave incorrecta.' }; }
  function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

  return { doGet: doGet_, doPost: doPost_, configurar: configurar_ };
})();
