/* JETCONTROL - ROTA AUTOMÁTICA (saída/chegada de casa)
 * Registra horário e km ao sair/voltar para casa, usando a localização do telefone (app Android/Capacitor).
 * Este arquivo vai na raiz do site (GitHub Pages), ao lado das páginas, e é carregado em TODAS as páginas
 * (o menu JETCONTROL-APP.bat > opção 5 insere a linha <script src="jetcontrol-rota.js"> sozinho).
 *
 * Dados (só neste aparelho; prefixo "jetrota_" para não entrar na sincronização em nuvem):
 *   jetrota_cfg    configurações (casa, raio, km atual, dias da semana...)
 *   jetrota_estado máquina de estados do dia
 *   jetrota_dias   histórico { 'AAAA-MM-DD': { saidaHora, saidaKm, chegadaHora, chegadaKm, distKm, status } }
 */
(function () {
  if (window.JetRota) return;

  // ===================== AJUSTES FÁCEIS (edite aqui) =====================
  const PADRAO = {
    ativo: false,        // liga/desliga todo o monitoramento
    home: null,          // { lat, lon } do local de saída
    raio: 100,           // metros; GPS erra 10-30 m, por isso 100 é mais estável que 50
    kmAtual: null,       // km do carro agora (vira o km de saída do próximo trajeto)
    dias: [1, 2, 3, 4, 5], // dias da semana em que o app PERGUNTA (0=dom ... 6=sáb)
    dwellSeg: 90,        // segundos fora/dentro do raio antes de disparar (evita falso alarme)
    fatorKm: 1,          // calibração: km do painel ÷ km do GPS (ex.: 1.02 se o GPS mede 2% a menos)
    precisaoMax: 60      // descarta pontos de GPS com erro maior que isto (metros)
  };
  const DIST_MIN_SEGMENTO = 10;   // m: ignora "tremida" do GPS menor que isto
  const VEL_MAX = 70;             // m/s: ignora saltos impossíveis (~250 km/h)
  const DISTANCIA_FILTRO = 20;    // m: o GPS só avisa a cada tanto de deslocamento (economiza bateria)
  // ========================================================================

  const K = { cfg: 'jetrota_cfg', est: 'jetrota_estado', dias: 'jetrota_dias', wid: 'jetrota_watcher' };
  const ler = (k, p) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? p : v; } catch (e) { return p; } };
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const cfg = () => Object.assign({}, PADRAO, ler(K.cfg, {}));
  const estado = () => ler(K.est, { fase: 'em_casa' });
  const hist = () => ler(K.dias, {});
  const dois = (n) => String(n).padStart(2, '0');
  const diaChave = (t) => { const d = new Date(t); return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`; };
  const hhmm = (t) => { const d = new Date(t); return `${dois(d.getHours())}:${dois(d.getMinutes())}`; };
  const arred1 = (n) => Math.round(n * 10) / 10;
  // Diagnóstico: últimas 40 linhas, visíveis na tela "Rota automática"
  const K_DIAG = 'jetrota_diag';
  function log(msg) {
    const l = ler(K_DIAG, []); l.push(new Date().toLocaleTimeString('pt-BR') + ' ' + msg);
    gravar(K_DIAG, l.slice(-40));
  }
  // Em páginas remotas (server.url) o Capacitor injeta só a ponte nativa: não existe registerPlugin, mas os plugins
  // instalados ficam em Capacitor.Plugins. Usa o que existir.
  const plug = (nome) => {
    const C = window.Capacitor || {};
    if (typeof C.registerPlugin === 'function') return C.registerPlugin(nome);
    if (C.Plugins && C.Plugins[nome]) return C.Plugins[nome];
    throw new Error('plugin nativo ' + nome + ' não encontrado (Capacitor.Plugins: ' + Object.keys(C.Plugins || {}).join(',') + ')');
  };
  const nativo = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());

  function haversine(a, b) {
    const R = 6371000, r = (x) => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // ---------------- Notificações ----------------
  let LN = null;
  async function prepararNotificacoes() {
    if (!nativo() || LN) return;
    try {
      LN = plug('LocalNotifications');
      await LN.requestPermissions();
      await LN.registerActionTypes({ types: [
        { id: 'ROTA_SAIDA', actions: [{ id: 'sim', title: 'MONITORAR' }, { id: 'nao', title: 'HOJE NÃO' }] },
        { id: 'ROTA_CHEGADA', actions: [{ id: 'confirmar', title: 'CONFIRMAR' }, { id: 'editar', title: 'EDITAR' }] },
        { id: 'ROTA_PENDENTE', actions: [{ id: 'registrar', title: 'REGISTRAR' }, { id: 'descartar', title: 'DESCARTAR' }] }
      ] });
      LN.addListener('localNotificationActionPerformed', (ev) => acao(ev.actionId, ev.notification && ev.notification.extra));
    } catch (e) { console.warn('JetRota: notificações indisponíveis', e); log('FALHA nas notificações: ' + (e && e.message || e)); }
  }
  async function notificar(titulo, corpo, tipo, extra) {
    if (!LN) { console.log('[JetRota]', titulo, corpo); return; }
    try {
      log('enviando notificação: ' + titulo);
      await LN.schedule({ notifications: [{ id: Math.floor(Date.now() % 2147483000), title: titulo, body: corpo, actionTypeId: tipo, extra: extra || {}, schedule: { at: new Date(Date.now() + 300) } }] });
    } catch (e) { console.warn(e); }
  }

  // ---------------- Máquina de estados ----------------
  // fases: em_casa -> (saiu) aguardando -> (Sim) monitorando -> (voltou) em_casa  |  (Hoje não) ignorado -> em_casa
  function processar(p) {
    const c = cfg();
    if (!c.ativo || !c.home) return;
    const _d = haversine(c.home, p);
    const _ag = Date.now();
    if (!processar._ult || _ag - processar._ult > 60000) { processar._ult = _ag; log(`GPS ok: ${Math.round(_d)} m de casa, precisão ${p.acc != null ? Math.round(p.acc) : '?'} m`); }
    if (p.acc != null && p.acc > c.precisaoMax) { log('ponto descartado: precisão ruim'); return; }
    const e = estado();
    const t = p.t || Date.now();
    const d = haversine(c.home, p);
    const fora = d > c.raio, dentro = d <= c.raio;
    const dia = diaChave(t);
    const dow = new Date(t).getDay();
    const h = hist();

    // novo dia: libera o "hoje não" do dia anterior quando estiver em casa
    if (e.fase === 'ignorado' && e.dia !== dia && dentro) { e.fase = 'em_casa'; }

    if (e.fase === 'em_casa') {
      if (!fora) { e.foraDesde = null; gravar(K.est, e); return; }
      if (!c.dias.includes(dow) || h[dia]) { gravar(K.est, e); return; } // dia fora da rotina ou já registrado
      if (!e.foraDesde) e.foraDesde = t;
      if (t - e.foraDesde >= c.dwellSeg * 1000 || d > c.raio * 3) {
        const km = c.kmAtual;
        Object.assign(e, { fase: 'aguardando', dia, saidaTs: e.foraDesde, saidaHora: hhmm(e.foraDesde), saidaKm: km, distM: 0, ultimo: { lat: p.lat, lon: p.lon, t } });
        gravar(K.est, e);
        notificar('Você saiu de casa', `Saída ${e.saidaHora}${km != null ? ' • km ' + km : ''}. Monitorar este trajeto?`, 'ROTA_SAIDA', { dia });
      } else gravar(K.est, e);
      return;
    }

    if (e.fase === 'aguardando' || e.fase === 'monitorando') {
      // soma a distância percorrida
      if (e.ultimo) {
        const seg = haversine(e.ultimo, p), dt = (t - e.ultimo.t) / 1000;
        if (seg >= DIST_MIN_SEGMENTO && dt > 0 && seg / dt <= VEL_MAX) { e.distM += seg; e.ultimo = { lat: p.lat, lon: p.lon, t }; }
      } else e.ultimo = { lat: p.lat, lon: p.lon, t };
      if (dentro) {
        if (!e.dentroDesde) e.dentroDesde = t;
        if (t - e.dentroDesde >= c.dwellSeg * 1000) { chegou(e, c, p, e.dentroDesde); return; }
      } else e.dentroDesde = null;
      gravar(K.est, e);
      return;
    }

    if (e.fase === 'ignorado' && dentro) { e.fase = 'em_casa'; e.foraDesde = null; gravar(K.est, e); }
  }

  function chegou(e, c, p, tChegada) {
    const distKm = e.distM / 1000;
    const kmCh = e.saidaKm != null ? arred1(Number(e.saidaKm) + distKm * c.fatorKm) : null;
    const dia = e.dia;
    const h = hist();
    const registro = { saidaHora: e.saidaHora, saidaKm: e.saidaKm, chegadaHora: hhmm(tChegada), chegadaKm: kmCh, distKm: arred1(distKm * c.fatorKm), status: 'pendente' };
    if (e.fase === 'aguardando') {
      // não respondeu à pergunta de saída: pede para registrar agora
      e.pendenteRegistro = registro; e.fase = 'em_casa'; e.foraDesde = null; e.dentroDesde = null;
      gravar(K.est, e);
      notificar('Trajeto detectado', `Saída ${registro.saidaHora} • chegada ${registro.chegadaHora} • ${registro.distKm} km. Registrar?`, 'ROTA_PENDENTE', { dia });
      return;
    }
    h[dia] = registro; gravar(K.dias, h);
    if (kmCh != null) { const cc = cfg(); cc.kmAtual = kmCh; gravar(K.cfg, cc); }
    Object.assign(e, { fase: 'em_casa', foraDesde: null, dentroDesde: null, ultimo: null });
    gravar(K.est, e);
    notificar('Você chegou em casa', `Chegada ${registro.chegadaHora}${kmCh != null ? ' • km ' + kmCh : ''} (${registro.distKm} km). Confirmar?`, 'ROTA_CHEGADA', { dia });
  }

  function acao(id, extra) {
    const e = estado(), dia = (extra && extra.dia) || e.dia;
    if (id === 'sim' && e.fase === 'aguardando') { e.fase = 'monitorando'; gravar(K.est, e); }
    else if (id === 'nao') { Object.assign(e, { fase: 'ignorado', dia, distM: 0, ultimo: null, foraDesde: null, dentroDesde: null }); gravar(K.est, e); }
    else if (id === 'confirmar') { const h = hist(); if (h[dia]) { h[dia].status = 'confirmado'; gravar(K.dias, h); } }
    else if (id === 'editar') { location.href = 'rota.html?editar=' + encodeURIComponent(dia); }
    else if (id === 'registrar' && e.pendenteRegistro) {
      const h = hist(); h[dia] = e.pendenteRegistro; gravar(K.dias, h);
      const c = cfg(); if (e.pendenteRegistro.chegadaKm != null) { c.kmAtual = e.pendenteRegistro.chegadaKm; gravar(K.cfg, c); }
      e.pendenteRegistro = null; gravar(K.est, e);
    } else if (id === 'descartar') { e.pendenteRegistro = null; gravar(K.est, e); }
  }

  // ---------------- GPS em segundo plano ----------------
  async function iniciar() {
    const c = cfg();
    if (!nativo()) { log('não está no app nativo (aberto no navegador?)'); return; }
    if (!c.ativo || !c.home) { log('inativo ou sem casa definida'); return; }
    log('iniciando monitoramento...');
    await prepararNotificacoes();
    try {
      const BG = plug('BackgroundGeolocation');
      const antigo = ler(K.wid, null);
      if (antigo) { try { await BG.removeWatcher({ id: antigo }); } catch (e) {} }
      const id = await BG.addWatcher({
        backgroundTitle: 'JETCONTROL - rota ativa',
        backgroundMessage: 'Monitorando saída e chegada de casa',
        requestPermissions: true, stale: false, distanceFilter: DISTANCIA_FILTRO
      }, (loc, erro) => {
        if (erro) { console.warn('JetRota GPS', erro); log('ERRO GPS: ' + (erro.message || erro.code || JSON.stringify(erro))); return; }
        if (loc) processar({ lat: loc.latitude, lon: loc.longitude, acc: loc.accuracy, t: loc.time || Date.now() });
      });
      gravar(K.wid, id);
      log('monitoramento INICIADO (watcher ' + id + ')');
    } catch (e) { console.warn('JetRota: GPS em segundo plano indisponível', e); log('FALHA ao iniciar GPS: ' + (e && e.message || e)); }
  }
  async function parar() {
    const id = ler(K.wid, null);
    if (!nativo() || !id) return;
    try { await plug('BackgroundGeolocation').removeWatcher({ id }); } catch (e) {}
    gravar(K.wid, null);
  }

  // ---------------- API para a página rota.html ----------------
  window.JetRota = {
    diag: () => ler(K_DIAG, []), limparDiag: () => gravar(K_DIAG, []),
    PADRAO, cfg, estado, hist, nativo, haversine,
    salvarCfg(novo) { gravar(K.cfg, Object.assign(cfg(), novo)); },
    salvarHist(h) { gravar(K.dias, h); },
    reiniciarEstado() { gravar(K.est, { fase: 'em_casa' }); },
    async ativar(sim) { const c = cfg(); c.ativo = !!sim; gravar(K.cfg, c); if (sim) await iniciar(); else await parar(); },
    iniciar, parar, prepararNotificacoes,
    testarNotificacao: async () => { await prepararNotificacoes(); await notificar('JETCONTROL', 'Teste de notificação da rota', 'ROTA_SAIDA', {}); },
    processar, acao // (processar/acao também servem para simular trajetos em testes)
  };

  // ---------------- Integração com a página de Escalas ----------------
  // Mostra "Preencher com a rota de hoje" acima do horário de saída/km inicial e preenche os 4 campos.
  function integrarEscalas() {
    const saida = document.getElementById('horarioSaida');
    if (!saida || document.getElementById('bannerRotaHoje')) return;
    const bloco = saida.closest('div');
    if (!bloco || !bloco.parentElement) return;
    const faixa = document.createElement('div');
    faixa.id = 'bannerRotaHoje';
    faixa.className = 'col-span-full flex flex-wrap items-center justify-between gap-2 bg-slate-900/70 border border-slate-700 rounded-xl px-4 py-2.5 text-xs uppercase';
    faixa.innerHTML = '<span class="font-bold text-slate-300"><i class="fa-solid fa-route text-brand-500 mr-2"></i><span id="textoRotaHoje">ROTA AUTOMÁTICA</span></span>' +
      '<span class="flex gap-2"><button type="button" id="btnUsarRota" class="bg-brand-600 hover:bg-brand-500 text-white font-black px-3 py-1.5 rounded-lg">PREENCHER COM A ROTA</button>' +
      '<a href="rota.html" class="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-3 py-1.5 rounded-lg border border-slate-700">CONFIGURAR</a></span>';
    bloco.parentElement.insertBefore(faixa, bloco);
    const dataIso = () => {
      const v = (document.getElementById('dataAtividade') || {}).value || '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : diaChave(Date.now());
    };
    const atualizar = () => {
      const r = hist()[dataIso()], t = document.getElementById('textoRotaHoje'), b = document.getElementById('btnUsarRota');
      const ho = document.getElementById('chkHomeOffice');
      if (ho && !(ho.dataset.decidido === '1' && !ho.checked)) { t.textContent = 'ROTA: MARQUE HOME OFFICE = NÃO PARA USAR (HOME OFFICE NÃO GERA LOGÍSTICA)'; b.disabled = true; b.classList.add('opacity-40'); return; }
      if (r) { t.textContent = `ROTA: SAÍDA ${r.saidaHora || '--'} KM ${r.saidaKm != null ? r.saidaKm : '--'} • CHEGADA ${r.chegadaHora || '--'} KM ${r.chegadaKm != null ? r.chegadaKm : '--'}`; b.disabled = false; b.classList.remove('opacity-40'); }
      else { t.textContent = 'SEM ROTA REGISTRADA NESTE DIA'; b.disabled = true; b.classList.add('opacity-40'); }
    };
    document.getElementById('btnUsarRota').onclick = () => {
      const r = hist()[dataIso()]; if (!r || !hoNao()) return;
      const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && v !== '') { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } };
      set('horarioSaida', r.saidaHora); set('kmInicial', r.saidaKm); set('horarioChegada', r.chegadaHora); set('kmFinal', r.chegadaKm);
    };
    // Estado do Home Office: logística (horários/km) só existe quando a resposta é "NÃO" (decidido e desmarcado)
    const hoNao = () => { const c = document.getElementById('chkHomeOffice'); return !!c && c.dataset.decidido === '1' && !c.checked; };
    const campos = [['horarioSaida', 'saidaHora'], ['kmInicial', 'saidaKm'], ['horarioChegada', 'chegadaHora'], ['kmFinal', 'chegadaKm']];
    // Preenchimento automático: só campos VAZIOS (nunca sobrescreve o que você digitou)
    const autoPreencher = () => {
      const r = hist()[dataIso()]; if (!r || !hoNao()) return;
      campos.forEach(([id, k]) => {
        const el = document.getElementById(id);
        if (el && !el.disabled && el.value === '' && r[k] != null && r[k] !== '') {
          el.value = r[k]; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    };
    let ultimaChave = '';
    setInterval(() => {
      const chave = dataIso() + '|' + hoNao() + '|' + JSON.stringify(hist()[dataIso()] || null);
      if (chave !== ultimaChave) { ultimaChave = chave; atualizar(); autoPreencher(); }
    }, 800);
    atualizar();
    const dt = document.getElementById('dataAtividade'); if (dt) { dt.addEventListener('change', atualizar); dt.addEventListener('input', atualizar); }
    window.addEventListener('focus', atualizar);
  }

  // Esconde a tela de abertura assim que a página do site está pronta (não espera o tempo fixo)
  function esconderSplash() { try { if (nativo()) plug('SplashScreen').hide({ fadeOutDuration: 150 }); } catch (e) {} }
  function ini() { esconderSplash(); integrarEscalas(); iniciar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ini); else ini();
})();
