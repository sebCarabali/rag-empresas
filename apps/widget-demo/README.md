# Página de prueba del widget

Sitio estático que simula la web de una empresa (marca ficticia) para validar el
widget del asistente desde **otro dominio**, como lo usaría un cliente real.

- Proyecto de Vercel independiente (`rootDirectory: apps/widget-demo`, sin build).
- Parámetros por URL: `?bot=bot_xxx&app=https://<app-web>&api=https://<api>&pos=right|left`.
- Diagnóstico paso a paso: descarga de `widget.js`, configuración pública del
  chatbot, botón insertado, chat cargado en el iframe (mensaje `rag-widget-ready`)
  y dominio autorizado (CSP `frame-ancestors`).

Para que el chat se muestre, en **Asistente y widget** del proyecto hay que
activar el widget y agregar el dominio de esta página en *Dominios autorizados*.
