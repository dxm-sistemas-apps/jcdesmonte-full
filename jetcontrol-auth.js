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
  // ================================================================================================================
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

  let tokenAtual = null;
  let liberar;
  window.JetAuthPronto = new Promise(r => { liberar = r; });
  window.JetAuthTokenAtual = () => tokenAtual;
  window.JetAuthSair = async () => { try { await firebase.auth().signOut(); } catch (e) {} tokenAtual = null; location.reload(); };

  // Esconde tudo até autorizar
  const css = document.createElement('style');
  css.id = 'jcAuthCss';
  css.textContent = 'body>*:not(#jcLogin){display:none!important}body{background:#0f172a!important}';
  (document.head || document.documentElement).appendChild(css);

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
    };
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar);
  }
  function liberarPagina() {
    const d = document.getElementById('jcLogin'); if (d) d.remove();
    const c = document.getElementById('jcAuthCss'); if (c) c.remove();
  }
  function carregarScript(src) { return new Promise((ok, err) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => err(new Error('falha ao carregar ' + src)); document.head.appendChild(s); }); }

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
    tela('VERIFICANDO ACESSO...', false);
    try {
      await carregarScript(SDK + 'firebase-app-compat.js');
      await carregarScript(SDK + 'firebase-auth-compat.js');
      firebase.initializeApp(FIREBASE_CONFIG);
    } catch (e) { tela('SEM CONEXÃO COM O LOGIN. VERIFIQUE A INTERNET.', false); return; }
    const auth = firebase.auth();
    auth.onAuthStateChanged(async (u) => {
      if (!u) { tokenAtual = null; tela('ACESSO RESTRITO', true); return; }
      if ((u.email || '').toLowerCase() !== EMAIL_DONO.toLowerCase() || !u.emailVerified) {
        await auth.signOut(); tela('CONTA NÃO AUTORIZADA: ' + (u.email || ''), true); return;
      }
      try { tokenAtual = await u.getIdToken(); } catch (e) { tokenAtual = null; } // offline: abre com os dados do aparelho
      liberarPagina(); liberar();
    });
    auth.onIdTokenChanged(async (u) => { if (u) { try { tokenAtual = await u.getIdToken(); } catch (e) {} } });
    setInterval(async () => { const u = auth.currentUser; if (u) { try { tokenAtual = await u.getIdToken(true); } catch (e) {} } }, 45 * 60 * 1000);
  }
  iniciar();
})();
