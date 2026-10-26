/* ============================================================================
   JETCONTROL 2026®™ — BACKUPS (criar / listar / restaurar / baixar / excluir)
   ============================================================================ */
(function () {
  'use strict';

  var MAX_BACKUPS = 10;          // Quantidade máxima de backups guardados
  var TAM_PARTE = 300000;        // Caracteres por documento Firestore
  var DB_NOME = 'jetcontrol_backups_db';
  var STORE = 'backups';
  var PREFIXO = 'jetcontrol_';
  var CHAVES_IGNORADAS = { 'jetcontrol_reset_aplicado_em': true };

  // Credenciais de reserva direta para contornar restrições de fetch local (file:///)
  var CONFIG_PADRAO = {
    projectId: 'jetcontrol-2026-desmonte',
    secret: 'jetcontrol-2026-desmonte2009'
  };

  // ----------------------------- IndexedDB ---------------------------------
  function abrirDb() {
    return new Promise(function (ok, erro) {
      if (!window.indexedDB) { erro(new Error('IndexedDB indisponível')); return; }
      var req = indexedDB.open(DB_NOME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = function () { ok(req.result); };
      req.onerror = function () { erro(req.error); };
    });
  }
  function idb(modo, fn) {
    return abrirDb().then(function (db) {
      return new Promise(function (ok, erro) {
        var tx = db.transaction(STORE, modo);
        var r = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { ok(r && r.result); };
        tx.onerror = function () { erro(tx.error); };
      });
    });
  }
  function idbTodos() { return idb('readonly', function (s) { return s.getAll(); }).then(function (r) { return r || []; }); }
  function idbObter(id) { return idb('readonly', function (s) { return s.get(id); }); }
  function idbGravar(rec) { return idb('readwrite', function (s) { return s.put(rec); }); }
  function idbExcluir(id) { return idb('readwrite', function (s) { return s.delete(id); }); }

  // ----------------------------- Configuração ------------------------------
  var configCache = null;
  function obterConfig() {
    if (configCache) return Promise.resolve(configCache);

    return fetch('jetcontrol-sync.js', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('Não foi possível ler jetcontrol-sync.js');
      return r.text();
    }).then(function (t) {
      var a = t.match(/FIREBASE_PROJECT_ID\s*=\s*['"]([^'"]*)['"]/);
      var b = t.match(/SYNC_SECRET\s*=\s*['"]([^'"]*)['"]/);
      var pid = a ? a[1].trim() : '', sec = b ? b[1].trim() : '';
      var ok = pid && sec && pid.indexOf('COLOQUE-AQUI') === -1 && sec.indexOf('COLOQUE-AQUI') === -1;
      configCache = ok ? { projectId: pid, secret: sec } : CONFIG_PADRAO;
      return configCache;
    }).catch(function () {
      // Em caso de abertura por file:/// ou falha de leitura, usa as credenciais padrão diretamente
      configCache = CONFIG_PADRAO;
      return configCache;
    });
  }

  function baseNuvem(cfg) {
    return 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(cfg.projectId) +
      '/databases/(default)/documents/jetcontrol_backups/' + encodeURIComponent(cfg.secret);
  }

  // ----------------------------- Coleta / resumo ---------------------------
  function chaveDoSistema(k) {
    return k && !CHAVES_IGNORADAS[k] && (k.indexOf(PREFIXO) === 0 || k === 'valores' || k === 'jetonData');
  }
  function coletarDados() {
    var dados = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (chaveDoSistema(k)) dados[k] = localStorage.getItem(k);
    }
    return dados;
  }
  function lerJson(texto, padrao) { try { var v = JSON.parse(texto); return v == null ? padrao : v; } catch (e) { return padrao; } }
  function jetonDaEscala(e) {
    return (parseFloat(e.jetonManha) || 0) + (parseFloat(e.jetonTarde) || 0) +
      ((parseFloat(e.jetonNoite) || 0) * (e.percepcaoQuartoJeton === 'SIM' ? 2 : 1));
  }
  function resumir(dados) {
    var abertas = lerJson(dados['jetcontrol_escalas_dados'], []);
    var ciclos = lerJson(dados['jetcontrol_ciclos_fechados'], []);
    var jetonValores = lerJson(dados['jetcontrol_jeton_valores'] || dados['jetonData'], {});
    var arquivadas = 0, jeton = 0;

    if (Array.isArray(abertas)) abertas.forEach(function (e) { jeton += jetonDaEscala(e); });
    if (Array.isArray(ciclos)) ciclos.forEach(function (c) {
      (c.escalasData || []).forEach(function (e) { arquivadas++; jeton += jetonDaEscala(e); });
    });

    var qtdLancamentosJeton = 0;
    var anoJeton = '';
    if (jetonValores && typeof jetonValores === 'object') {
      var anos = Object.keys(jetonValores).sort();
      anos.forEach(function (ano) {
        if (Array.isArray(jetonValores[ano])) {
          qtdLancamentosJeton += jetonValores[ano].length;
        }
      });
      if (anos.length > 0) {
        anoJeton = anos[anos.length - 1];
      }
    }

    var tamanho = 0;
    Object.keys(dados).forEach(function (k) { tamanho += k.length + (dados[k] || '').length; });

    return {
      escalasAbertas: Array.isArray(abertas) ? abertas.length : 0,
      ciclosFechados: Array.isArray(ciclos) ? ciclos.length : 0,
      escalasArquivadas: arquivadas,
      jetonTotal: jeton,
      itens: Object.keys(dados).length,
      tamanho: tamanho,
      lancamentosJeton: qtdLancamentosJeton,
      anoJeton: anoJeton
    };
  }

  // ----------------------------- Nuvem -------------------------------------
  function patchDoc(url, fields) {
    return fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: fields }) })
      .then(function (r) { if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; } });
  }
  function subirNuvem(cfg, rec) {
    var base = baseNuvem(cfg);
    var texto = JSON.stringify(rec.dados);
    var partes = Math.max(1, Math.ceil(texto.length / TAM_PARTE));
    var seq = Promise.resolve();
    for (var n = 0; n < partes; n++) (function (n) {
      seq = seq.then(function () {
        return patchDoc(base + '/partes/' + encodeURIComponent(rec.id + '_' + n),
          { texto: { stringValue: texto.substr(n * TAM_PARTE, TAM_PARTE) } });
      });
    })(n);
    return seq.then(function () {
      return patchDoc(base + '/itens/' + encodeURIComponent(rec.id), {
        nome: { stringValue: rec.nome },
        tipo: { stringValue: rec.tipo },
        criadoEm: { integerValue: String(rec.criadoEm) },
        resumo: { stringValue: JSON.stringify(rec.resumo) },
        partes: { integerValue: String(partes) }
      });
    });
  }
  function listarNuvem(cfg) {
    return fetch(baseNuvem(cfg) + '/itens?pageSize=100').then(function (r) {
      if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }).then(function (j) {
      return ((j && j.documents) || []).map(function (d) {
        var f = d.fields || {}, p = d.name.split('/');
        return {
          id: decodeURIComponent(p[p.length - 1]),
          nome: f.nome ? f.nome.stringValue : '',
          tipo: f.tipo ? f.tipo.stringValue : 'manual',
          criadoEm: f.criadoEm ? parseInt(f.criadoEm.integerValue, 10) : 0,
          resumo: lerJson(f.resumo && f.resumo.stringValue, {}),
          partes: f.partes ? parseInt(f.partes.integerValue, 10) : 1
        };
      });
    });
  }
  function baixarDaNuvem(cfg, meta) {
    var base = baseNuvem(cfg), pedidos = [];
    for (var n = 0; n < meta.partes; n++) pedidos.push(
      fetch(base + '/partes/' + encodeURIComponent(meta.id + '_' + n)).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) { return d.fields.texto.stringValue; }));
    return Promise.all(pedidos).then(function (ps) { return lerJson(ps.join(''), {}); });
  }
  function excluirDaNuvem(cfg, id, partes) {
    var base = baseNuvem(cfg), tarefas = [];
    for (var n = 0; n < (partes || 1); n++) tarefas.push(fetch(base + '/partes/' + encodeURIComponent(id + '_' + n), { method: 'DELETE' }));
    tarefas.push(fetch(base + '/itens/' + encodeURIComponent(id), { method: 'DELETE' }));
    return Promise.all(tarefas);
  }

  // ----------------------------- API pública -------------------------------
  var TIPOS = { 'manual': 'MANUAL', 'auto-ciclo': 'AUTOMÁTICO · FECHAR CICLO', 'auto-reset': 'AUTOMÁTICO · ANTES DE RESETAR', 'pre-restauracao': 'AUTOMÁTICO · ANTES DE RESTAURAR', 'arquivo': 'IMPORTADO DE ARQUIVO' };

  function novoId() { return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function aparar(protegidos) {
    protegidos = [].concat(protegidos || []);
    return listar().then(function (res) {
      var itens = res.itens.slice();
      var excesso = itens.length - MAX_BACKUPS;
      if (excesso <= 0) return;
      var candidatos = itens.filter(function (i) { return protegidos.indexOf(i.id) === -1; })
        .sort(function (a, b) {
          var aa = a.tipo === 'manual' || a.tipo === 'arquivo' ? 1 : 0, bb = b.tipo === 'manual' || b.tipo === 'arquivo' ? 1 : 0;
          return aa !== bb ? aa - bb : a.criadoEm - b.criadoEm;
        });
      var remover = candidatos.slice(0, excesso);
      return remover.reduce(function (p, i) { return p.then(function () { return excluir(i.id); }); }, Promise.resolve());
    });
  }

  function criar(nome, tipo, dadosOpcionais, protegerExtra) {
    var dados = dadosOpcionais || coletarDados();
    var rec = {
      id: novoId(),
      nome: (nome || '').trim() || 'Backup',
      tipo: tipo || 'manual',
      criadoEm: Date.now(),
      resumo: resumir(dados),
      dados: dados,
      nuvem: false
    };
    return idbGravar(rec).then(function () {
      return obterConfig().then(function (cfg) {
        if (!cfg) return;
        return subirNuvem(cfg, rec).then(function () { rec.nuvem = true; return idbGravar(rec); }).catch(function (e) { rec.erroNuvem = e.status || String(e.message || e); return idbGravar(rec); });
      });
    }).then(function () { return aparar([rec.id, protegerExtra]); }).then(function () {
      var m = Object.assign({}, rec); delete m.dados; return m;
    });
  }

  function listar() {
    return idbTodos().catch(function () { return []; }).then(function (locais) {
      return obterConfig().then(function (cfg) {
        var resultado = { itens: [], nuvemConfigurada: !!cfg, nuvemOk: false, erroNuvem: null };
        var mapa = {};
        locais.forEach(function (r) { var m = Object.assign({}, r); delete m.dados; m.local = true; mapa[r.id] = m; });
        if (!cfg) { resultado.itens = Object.keys(mapa).map(function (k) { return mapa[k]; }); return resultado; }
        return listarNuvem(cfg).then(function (nuvem) {
          resultado.nuvemOk = true;
          var idsNuvem = {};
          nuvem.forEach(function (m) {
            idsNuvem[m.id] = true;
            if (mapa[m.id]) { mapa[m.id].nuvem = true; mapa[m.id].partes = m.partes; }
            else { m.local = false; m.nuvem = true; mapa[m.id] = m; }
          });
          Object.keys(mapa).forEach(function (id) { if (!idsNuvem[id]) mapa[id].nuvem = false; });
        }).catch(function (e) {
          resultado.erroNuvem = e.status || String(e.message || e);
        }).then(function () {
          resultado.itens = Object.keys(mapa).map(function (k) { return mapa[k]; }).sort(function (a, b) { return b.criadoEm - a.criadoEm; });
          return resultado;
        });
      });
    });
  }

  function sincronizarPendentes() {
    return obterConfig().then(function (cfg) {
      if (!cfg) return 0;
      return idbTodos().then(function (locais) {
        var pend = locais.filter(function (r) { return !r.nuvem; });
        var feitos = 0;
        return pend.reduce(function (p, r) {
          return p.then(function () {
            return subirNuvem(cfg, r).then(function () { r.nuvem = true; delete r.erroNuvem; feitos++; return idbGravar(r); }).catch(function () {});
          });
        }, Promise.resolve()).then(function () { return feitos; });
      });
    }).catch(function () { return 0; });
  }

  function obter(id) {
    return idbObter(id).then(function (rec) {
      if (rec && rec.dados) return rec;
      return obterConfig().then(function (cfg) {
        if (!cfg) throw new Error('Backup não encontrado neste aparelho e a nuvem não está configurada.');
        return listarNuvem(cfg).then(function (lista) {
          var meta = lista.filter(function (m) { return m.id === id; })[0];
          if (!meta) throw new Error('Backup não encontrado.');
          return baixarDaNuvem(cfg, meta).then(function (dados) {
            var novo = Object.assign({}, meta, { dados: dados, nuvem: true });
            return idbGravar(novo).catch(function () {}).then(function () { return novo; });
          });
        });
      });
    });
  }

  function excluir(id) {
    return idbObter(id).then(function (rec) {
      return obterConfig().then(function (cfg) {
        var partes = rec && rec.partes;
        var p = cfg ? (partes ? Promise.resolve(partes) : listarNuvem(cfg).then(function (l) { var m = l.filter(function (x) { return x.id === id; })[0]; return m ? m.partes : 1; }).catch(function () { return 1; })) : Promise.resolve(1);
        return p.then(function (n) { return cfg ? excluirDaNuvem(cfg, id, n).catch(function () {}) : null; });
      });
    }).then(function () { return idbExcluir(id); });
  }

  function restaurar(id) {
    return obter(id).then(function (rec) {
      return criar('Antes de restaurar "' + rec.nome + '"', 'pre-restauracao', null, id).catch(function () {}).then(function () {
        var dados = rec.dados || {};
        var atuais = [];
        for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (chaveDoSistema(k)) atuais.push(k); }
        atuais.forEach(function (k) { if (!(k in dados)) localStorage.removeItem(k); });
        Object.keys(dados).forEach(function (k) {
          if (chaveDoSistema(k) && localStorage.getItem(k) !== dados[k]) localStorage.setItem(k, dados[k]);
        });
        return { itens: Object.keys(dados).length };
      });
    });
  }

  function baixar(id) {
    return obter(id).then(function (rec) {
      var corpo = JSON.stringify({ sistema: 'JETCONTROL 2026', versao: 1, nome: rec.nome, tipo: rec.tipo, criadoEm: rec.criadoEm, resumo: rec.resumo, dados: rec.dados }, null, 1);
      var d = new Date(rec.criadoEm), p = function (n) { return String(n).padStart(2, '0'); };
      var nomeArq = 'jetcontrol-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + '.json';
      var url = URL.createObjectURL(new Blob([corpo], { type: 'application/json' }));
      var a = document.createElement('a'); a.href = url; a.download = nomeArq; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    });
  }

  function importarArquivo(arquivo) {
    return arquivo.text().then(function (t) {
      var j = lerJson(t, null);
      if (!j || typeof j.dados !== 'object' || j.sistema !== 'JETCONTROL 2026') throw new Error('Arquivo inválido: não é um backup do JETCONTROL.');
      return criar('Importado: ' + (j.nome || arquivo.name), 'arquivo', j.dados);
    });
  }

  window.JetBackup = {
    MAX_BACKUPS: MAX_BACKUPS, TIPOS: TIPOS,
    criar: criar, listar: listar, obter: obter, excluir: excluir,
    restaurar: restaurar, baixar: baixar, importarArquivo: importarArquivo,
    sincronizarPendentes: sincronizarPendentes, coletarDados: coletarDados, resumir: resumir
  };
})();