/* ============================================================
   JETCONTROL 2026 — ALERTAS PADRONIZADOS (todas as páginas)
   ------------------------------------------------------------
   Uso:
     JetAlerta.mostrar('MENSAGEM')                         -> aviso (retorna Promise)
     JetAlerta.mostrar('MENSAGEM', 'Sucesso')              -> título "SUCESSO" (verde)
     JetAlerta.mostrar('MENSAGEM', 'Atenção', true)        -> confirmação (Promise<true|false>)
     JetAlerta.confirmar('MENSAGEM', 'Atenção', {perigo:true, textoOk:'EXCLUIR'})
     JetAlerta.perguntar('MENSAGEM', 'valor inicial')      -> Promise<texto|null>
     JetAlerta.perguntar('MENSAGEM', '10,00', 'Atenção', {teclado:'decimal'})  -> abre o teclado numérico
     JetAlerta.perguntar('MENSAGEM', '10,00', 'Atenção', {teclado:'decimal', moeda:true})  -> "R$ 10,00" com máscara automática
   alert() nativo é substituído automaticamente por este alerta.

   CORES (para mudar o tom, troque só o número da classe Tailwind abaixo):
     ATENÇÃO / avisos ........ amber-400
     SUCESSO ................. emerald-400
     ERRO / FALHA ............ red-400
   ============================================================ */
