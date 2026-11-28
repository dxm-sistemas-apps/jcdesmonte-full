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
  // Chaves que ficam SOMENTE neste aparelho. Não vão para a nuvem:
  // evita que o marcador local de reset seja enviado para o Firestore e bloqueie outros aparelhos.
  var CHAVES_SOMENTE_LOCAIS = {
    'jetcontrol_reset_aplicado_em': true
  };
  var TAM_PARTE = 250000;
  var PREFIXO_PARTES = '__JC_PARTES__:';
  var SEP_PARTE = '__p__';
  var RE_DOC_PARTE = /^(.+)__p__(\d+)$/;
  var ATRASO_ENVIO_MS = 700;
  var TEMPO_LIMITE_MS = 20000;

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

  // ---- LOGIN GOOGLE: toda chamada ao Firestore leva o token do dono (jetcontrol-auth.js) ----
  // As regras do Firestore recusam qualquer pedido sem esse token.
  function cabecalhos(extra) {
    var h = extra || {};
    var tok = (typeof window.JetAuthTokenAtual === 'function') ? window.JetAuthTokenAtual() : null;
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    return h;
  }

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

  function gravarDocumentoFirestore(docId, campos, mascara, keepalive) {
    var corpo = JSON.stringify({ fields: campos });
    return fetch(URL_BASE + '/' + encodeURIComponent(docId) + mascara, {
      method: 'PATCH',
      headers: cabecalhos({ 'Content-Type': 'application/json' }),
      body: corpo,
      keepalive: !!keepalive && corpo.length < 50000
    }).then(function (resposta) {
      return !!(resposta && resposta.ok);
    }).catch(function () {
      return false;
    });
  }

  function enviarAgora(chave, valor, apagar, carimbo, keepalive) {
    var agora = carimbo || Date.now();
    var mascaraValor = '?updateMask.fieldPaths=value&updateMask.fieldPaths=atualizadoEm&updateMask.fieldPaths=deleted';

    if (apagar) {
      var mascaraApagar = '?updateMask.fieldPaths=deleted&updateMask.fieldPaths=atualizadoEm';
      var camposApagar = { deleted: { booleanValue: true }, atualizadoEm: { integerValue: String(agora) } };
      return gravarDocumentoFirestore(chave, camposApagar, mascaraApagar, keepalive).then(function (ok) {
        if (ok) sairDaFila(chave, agora);
      });
    }

    var texto = (valor === null || valor === undefined) ? '' : String(valor);

    // Chave cabe em um único documento do Firestore (abaixo do limite de 1 MB)
    if (texto.length <= TAM_PARTE) {
      var camposUnico = {
        value: { stringValue: texto },
        atualizadoEm: { integerValue: String(agora) },
        deleted: { booleanValue: false }
      };
      return gravarDocumentoFirestore(chave, camposUnico, mascaraValor, keepalive).then(function (ok) {
        if (ok) sairDaFila(chave, agora);
      });
    }

    // Chave grande (ex.: jetcontrol_ciclos_fechados > 250 KB): fatia em partes e grava o manifesto ao final
    var partes = [];
    for (var pos = 0; pos < texto.length; pos += TAM_PARTE) {
      partes.push(texto.slice(pos, pos + TAM_PARTE));
    }

    var cadeia = Promise.resolve(true);
    partes.forEach(function (parte, idx) {
      cadeia = cadeia.then(function (okAnterior) {
        if (!okAnterior) return false;
        var camposParte = {
          value: { stringValue: parte },
          atualizadoEm: { integerValue: String(agora) },
          deleted: { booleanValue: false }
        };
        return gravarDocumentoFirestore(chave + SEP_PARTE + idx, camposParte, mascaraValor, false);
      });
    });

    return cadeia.then(function (todasPartesOk) {
      if (!todasPartesOk) return false;
      var manifesto = PREFIXO_PARTES + JSON.stringify({ n: partes.length, t: agora });
      var camposManifesto = {
        value: { stringValue: manifesto },
        atualizadoEm: { integerValue: String(agora) },
        deleted: { booleanValue: false }
      };
      return gravarDocumentoFirestore(chave, camposManifesto, mascaraValor, false);
    }).then(function (ok) {
      if (ok) sairDaFila(chave, agora);
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

    return fetch(url, { headers: cabecalhos() }).then(function (resposta) {
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

      // 1.5. Coleta de partes de chaves fatiadas (<chave>__p__<indice>)
      var mapaPartes = {};
      documentos.forEach(function (doc) {
        var partesDoNome = doc.name.split('/');
        var nomeDoc = partesDoNome[partesDoNome.length - 1];
        var m = nomeDoc.match(RE_DOC_PARTE);
        if (!m) return;
        var base = m[1];
        var idx = parseInt(m[2], 10);
        if (!mapaPartes[base]) mapaPartes[base] = {};
        mapaPartes[base][idx] = decodificarDocumento(doc.fields);
      });

      // 2. Processamento dos Documentos da Nuvem
      var filaAtual = lerFila();
      documentos.forEach(function (doc) {
        var partesDoNome = doc.name.split('/');
        var chave = partesDoNome[partesDoNome.length - 1];
        if (chave === CHAVE_MARCADOR_RESET) return;
        if (RE_DOC_PARTE.test(chave)) return; // partes são montadas pelo documento principal
        if (CHAVES_SOMENTE_LOCAIS[chave]) return; // nunca aplica chave somente local vinda da nuvem
        chavesQueAJaEstaoNaNuvem[chave] = true;

        var info = decodificarDocumento(doc.fields);

        // Remonta o valor completo quando o documento principal for um manifesto de partes
        if (!info.apagado && info.valor !== null && info.valor.indexOf(PREFIXO_PARTES) === 0) {
          var metaPartes = null;
          try { metaPartes = JSON.parse(info.valor.slice(PREFIXO_PARTES.length)); } catch (e) {}
          if (!metaPartes || !metaPartes.n || metaPartes.n < 1) return;
          var partesDaChave = mapaPartes[chave] || {};
          var blocos = [];
          for (var p = 0; p < metaPartes.n; p++) {
            var parte = partesDaChave[p];
            if (!parte || parte.apagado || parte.valor === null) return; // envio ainda incompleto; aguarda próximo ciclo
            if (metaPartes.t && parte.atualizadoEm !== metaPartes.t && parte.atualizadoEm !== info.atualizadoEm) return;
            blocos.push(parte.valor);
          }
          info.valor = blocos.join('');
        }

        var itemFila = filaAtual[chave] || pendentes[chave] || null;
        var carimboLocal = Math.max(meta[chave] || 0, itemFila ? (itemFila.carimbo || 0) : 0);
        var valorAntesDaAtualizacao = originalGetItem.call(localStorage, chave);

        // Se há alteração local ainda na fila/pendente mais recente (ou igual) ao que está na nuvem,
        // preserva o dado local até que o envio à nuvem seja concluído.
        if (itemFila && info.atualizadoEm <= (itemFila.carimbo || 0)) {
          return;
        }

        // REGRA DE PROTEÇÃO: Se o documento na nuvem foi gerado antes ou durante o reset,
        // ele é um resíduo descartado. Só apaga o dado local se ele também for anterior ao reset;
        // se o dado local foi criado APÓS o reset, mantém e reenvia para atualizar a nuvem.
        if (corteReset > 0 && info.atualizadoEm <= corteReset) {
          if (carimboLocal > corteReset && valorAntesDaAtualizacao !== null) {
            if (!itemFila) agendarEnvio(chave, valorAntesDaAtualizacao, false);
            return;
          }
          if (valorAntesDaAtualizacao !== null) {
            originalRemoveItem.call(localStorage, chave);
            houveMudancaReal = true;
          }
          meta[chave] = Math.max(carimboLocal, corteReset);
          return;
        }

        // Só aplica exclusão vinda da nuvem se ela for ESTRITAMENTE mais recente que o dado local.
        // Evita apagar escalas recém-salvas quando a nuvem ainda tem "deleted: true" de um ciclo anterior.
        if (info.apagado) {
          if (info.atualizadoEm > carimboLocal) {
            if (valorAntesDaAtualizacao !== null) {
              originalRemoveItem.call(localStorage, chave);
              houveMudancaReal = true;
            }
            meta[chave] = info.atualizadoEm;
          } else if (valorAntesDaAtualizacao !== null && !itemFila) {
            agendarEnvio(chave, valorAntesDaAtualizacao, false);
          }
          return;
        }

        if (info.valor !== null && (info.atualizadoEm > carimboLocal || (carimboLocal === 0 && valorAntesDaAtualizacao === null))) {
          if (info.valor !== valorAntesDaAtualizacao) {
            originalSetItem.call(localStorage, chave, info.valor);
            houveMudancaReal = true;
          }
          meta[chave] = info.atualizadoEm;
        } else if (valorAntesDaAtualizacao !== null && carimboLocal > info.atualizadoEm && !itemFila) {
          // Dado local é mais recente que o da nuvem (ex.: envio anterior falhou por limite de tamanho): reenvia agora.
          agendarEnvio(chave, valorAntesDaAtualizacao, false);
        }
      });

      // 3. Semear dados locais criados ESTRITAMENTE APÓS o reset
      for (var i = 0; i < localStorage.length; i++) {
        var chaveLocal = localStorage.key(i);
        if (chaveLocal && chaveLocal !== CHAVE_META && chaveLocal !== CHAVE_FILA &&
            !CHAVES_SOMENTE_LOCAIS[chaveLocal] &&
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

  // Em iframes ocultos (ex.: cotas-extras.html aberto por escalas.html), não executa pull nem polling
  // para não competir com o envio pendente da janela principal.
  var emIframe = (window.parent !== window);

  // só sincroniza depois do login (jetcontrol-auth.js); sem login nada é lido nem gravado na nuvem
  // Reenvia pendências locais ANTES de puxar da nuvem para não sobrescrever edições recém-salvas.
  window.JetSyncReady = emIframe
    ? Promise.resolve(false)
    : (window.JetAuthPronto || Promise.resolve())
        .then(function () { return reenviarFila(); }, function () {})
        .then(sincronizarUmaVez);

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

  if (configurado && !emIframe) {
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