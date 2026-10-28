/* Checklist Fase 1 · Centinela — Luma Legal
   Contenido, respuestas y archivos viven en Supabase y solo los ven los correos autorizados. */
(function () {
  var CFG = window.CENTINELA_CONFIG || {};
  var $ = function (x) { return document.getElementById(x); };
  var sb = window.supabase.createClient(CFG.url, CFG.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });

  var Q = [], state = {}, me = null, ask = '', timers = {}, chains = {}, list = $('list'), order = [], built = false;
  var CACHE = 'centinela-fase1-cache';

  function id(i) { return 'q' + String(i + 1).padStart(2, '0'); }
  function st(k) { return (state[k] && state[k].estado) || 'pendiente'; }
  function txt(k) { return (state[k] && state[k].texto) || ''; }
  function files(k) { return (state[k] && state[k].archivos) || []; }
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function syncMsg(t, cls) { $('sync').textContent = t; $('sync').className = 'sync' + (cls ? ' ' + cls : ''); }
  function show(view) { ['v-login', 'v-sent', 'v-denied', 'v-app', 'v-loading'].forEach(function (v) { $(v).hidden = v !== view; }); }
  function cacheKey() { return CACHE + ':' + (me || ''); }
  function saveCache() { try { localStorage.setItem(cacheKey(), JSON.stringify(state)); } catch (e) {} }
  function loadCache() { try { return JSON.parse(localStorage.getItem(cacheKey()) || '{}') || {}; } catch (e) { return {}; } }

  /* ---------- acceso ---------- */
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('email').value.trim().toLowerCase(), btn = $('login-btn'), err = $('login-err');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'Revisa el correo: parece incompleto.'; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Enviando…';
    sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
      btn.disabled = false; btn.textContent = 'Enviarme el enlace';
      if (r.error) {
        err.textContent = /rate|seconds/i.test(r.error.message) ? 'Ya te enviamos un enlace hace poco. Espera un minuto y vuelve a intentarlo.' : 'No pudimos enviar el enlace. Inténtalo de nuevo en un momento.';
        err.hidden = false; return;
      }
      $('sent-to').textContent = email; show('v-sent');
    });
  });
  $('again').addEventListener('click', function () { show('v-login'); });
  document.querySelectorAll('[data-logout]').forEach(function (b) {
    b.addEventListener('click', function () { sb.auth.signOut().then(function () { location.replace(location.pathname); }); });
  });

  sb.auth.onAuthStateChange(function (ev, session) {
    if (session && session.user) { if (me !== session.user.email) start(session.user.email); }
    else if (ev === 'SIGNED_OUT' || ev === 'INITIAL_SESSION') { me = null; show('v-login'); }
  });

  function start(email) {
    me = email.toLowerCase(); show('v-loading');
    $('who').textContent = me;
    sb.from('contenido').select('data').eq('id', 'fase1').maybeSingle().then(function (r) {
      if (r.error || !r.data) { $('denied-email').textContent = me; show('v-denied'); return; }
      Q = r.data.data.preguntas || [];
      if (!built) { build(r.data.data); built = true; }
      state = loadCache(); paint(); show('v-app');
      if (location.hash && $(location.hash.slice(1))) $(location.hash.slice(1)).scrollIntoView();
      return sb.from('respuestas').select('*').then(function (res) {
        if (res.error) { syncMsg('⚠️ No pudimos traer las respuestas. Recarga la página.', 'err'); return; }
        res.data.forEach(merge); saveCache(); paint();
        syncMsg('☁️ Guardado en la nube', 'on');
        live();
      });
    });
  }

  function merge(row) {
    var mine = state[row.id];
    if (mine && mine.pendiente) return; // hay una edición propia aún sin subir
    state[row.id] = {
      texto: row.texto || '', estado: row.estado || 'pendiente',
      archivos: Array.isArray(row.archivos) ? row.archivos.filter(function (f) { return f && typeof f.nombre === 'string' && typeof f.ruta === 'string'; }) : [],
      actualizado: row.actualizado || '', por: row.actualizado_por || ''
    };
  }

  function live() {
    sb.channel('respuestas').on('postgres_changes', { event: '*', schema: 'public', table: 'respuestas' }, function (p) {
      if (p.new && p.new.id) { merge(p.new); saveCache(); paint(); }
    }).subscribe();
  }

  /* ---------- construir la página desde Supabase ---------- */
  function build(data) {
    var groups = {};
    Q.forEach(function (q, i) {
      var g = q.grupo;
      if (!groups[g]) {
        var sec = document.createElement('section'); sec.className = 'group';
        var h = document.createElement('div'); h.className = 'group-head';
        var h2 = document.createElement('h2'); h2.textContent = g;
        var c = document.createElement('span'); c.dataset.g = g;
        h.appendChild(h2); h.appendChild(c); sec.appendChild(h); list.appendChild(sec);
        groups[g] = sec; order.push(g);
        if (g === 'Cap table' && data.propuesta) sec.appendChild(proposal(data.propuesta));
      }
      var k = id(i);
      var art = document.createElement('article'); art.className = 'q'; art.id = k;
      art.innerHTML = '<div class="q-top"><span class="num"></span><div class="q-text"><span class="kind"></span><h3></h3><p></p></div></div>' +
        '<label class="sr" for="t-' + k + '"></label><textarea id="t-' + k + '"></textarea>' +
        '<div class="files"><div class="files-row"><label class="up"><span>📎 Adjuntar archivo</span><input type="file" multiple id="f-' + k + '"></label></div><ul class="flist"></ul><span class="fmsg" hidden></span></div>' +
        '<div class="q-foot"><div class="status" role="group" aria-label="Estado"><button type="button" data-v="pendiente">Pendiente</button><button type="button" data-v="parcial">A medias</button><button type="button" data-v="respondida">Listo ✓</button></div><span class="saved"></span></div>';
      art.querySelector('.num').textContent = i + 1;
      var kind = art.querySelector('.kind'); kind.textContent = q.tipo === 'doc' ? 'Documento' : 'Pregunta'; if (q.tipo === 'doc') kind.className = 'kind doc';
      art.querySelector('h3').textContent = q.titulo;
      art.querySelector('p').textContent = q.detalle;
      art.querySelector('label.sr').textContent = 'Respuesta a: ' + q.titulo;
      art.querySelector('textarea').placeholder = q.placeholder || 'Escribe aquí tu respuesta';
      groups[g].appendChild(art);
    });
    $('total').textContent = Q.length;
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function proposal(p) {
    var box = el('div', 'prop');
    box.appendChild(el('span', 'badge', 'Lo que proponemos en Luma 💜'));
    box.appendChild(el('h3', null, p.titulo));
    box.appendChild(el('p', null, p.intro));
    var wrap = el('div', 'tbl'), t = document.createElement('table'), hr = el('tr', 'h');
    p.columnas.forEach(function (c) { hr.appendChild(el('th', null, c)); }); t.appendChild(hr);
    p.filas.forEach(function (f) {
      var tr = document.createElement('tr');
      f.forEach(function (v, i) { var td = el('td', i > 0 && i < 4 ? 'n' : null, v); td.setAttribute('data-label', p.columnas[i] || ''); tr.appendChild(td); });
      t.appendChild(tr);
    });
    wrap.appendChild(t); box.appendChild(wrap);
    var ul = document.createElement('ul');
    p.notas.forEach(function (n) { var li = document.createElement('li'); li.appendChild(el('b', null, n[0])); li.appendChild(document.createTextNode(' ' + n[1])); ul.appendChild(li); });
    box.appendChild(ul);
    box.appendChild(el('p', null, p.cierre));
    return box;
  }

  /* ---------- pintar ---------- */
  function paint() {
    var done = 0, part = 0;
    Q.forEach(function (q, i) {
      var k = id(i), s = st(k), art = $(k);
      art.className = 'q st-' + s;
      art.querySelectorAll('.status button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === s)); });
      var ta = art.querySelector('textarea');
      if (document.activeElement !== ta && ta.value !== txt(k)) ta.value = txt(k);
      var ul = art.querySelector('.flist'), fs = files(k);
      var sig = JSON.stringify(fs) + '|' + (ask.indexOf(k + ':') === 0 ? ask : '');
      if (ul.dataset.sig !== sig) {
        ul.dataset.sig = sig; ul.textContent = '';
        fs.forEach(function (f, fi) {
          var li = document.createElement('li');
          var a = el('a', null, '📄 ' + f.nombre); a.href = '#'; a.dataset.k = k; a.dataset.i = fi; li.appendChild(a);
          if (f.size) li.appendChild(el('small', null, size(f.size)));
          if (ask === k + ':' + fi) {
            var qq = el('span', 'ask', '¿Quitar?');
            var y = el('button', 'yes', 'Sí, quitar'); y.type = 'button'; y.dataset.act = 'del'; y.dataset.k = k; y.dataset.i = fi;
            var n = el('button', null, 'No'); n.type = 'button'; n.dataset.act = 'keep';
            qq.appendChild(y); qq.appendChild(n); li.appendChild(qq);
          } else {
            var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Quitar ' + f.nombre); x.dataset.k = k; x.dataset.i = fi; li.appendChild(x);
          }
          ul.appendChild(li);
        });
      }
      var sv = art.querySelector('.saved'), u = state[k] && state[k].actualizado, por = state[k] && state[k].por;
      sv.textContent = u ? 'Guardado ' + new Date(u).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + (por && por !== me ? ' · ' + por.split('@')[0] : '') : '';
      if (s === 'respondida') done++; else if (s === 'parcial') part++;
    });
    order.forEach(function (g) {
      var n = 0, t = 0; Q.forEach(function (q, i) { if (q.grupo === g) { t++; if (st(id(i)) === 'respondida') n++; } });
      document.querySelector('[data-g="' + g + '"]').textContent = n + ' de ' + t;
    });
    var T = Q.length || 1;
    $('m-done').style.width = (done / T * 100) + '%'; $('m-part').style.width = (part / T * 100) + '%';
    $('count').textContent = done + ' de ' + Q.length + ' listas' + (part ? ' · ' + part + ' a medias' : '');
    $('meter').setAttribute('aria-label', done + ' de ' + Q.length + ' listas');
  }

  /* ---------- guardar ---------- */
  function push(k) {
    saveCache(); paint();
    clearTimeout(timers[k]);
    syncMsg('Guardando…');
    timers[k] = setTimeout(function () {
      var cur = state[k];
      var row = { id: k, texto: cur.texto, estado: cur.estado, archivos: cur.archivos };
      chains[k] = (chains[k] || Promise.resolve()).then(function () {
        return sb.from('respuestas').upsert(row).select().single();
      }).then(function (r) {
        if (r.error) throw r.error;
        if (state[k] === cur) { delete cur.pendiente; state[k].actualizado = r.data.actualizado; state[k].por = r.data.actualizado_por; saveCache(); paint(); }
        syncMsg('☁️ Guardado en la nube', 'on');
      }).catch(function () {
        syncMsg('⚠️ No se pudo guardar en línea. Quedó en este equipo; revisa tu conexión y edita de nuevo.', 'err');
      });
    }, 700);
  }
  function setField(k, patch) {
    var cur = state[k] || {};
    state[k] = {
      texto: patch.texto !== undefined ? patch.texto : (cur.texto || ''),
      estado: patch.estado || cur.estado || 'pendiente',
      archivos: patch.archivos || cur.archivos || [],
      actualizado: new Date().toISOString(), por: me, pendiente: true
    };
    push(k);
  }

  list.addEventListener('input', function (e) {
    if (e.target.tagName !== 'TEXTAREA') return;
    var k = e.target.id.slice(2), patch = { texto: e.target.value };
    if (st(k) === 'pendiente' && e.target.value.trim()) patch.estado = 'parcial';
    setField(k, patch);
  });

  /* ---------- archivos ---------- */
  var MAX = 50 * 1024 * 1024;
  function safeName(n) { return n.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120) || 'archivo'; }
  list.addEventListener('change', function (e) {
    if (e.target.type !== 'file') return;
    var art = e.target.closest('.q'), k = art.id, msg = art.querySelector('.fmsg'), inp = e.target, lab = inp.closest('label').firstChild;
    var fl = [].slice.call(inp.files); if (!fl.length) return;
    msg.hidden = true; lab.textContent = 'Subiendo…';
    var notes = [], seq = Promise.resolve();
    fl.forEach(function (f) {
      seq = seq.then(function () {
        if (f.size > MAX) { notes.push(f.name + ' pesa ' + size(f.size) + ' y el límite es 50 MB: comprímelo o divídelo.'); return; }
        var ruta = k + '/' + Date.now().toString(36) + '-' + safeName(f.name);
        return sb.storage.from('archivos').upload(ruta, f, { contentType: f.type || 'application/octet-stream', upsert: false }).then(function (r) {
          if (r.error) { notes.push(f.name + ' no se pudo subir. Inténtalo de nuevo.'); return; }
          setField(k, { archivos: files(k).concat([{ nombre: f.name, size: f.size, ruta: ruta, por: me }]) });
        });
      });
    });
    seq.then(function () {
      lab.textContent = '📎 Adjuntar archivo'; inp.value = '';
      if (notes.length) { msg.textContent = notes.join(' '); msg.hidden = false; }
    });
  });

  list.addEventListener('click', function (e) {
    var a = e.target.closest('.flist a');
    if (a) {
      e.preventDefault();
      var f = files(a.dataset.k)[+a.dataset.i]; if (!f) return;
      var w = window.open('', '_blank');
      sb.storage.from('archivos').createSignedUrl(f.ruta, 120, { download: f.nombre }).then(function (r) {
        if (r.error) { if (w) w.close(); var m = a.closest('.q').querySelector('.fmsg'); m.textContent = 'No pudimos abrir ' + f.nombre + '. Recarga la página e inténtalo de nuevo.'; m.hidden = false; return; }
        if (w) w.location = r.data.signedUrl; else location.href = r.data.signedUrl;
      });
      return;
    }
    var x = e.target.closest('.flist .x');
    if (x) { ask = x.dataset.k + ':' + x.dataset.i; paint(); var y = list.querySelector('.flist .ask .yes'); if (y) y.focus(); return; }
    var act = e.target.closest('.flist .ask button');
    if (act) {
      if (act.dataset.act === 'del') {
        var k = act.dataset.k, fs = files(k).slice(), f2 = fs.splice(+act.dataset.i, 1)[0]; ask = '';
        if (f2) { setField(k, { archivos: fs }); sb.storage.from('archivos').remove([f2.ruta]); } else paint();
      } else { ask = ''; paint(); }
      return;
    }
    var b = e.target.closest('.status button'); if (!b) return;
    setField(b.closest('.q').id, { estado: b.dataset.v });
  });

  /* ---------- exportar ---------- */
  $('export').addEventListener('click', function () {
    var out = 'Centinela · Checklist Fase 1 (Luma)\nExportado ' + new Date().toLocaleString('es-CO') + '\n';
    Q.forEach(function (q, i) {
      var k = id(i), fs = files(k);
      out += '\n' + (i + 1) + '. ' + q.titulo + ' [' + st(k) + ']\n' + (txt(k).trim() || '—') + (fs.length ? '\nArchivos: ' + fs.map(function (f) { return f.nombre; }).join(', ') : '') + '\n';
    });
    var u = URL.createObjectURL(new Blob([out], { type: 'text/plain;charset=utf-8' })), l = document.createElement('a');
    l.href = u; l.download = 'centinela-fase1-respuestas.txt'; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  });
})();
