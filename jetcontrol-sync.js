/* ============================================================================
   JETCONTROL 2026®™ — SINCRONIZAÇÃO EM NUVEM (Firebase Firestore)
   ============================================================================ */
(function () {
  'use strict';

  var FIREBASE_PROJECT_ID = 'jetcontrol-2026-desmonte';
  var SYNC_SECRET          = 'jetcontrol-2026-desmonte2009';

  var PREFIXO_SINCRONIZADO = 'jetcontrol_';
  var CHAVE_META = '__jetcontrol_sync_meta__';
  var CHAVE_FILA = '__jetcontrol_sync_fila__';
  var CHAVE_MARCADOR_RESET = 'sistema_reset_marker';
  var CHAVE_RESET_APLICADO = 'jetcontrol_reset_aplicado_em';
  // Chaves que ficam SOMENTE neste aparelho (rascunho do formulário). Não vão para a nuvem:
  // evita a nuvem devolver/apagar um rascunho em andamento e evita o aviso de "pendente" a cada tecla.
  var CHAVES_SOMENTE_LOCAIS = {};
  var ATRASO_ENVIO_MS = 700;
  var TEMPO_LIMITE_MS = 8000;

  var configurado =
    FIREBASE_PROJECT_ID.indexOf('COLOQUE-AQUI') === -1 &&
    SYNC_SECRET.indexOf('COLOQUE-AQUI') === -1 &&
    FIREBASE_PROJECT_ID.length > 0 &&
    SYNC_SECRET.length > 0 &&
    typeof fetch === 'function';

  var URL_BASE = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(FIREBASE_PROJECT_ID) +
    '/databases/(default)/documents/jetcontrol_sync/' +
    encodeURIComponent(SYNC_SECRET) + '/dados';

  var originalSetItem = Storage.prototype.setItem;
  var originalRemoveItem = Storage.prototype.removeItem;
  var originalGetItem = Storage.prototype.getItem;

  function lerMeta() {
    try {
      return JSON.parse(originalGetItem.call(localStorage, CHAVE_META)) || {};
    } catch (e) {
      return {};
    }
  }

  function salvarMeta(meta) {
    try {
      originalSetItem.call(localStorage, CHAVE_META, JSON.stringify(meta));
    } catch (e) {}
  }

  function lerFila() {
    try { return JSON.parse(originalGetItem.call(localStorage, CHAVE_FILA) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function salvarFila(fila) {
    try {
      if (Object.keys(fila).length === 0) originalRemoveItem.call(localStorage, CHAVE_FILA);
      else originalSetItem.call(localStorage, CHAVE_FILA, JSON.stringify(fila));
    } catch (e) {}
    atualizarIndicador();
  }

  function entrarNaFila(chave, apagar, carimbo) {
    var fila = lerFila();
    fila[chave] = { apagar: !!apagar, carimbo: carimbo };
    salvarFila(fila);
  }

  function sairDaFila(chave, carimbo) {
    var fila = lerFila();
    if (fila[chave] && fila[chave].carimbo <= carimbo) {
      delete fila[chave];
      salvarFila(fila);
    }
  }

  function decodificarDocumento(fields) {
    var valor = (fields && fields.value && typeof fields.value.stringValue === 'string')
      ? fields.value.stringValue : null;
    var carimbo = (fields && fields.atualizadoEm && fields.atualizadoEm.integerValue)
      ? parseInt(fields.atualizadoEm.integerValue, 10) : 0;
    var apagado = !!(fields && fields.deleted && fields.deleted.booleanValue);
    return { valor: valor, atualizadoEm: carimbo, apagado: apagado };
  }

  var timersPendentes = {};
  var pendentes = {};
  var reenviandoFila = false;

  function reenviarFila() {
    if (!configurado || reenviandoFila) return Promise.resolve();
    var fila = lerFila();
    var chaves = Object.keys(fila);
    if (chaves.length === 0) return Promise.resolve();
    reenviandoFila = true;
    var meta = lerMeta();
    var envios = [];
    chaves.forEach(function (chave) {
      var item = fila[chave];
      if (timersPendentes[chave] && pendentes[chave]) return;
      if ((meta[chave] || 0) > item.carimbo) { sairDaFila(chave, item.carimbo); return; }
      var valor = originalGetItem.call(localStorage, chave);
      var apagar = item.apagar || valor === null;
      envios.push(enviarAgora(chave, apagar ? null : valor, apagar, item.carimbo));
    });
    return Promise.all(envios).then(function () { reenviandoFila = false; },
                                    function () { reenviandoFila = false; });
  }

  var indicadorEl = null;
  function atualizarIndicador() {
    if (window.parent !== window) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', atualizarIndicador); return; }
    var qtd = Object.keys(lerFila()).length;
    var offline = (typeof navigator !== 'undefined') && navigator.onLine === false;
    // O aviso "Sincronizando… N pendente" foi removido a pedido; só o aviso de offline permanece.
    if (!offline) { if (indicadorEl) indicadorEl.style.display = 'none'; return; }
    if (!indicadorEl) {
      indicadorEl = document.createElement('div');
      indicadorEl.setAttribute('role', 'status');
      indicadorEl.style.cssText = 'position:fixed;left:12px;bottom:84px;z-index:99998;padding:6px 12px;border-radius:999px;font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.03em;box-shadow:0 4px 14px rgba(0,0,0,.4);pointer-events:none;text-transform:uppercase';
      document.body.appendChild(indicadorEl);
    }
    indicadorEl.style.display = 'block';
    indicadorEl.style.background = offline ? '#b45309' : '#1d4ed8';
    indicadorEl.style.color = '#fff';
    indicadorEl.textContent = 'Offline — dados salvos neste aparelho';
  }
  window.addEventListener('online', function () { atualizarIndicador(); reenviarFila(); });
  window.addEventListener('offline', atualizarIndicador);
  document.addEventListener('DOMContentLoaded', atualizarIndicador);

  function descarregarPendentes() {
    Object.keys(pendentes).forEach(function (chave) {
      var p = pendentes[chave];
      clearTimeout(timersPendentes[chave]);
      delete pendentes[chave];
      enviarAgora(chave, p.valor, p.apagar, p.carimbo, true);
    });
  }
  window.addEventListener('pagehide', descarregarPendentes);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') descarregarPendentes();
  });

  function agendarEnvio(chave, valor, apagar) {
    if (!configurado) return;
    if (CHAVES_SOMENTE_LOCAIS[chave]) return;
    clearTimeout(timersPendentes[chave]);

    var carimboDestaEdicao = Date.now();
    var meta = lerMeta();
    meta[chave] = carimboDestaEdicao;
    salvarMeta(meta);
    entrarNaFila(chave, apagar, carimboDestaEdicao);

    pendentes[chave] = { valor: valor, apagar: apagar, carimbo: carimboDestaEdicao };
    timersPendentes[chave] = setTimeout(function () {
      delete pendentes[chave];
      enviarAgora(chave, valor, apagar, carimboDestaEdicao);
    }, ATRASO_ENVIO_MS);
  }

  function enviarAgora(chave, valor, apagar, carimbo, keepalive) {
    var agora = carimbo || Date.now();
    var mascara = apagar
      ? '?updateMask.fieldPaths=deleted&updateMask.fieldPaths=atualizadoEm'
      : '?updateMask.fieldPaths=value&updateMask.fieldPaths=atualizadoEm&updateMask.fieldPaths=deleted';

    var campos = apagar
      ? { deleted: { booleanValue: true }, atualizadoEm: { integerValue: String(agora) } }
      : {
          value: { stringValue: valor },
          atualizadoEm: { integerValue: String(agora) },
          deleted: { booleanValue: false }
        };

    return fetch(URL_BASE + '/' + encodeURIComponent(chave) + mascara, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: campos }),
      keepalive: !!keepalive
    }).then(function (resposta) {
      if (resposta && resposta.ok) sairDaFila(chave, agora);
    }).catch(function () {});
  }

  Storage.prototype.setItem = function (chave, valor) {
    originalSetItem.call(this, chave, valor);
    if (this === localStorage && chave !== CHAVE_META && chave !== CHAVE_FILA && chave.indexOf(PREFIXO_SINCRONIZADO) === 0) {
      agendarEnvio(chave, valor, false);
    }
  };

  Storage.prototype.removeItem = function (chave) {
    originalRemoveItem.call(this, chave);
    if (this === localStorage && chave !== CHAVE_META && chave !== CHAVE_FILA && chave.indexOf(PREFIXO_SINCRONIZADO) === 0) {
      agendarEnvio(chave, null, true);
    }
  };

  function buscarTodosOsDocumentos(pageToken, acumulado) {
    acumulado = acumulado || [];
    var url = URL_BASE + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');

    return fetch(url).then(function (resposta) {
      if (!resposta.ok) throw new Error('Firestore respondeu ' + resposta.status);
      return resposta.json();
    }).then(function (dados) {
      var documentosDaPagina = (dados && dados.documents) || [];
      var todos = acumulado.concat(documentosDaPagina);
      if (dados && dados.nextPageToken) {
        return buscarTodosOsDocumentos(dados.nextPageToken, todos);
      }
      return todos;
    });
  }

  function sincronizarUmaVez() {
    if (!configurado) return Promise.resolve(false);

    var buscaComLimiteDeTempo = Promise.race([
      buscarTodosOsDocumentos(),
      new Promise(function (_, rejeitar) {
        setTimeout(function () { rejeitar(new Error('tempo de espera esgotado')); }, TEMPO_LIMITE_MS);
      })
    ]);

    return buscaComLimiteDeTempo.then(function (documentos) {
      var meta = lerMeta();
      var chavesQueAJaEstaoNaNuvem = {};
      var houveMudancaReal = false;
      var corteReset = 0;

      // 1. Deteção do Marcador de Reset
      var docMarcador = documentos.filter(function (doc) {
        var partes = doc.name.split('/');
        return partes[partes.length - 1] === CHAVE_MARCADOR_RESET;
      })[0];

      var ultimoResetAplicadoAqui = parseInt(originalGetItem.call(localStorage, CHAVE_RESET_APLICADO) || '0', 10);

      if (docMarcador) {
        var infoMarcador = decodificarDocumento(docMarcador.fields);
        corteReset = Math.max(infoMarcador.atualizadoEm || 0, ultimoResetAplicadoAqui);

        if (infoMarcador.atualizadoEm > ultimoResetAplicadoAqui) {
          for (var i = localStorage.length - 1; i >= 0; i--) {
            var chaveParaApagar = localStorage.key(i);
            if (chaveParaApagar && (
              chaveParaApagar.indexOf(PREFIXO_SINCRONIZADO) === 0 || 
              chaveParaApagar === CHAVE_META || 
              chaveParaApagar === CHAVE_FILA ||
              chaveParaApagar === 'valores' || 
              chaveParaApagar === 'jetonData'
            )) {
              originalRemoveItem.call(localStorage, chaveParaApagar);
            }
          }
          originalSetItem.call(localStorage, CHAVE_RESET_APLICADO, String(infoMarcador.atualizadoEm));
          houveMudancaReal = true;
        }
      } else {
        corteReset = ultimoResetAplicadoAqui;
      }

      // 2. Processamento dos Documentos da Nuvem
      documentos.forEach(function (doc) {
        var partesDoNome = doc.name.split('/');
        var chave = partesDoNome[partesDoNome.length - 1];
        if (chave === CHAVE_MARCADOR_RESET) return;
        if (CHAVES_SOMENTE_LOCAIS[chave]) return; // nunca aplica rascunho vindo da nuvem
        chavesQueAJaEstaoNaNuvem[chave] = true;

        var info = decodificarDocumento(doc.fields);
        var carimboLocal = meta[chave] || 0;
        var valorAntesDaAtualizacao = originalGetItem.call(localStorage, chave);

        // REGRA DE PROTEÇÃO: Se o documento na nuvem foi gerado antes ou durante o reset,
        // ele é um resíduo descartado. Não pode ser restaurado no navegador!
        if (corteReset > 0 && info.atualizadoEm <= corteReset) {
          if (valorAntesDaAtualizacao !== null) {
            originalRemoveItem.call(localStorage, chave);
            houveMudancaReal = true;
          }
          meta[chave] = corteReset;
          return;
        }

        if (info.apagado) {
          if (valorAntesDaAtualizacao !== null) {
            originalRemoveItem.call(localStorage, chave);
            houveMudancaReal = true;
          }
          meta[chave] = info.atualizadoEm;
          return;
        }

        if (info.valor !== null && info.atualizadoEm >= carimboLocal) {
          if (info.valor !== valorAntesDaAtualizacao) {
            originalSetItem.call(localStorage, chave, info.valor);
            houveMudancaReal = true;
          }
          meta[chave] = info.atualizadoEm;
        }
      });

      // 3. Semear dados locais criados ESTRITAMENTE APÓS o reset
      for (var i = 0; i < localStorage.length; i++) {
        var chaveLocal = localStorage.key(i);
        if (chaveLocal && chaveLocal !== CHAVE_META && chaveLocal !== CHAVE_FILA &&
            chaveLocal.indexOf(PREFIXO_SINCRONIZADO) === 0 &&
            !chavesQueAJaEstaoNaNuvem[chaveLocal]) {
          if (corteReset > 0 && (meta[chaveLocal] || 0) <= corteReset) continue;
          var valorLocal = originalGetItem.call(localStorage, chaveLocal);
          if (valorLocal !== null) agendarEnvio(chaveLocal, valorLocal, false);
        }
      }

      salvarMeta(meta);
      return houveMudancaReal;
    }).catch(function (erro) {
      console.warn('[JETCONTROL SYNC] Falha temporária:', erro && erro.message);
      return false;
    });
  }

  window.JetSyncReady = sincronizarUmaVez();

  window.JetSyncStatus = function () {
    return configurado
      ? 'Sincronização em nuvem ATIVA (projeto: ' + FIREBASE_PROJECT_ID + ')'
      : 'Sincronização em nuvem NÃO CONFIGURADA';
  };

  var INTERVALO_VERIFICACAO_MS = 4000;
  var ouvintes = [];
  var cicloAgendado = null;
  var verificandoAgora = false;

  window.JetSyncOnChange = function (funcaoOuvinte) {
    if (typeof funcaoOuvinte === 'function') ouvintes.push(funcaoOuvinte);
  };

  function avisarOuvintes() {
    ouvintes.forEach(function (fn) {
      try { fn(); } catch (e) {}
    });
  }

  function cicloDeVerificacao() {
    if (document.visibilityState !== 'visible') {
      agendarProximoCiclo();
      return;
    }
    verificandoAgora = true;
    reenviarFila().then(function () { return sincronizarUmaVez(); }).then(function (houveMudanca) {
      verificandoAgora = false;
      if (houveMudanca) avisarOuvintes();
      agendarProximoCiclo();
    });
  }

  function agendarProximoCiclo() {
    clearTimeout(cicloAgendado);
    cicloAgendado = setTimeout(cicloDeVerificacao, INTERVALO_VERIFICACAO_MS);
  }

  if (configurado) {
    agendarProximoCiclo();
    window.JetSyncReady.then(function () { return reenviarFila(); }, function () {});

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && !verificandoAgora) {
        clearTimeout(cicloAgendado);
        cicloDeVerificacao();
      }
    });
  }
})();