(function () {
  if (window.JetAlerta) return;

  var VARIANTES = {
    atencao: { titulo: 'text-amber-400', caixa: 'bg-amber-400/10 text-amber-400 border border-amber-400/30', icone: 'fa-triangle-exclamation' },
    sucesso: { titulo: 'text-emerald-400', caixa: 'bg-emerald-400/10 text-emerald-400 border border-emerald-400/30', icone: 'fa-circle-check' },
    erro:    { titulo: 'text-red-400', caixa: 'bg-red-400/10 text-red-400 border border-red-400/30', icone: 'fa-circle-xmark' }
  };
  var BTN_OK = 'bg-brand-600 hover:bg-brand-500 text-white';
  var BTN_PERIGO = 'bg-red-600 hover:bg-red-500 text-white';
  var BTN_CANCELAR = 'bg-slate-700 hover:bg-slate-600 text-slate-100';

  var raiz = null;
  var fila = Promise.resolve();

  function variante(titulo) {
    var t = String(titulo || '');
    if (/sucesso/i.test(t)) return VARIANTES.sucesso;
    if (/erro|falha/i.test(t)) return VARIANTES.erro;
    return VARIANTES.atencao;
  }

  function montar() {
    if (raiz && document.body.contains(raiz)) return raiz;
    raiz = document.createElement('div');
    raiz.id = 'jetAlertaRaiz';
    raiz.className = 'hidden fixed inset-0 z-[200] items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm uppercase';
    raiz.innerHTML =
      '<div data-caixa class="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4 transition duration-150 scale-95 opacity-0">' +
        '<div class="flex flex-col items-center justify-center gap-2 border-b border-slate-700 pb-3 text-center">' +
          '<div data-icone-caixa class="p-2.5 rounded-xl text-xl w-11 h-11 flex items-center justify-center"><i data-icone class="fa-solid"></i></div>' +
          '<h3 data-titulo class="text-base font-black tracking-wide"></h3>' +
        '</div>' +
        '<div data-msg class="text-sm text-slate-200 font-medium leading-relaxed text-justify whitespace-pre-line break-words"></div>' +
        '<input data-campo type="text" class="hidden w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-amber-400">' +
        '<div class="flex justify-end gap-3 pt-2">' +
          '<button type="button" data-cancelar class="hidden text-xs font-bold uppercase tracking-wider px-6 py-2.5 rounded-xl transition shadow-lg"></button>' +
          '<button type="button" data-ok class="text-xs font-bold uppercase tracking-wider px-6 py-2.5 rounded-xl transition shadow-lg"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(raiz);
    return raiz;
  }

  function exibir(cfg) {
    return new Promise(function (resolve) {
      var r = montar();
      var $ = function (s) { return r.querySelector(s); };
      var caixa = $('[data-caixa]'), btnOk = $('[data-ok]'), btnCan = $('[data-cancelar]'), campo = $('[data-campo]');
      var v = variante(cfg.titulo);

      $('[data-titulo]').className = 'text-base font-black tracking-wide ' + v.titulo;
      $('[data-titulo]').textContent = cfg.titulo || 'Atenção';
      $('[data-icone-caixa]').className = 'p-2.5 rounded-xl text-xl w-11 h-11 flex items-center justify-center ' + v.caixa;
      $('[data-icone]').className = 'fa-solid ' + v.icone;

      var msg = $('[data-msg]');
      if (cfg.html) msg.innerHTML = cfg.mensagem; else msg.textContent = cfg.mensagem == null ? '' : String(cfg.mensagem);

      campo.classList.toggle('hidden', !cfg.campo);
      campo.value = cfg.campo ? (cfg.valorInicial == null ? '' : String(cfg.valorInicial)) : '';
      // Teclado numérico no celular (opção "teclado: 'decimal'" ou 'numeric'); o campo continua aceitando vírgula
      if (cfg.teclado) { campo.setAttribute('inputmode', cfg.teclado); campo.setAttribute('autocomplete', 'off'); }
      else campo.removeAttribute('inputmode');

      // Máscara de moeda (opção "moeda: true"): "R$ " no início e formatação automática enquanto digita
      function mascara() {
        var d = campo.value.replace(/\D/g, '');
        campo.value = d ? 'R$ ' + (parseInt(d, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
      }
      if (cfg.campo && cfg.moeda) { campo.oninput = mascara; mascara(); } else campo.oninput = null;

      var pergunta = !!(cfg.confirmacao || cfg.campo);
      btnCan.classList.toggle('hidden', !pergunta);
      btnCan.className = (pergunta ? '' : 'hidden ') + 'text-xs font-bold uppercase tracking-wider px-6 py-2.5 rounded-xl transition shadow-lg ' + BTN_CANCELAR;
      btnCan.textContent = cfg.textoCancelar || 'Cancelar';
      btnOk.className = 'text-xs font-bold uppercase tracking-wider px-6 py-2.5 rounded-xl transition shadow-lg ' + (cfg.perigo ? BTN_PERIGO : BTN_OK);
      btnOk.textContent = cfg.textoOk || (pergunta ? 'Confirmar' : 'Entendido');

      r.classList.remove('hidden');
      r.classList.add('flex');
      setTimeout(function () {
        caixa.classList.remove('scale-95', 'opacity-0');
        caixa.classList.add('scale-100', 'opacity-100');
        try { (cfg.campo ? campo : btnOk).focus({ preventScroll: true }); if (cfg.campo) campo.select(); } catch (_) {}
      }, 10);

      var feito = false;
      function fechar(resultado) {
        if (feito) return;
        feito = true;
        document.removeEventListener('keydown', aoTeclar, true);
        caixa.classList.remove('scale-100', 'opacity-100');
        caixa.classList.add('scale-95', 'opacity-0');
        setTimeout(function () {
          r.classList.add('hidden');
          r.classList.remove('flex');
          resolve(resultado);
        }, 150);
      }
      function ok() {
        if (cfg.campo) fechar(campo.value);
        else fechar(cfg.confirmacao ? true : undefined);
      }
      function cancelar() { fechar(cfg.campo ? null : (cfg.confirmacao ? false : undefined)); }
      function aoTeclar(e) {
        if (e.key === 'Escape') { e.preventDefault(); cancelar(); }
        else if (e.key === 'Enter' && document.activeElement !== btnCan) { e.preventDefault(); ok(); }
      }
      btnOk.onclick = ok;
      btnCan.onclick = cancelar;
      document.addEventListener('keydown', aoTeclar, true);
    });
  }

  // Serializa os alertas: se vários forem pedidos juntos, aparecem um após o outro
  function enfileirar(cfg) {
    var p = fila.then(function () { return exibir(cfg); });
    fila = p.catch(function () {});
    return p;
  }

  window.JetAlerta = {
    mostrar: function (mensagem, titulo, confirmacao, opcoes) {
      return enfileirar(Object.assign({ mensagem: mensagem, titulo: titulo || 'Atenção', confirmacao: !!confirmacao }, opcoes || {}));
    },
    confirmar: function (mensagem, titulo, opcoes) {
      return enfileirar(Object.assign({ mensagem: mensagem, titulo: titulo || 'Atenção', confirmacao: true }, opcoes || {}));
    },
    perguntar: function (mensagem, valorInicial, titulo, opcoes) {
      return enfileirar(Object.assign({ mensagem: mensagem, titulo: titulo || 'Atenção', campo: true, valorInicial: valorInicial }, opcoes || {}));
    }
  };

  // alert() nativo passa a usar o alerta padronizado (não bloqueia a execução)
  window.alert = function (mensagem) { window.JetAlerta.mostrar(mensagem); };
})();
