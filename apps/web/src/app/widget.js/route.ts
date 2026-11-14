/**
 * Script que la empresa pega en su sitio web:
 *
 *   <script src="https://<app>/widget.js" data-bot="bot_xxx" async></script>
 *
 * Modo protegido (widget_auth = 'token'): además hace falta un token temporal
 * que emite el servidor de la empresa con su clave secreta (POST /v1/widget-tokens):
 *   data-token="wt1…"            token ya generado al armar la página, o
 *   data-token-url="/chat-token"  URL del sitio de la empresa que devuelve {"token": "…"}
 *                                 (permite renovarlo cuando vence).
 * También se puede entregar después con window.RagWidget.setToken(token).
 *
 * Crea un botón flotante con el color del asistente que abre el chat en un
 * iframe (/embed/<clave>). El iframe solo se deja mostrar en los dominios
 * autorizados (Content-Security-Policy: frame-ancestors, ver proxy.ts).
 */
export function GET() {
  const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  const js = `(function () {
  var script = document.currentScript;
  if (!script || window.__ragWidgetLoaded) return;
  var key = script.getAttribute('data-bot');
  if (!key) { console.warn('[widget] Falta data-bot'); return; }
  window.__ragWidgetLoaded = true;
  var base = new URL(script.src).origin;
  var api = ${JSON.stringify(apiUrl)};
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var token = script.getAttribute('data-token') || '';
  var tokenUrl = script.getAttribute('data-token-url') || '';
  var frame = null;

  // Token del servidor de la empresa (modo protegido). Se pide a su propio sitio, con sus cookies.
  function fetchToken() {
    if (!tokenUrl) return Promise.resolve(token);
    return fetch(tokenUrl, { credentials: 'include' }).then(function (r) {
      if (!r.ok) throw new Error('No se pudo obtener el token del chat (' + r.status + ')');
      return r.headers.get('content-type') && r.headers.get('content-type').indexOf('json') >= 0
        ? r.json().then(function (j) { return j.token; })
        : r.text();
    }).then(function (t) { token = String(t || '').trim(); return token; });
  }
  function sendToken() {
    if (frame && frame.contentWindow && token) frame.contentWindow.postMessage({ type: 'rag-widget-token', token: token }, base);
  }
  window.RagWidget = {
    setToken: function (t) { token = String(t || ''); sendToken(); },
  };

  fetch(api + '/widget/' + key + '/config').then(function (r) {
    if (!r.ok) throw new Error('Chatbot no disponible');
    return r.json();
  }).then(function (cfg) {
    if (cfg.auth !== 'token') return mount(cfg);
    return fetchToken().then(function () {
      if (!token) throw new Error('Modo protegido: falta data-token o data-token-url (token emitido por tu servidor)');
      mount(cfg);
    });
  }).catch(function (e) { console.warn('[widget]', e.message); });

  function mount(cfg) {
    var color = /^#[0-9a-f]{6}$/i.test(cfg.primaryColor) ? cfg.primaryColor : '#0f172a';
    var root = document.createElement('div');
    root.style.cssText = 'position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;font-family:system-ui,sans-serif';

    frame = document.createElement('iframe');
    // El token va en el fragmento (#): no se envía al servidor ni queda en los registros.
    frame.src = base + '/embed/' + key + (token ? '#t=' + encodeURIComponent(token) : '');
    frame.title = cfg.name || 'Asistente';
    frame.allow = 'clipboard-write';
    frame.style.cssText = 'display:none;border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);' +
      'width:min(380px,calc(100vw - 40px));height:min(600px,calc(100vh - 110px));margin-bottom:12px;background:#fff';

    var button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Abrir chat con ' + (cfg.name || 'el asistente'));
    button.style.cssText = 'width:56px;height:56px;border-radius:50%;border:0;cursor:pointer;background:' + color +
      ';color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;float:' + side;
    var chatIcon = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    var closeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    button.innerHTML = chatIcon;

    var open = false;
    function toggle(value) {
      open = typeof value === 'boolean' ? value : !open;
      frame.style.display = open ? 'block' : 'none';
      button.innerHTML = open ? closeIcon : chatIcon;
      button.setAttribute('aria-expanded', String(open));
    }
    button.addEventListener('click', function () { toggle(); });
    window.addEventListener('message', function (e) {
      if (e.origin !== base) return;
      if (e.data === 'rag-widget-close') toggle(false);
      // El token venció: se pide uno nuevo al sitio de la empresa y se entrega al chat.
      if (e.data && e.data.type === 'rag-widget-token-expired') {
        fetchToken().then(sendToken).catch(function (err) { console.warn('[widget]', err.message); });
      }
    });

    root.appendChild(frame);
    root.appendChild(button);
    document.body.appendChild(root);
  }
})();`;

  return new Response(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
