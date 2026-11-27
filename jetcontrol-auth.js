/* JETCONTROL - LOGIN COM GOOGLE (somente o dono)
 * Carregado em <head> de TODAS as páginas, ANTES do jetcontrol-sync.js.
 * 1) Esconde a página até o login do dono (conta = EMAIL_DONO).
 * 2) Entrega o token ao jetcontrol-sync.js, e as REGRAS DO FIRESTORE (firestore.rules) só aceitam esse e-mail.
 *    A proteção de verdade está nas regras do Firestore; esta tela é a porta de entrada.
 */
(function () {
  if (window.JetAuthPronto) return;

  // ===================== PREENCHA (Firebase Console > Configurações do projeto > Seus apps > App da Web) =====================
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDlTxHRa7VMlnZ8kYkcZQJ17jbLxwLxnFk',
    authDomain: 'jetcontrol-2026-desmonte.firebaseapp.com',
    projectId: 'jetcontrol-2026-desmonte',
    appId: '1:486182439975:web:6ca96d700774c0c495d202'
  };
  const EMAIL_DONO = 'dxm.sistemas.apps@gmail.com';   // o único e-mail Google autorizado
  // ID do cliente Web do Google (termina em .apps.googleusercontent.com). Firebase > Authentication > Método de login > Google >
  // "Configuração do SDK da Web" > ID do cliente da Web. Usado no login pelo navegador (evita o erro "missing initial state").
  const GOOGLE_WEB_CLIENT_ID = '486182439975-3rjl5cavn5im71bugigdrdfqb4fkhfbi.apps.googleusercontent.com';
  // ================================================================================================================
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

  let tokenAtual = null;
  let liberar;
  window.JetAuthPronto = new Promise(r => { liberar = r; });
  window.JetAuthTokenAtual = () => tokenAtual;
  window.JetAuthSair = async () => { try { await firebase.auth().signOut(); } catch (e) {} tokenAtual = null; location.reload(); };

  // Aparelho já autorizado antes ("lembrado"): a página abre na hora, sem tela de verificação; o login é conferido em segundo plano.
  // (Só esconde a interface; a proteção real dos dados na nuvem são as regras do Firestore.)
  const CHAVE_OK = 'jcauth_ok'; // sem o prefixo "jetcontrol_" para não ser enviada à nuvem
  const lerOk = () => { try { return localStorage.getItem(CHAVE_OK) === EMAIL_DONO.toLowerCase(); } catch (e) { return false; } };
  const gravarOk = (sim) => { try { if (sim) localStorage.setItem(CHAVE_OK, EMAIL_DONO.toLowerCase()); else localStorage.removeItem(CHAVE_OK); } catch (e) {} };
  const lembrado = lerOk();
  function esconder() {
    if (document.getElementById('jcAuthCss')) return;
    const css = document.createElement('style');
    css.id = 'jcAuthCss';
    css.textContent = 'body>*:not(#jcLogin){display:none!important}body{background:#0f172a!important}';
    (document.head || document.documentElement).appendChild(css);
  }
  if (!lembrado) esconder();

  const nativo = () => !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
  const plugNativo = () => { const C = window.Capacitor || {}; return typeof C.registerPlugin === 'function' ? C.registerPlugin('FirebaseAuthentication') : (C.Plugins || {}).FirebaseAuthentication; };

  function tela(msg, mostrarBotao) {
    const montar = () => {
      let d = document.getElementById('jcLogin');
      if (!d) {
        d = document.createElement('div'); d.id = 'jcLogin';
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center';
        document.body.appendChild(d);
      }
      d.innerHTML = '<div style="max-width:340px"><div style="font-size:26px;font-weight:900;letter-spacing:.04em;margin-bottom:6px">JETCONTROL</div>' +
        '<div id="jcMsg" style="font-size:13px;color:#94a3b8;margin-bottom:18px;text-transform:uppercase;font-weight:700"></div>' +
        (mostrarBotao ? '<button id="jcBtnGoogle" style="background:#fff;color:#1f2937;font-weight:800;border:0;border-radius:12px;padding:12px 20px;font-size:14px;cursor:pointer">ENTRAR COM GOOGLE</button>' : '') + '</div>';
      document.getElementById('jcMsg').textContent = msg;
      const b = document.getElementById('jcBtnGoogle'); if (b) b.onclick = entrar;
      // Navegador: botão oficial do Google (Google Identity Services) — não depende do popup do firebaseapp.com
      if (b && usaGis() && window.google && google.accounts && google.accounts.id) {
        const caixa = document.createElement('div'); caixa.id = 'jcGsi'; caixa.style.cssText = 'display:flex;justify-content:center';
        b.replaceWith(caixa);
        google.accounts.id.renderButton(caixa, { type: 'standard', theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'pt-BR' });
      }
    };
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
  }
  function liberarPagina() {
    const d = document.getElementById('jcLogin'); if (d) d.remove();
    const c = document.getElementById('jcAuthCss'); if (c) c.remove();
  }
  function carregarScript(src) { return new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error('falha ao carregar ' + src)); document.head.appendChild(s); }); }

  const usaGis = () => !nativo() && GOOGLE_WEB_CLIENT_ID.indexOf('COLOQUE') !== 0;
  async function entrarComCredencialGoogle(resp) {
    try {
      tela('ENTRANDO...', false);
      await firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(resp.credential));
    } catch (e) { console.warn('JetAuth GIS', e); tela('NÃO FOI POSSÍVEL ENTRAR: ' + (e && (e.message || e.code) || e), true); }
  }

  async function entrar() {
    try {
      tela('ENTRANDO...', false);
      const auth = firebase.auth();
      const plug = nativo() ? plugNativo() : null;
      if (plug) {
        const r = await plug.signInWithGoogle({ skipNativeAuth: true });
        const idToken = r && r.credential && r.credential.idToken;
        if (!idToken) throw new Error('Google não devolveu o token');
        await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(idToken));
      } else if (nativo()) {
        // No app, popup/redirect do Google não funciona (tela branca). Exige o plugin nativo no APK.
        throw new Error('o APK não tem o plugin de login Google (FirebaseAuthentication). Gere o APK de novo com o google-services.json.');
      } else {
        const prov = new firebase.auth.GoogleAuthProvider(); prov.setCustomParameters({ prompt: 'select_account' });
        await auth.signInWithPopup(prov);
      }
    } catch (e) {
      console.warn('JetAuth', e);
      tela('NÃO FOI POSSÍVEL ENTRAR: ' + (e && (e.message || e.code) || e), true);
    }
  }

  async function iniciar() {
    if (FIREBASE_CONFIG.apiKey.indexOf('COLOQUE') === 0 || EMAIL_DONO.indexOf('COLOQUE') === 0) { tela('LOGIN NÃO CONFIGURADO: PREENCHA O jetcontrol-auth.js', false); return; }
    if (!lembrado) tela('VERIFICANDO ACESSO...', false);
    try {
      await carregarScript(SDK + 'firebase-app-compat.js');
      await carregarScript(SDK + 'firebase-auth-compat.js');
      firebase.initializeApp(FIREBASE_CONFIG);
      if (usaGis()) {
        try {
          await carregarScript('https://accounts.google.com/gsi/client');
          google.accounts.id.initialize({ client_id: GOOGLE_WEB_CLIENT_ID, callback: entrarComCredencialGoogle, auto_select: false, use_fedcm_for_prompt: true });
        } catch (e) { console.warn('JetAuth: Google Identity Services indisponível, usando popup', e); }
      }
    } catch (e) { if (lembrado) { liberar(); return; } tela('SEM CONEXÃO COM O LOGIN. VERIFIQUE A INTERNET.', false); return; }
    const auth = firebase.auth();
    auth.onAuthStateChanged(async (u) => {
      if (!u) { tokenAtual = null; gravarOk(false); esconder(); tela('ACESSO RESTRITO', true); return; }
      if ((u.email || '').toLowerCase() !== EMAIL_DONO.toLowerCase() || !u.emailVerified) {
        await auth.signOut(); gravarOk(false); esconder(); tela('CONTA NÃO AUTORIZADA: ' + (u.email || ''), true); return;
      }
      try { tokenAtual = await u.getIdToken(); } catch (e) { tokenAtual = null; } // offline: abre com os dados do aparelho
      gravarOk(true); liberarPagina(); liberar();
    });
    auth.onIdTokenChanged(async (u) => { if (u) { try { tokenAtual = await u.getIdToken(); } catch (e) {} } });
    setInterval(async () => { const u = auth.currentUser; if (u) { try { tokenAtual = await u.getIdToken(true); } catch (e) {} } }, 45 * 60 * 1000);
  }
  iniciar();
})();
