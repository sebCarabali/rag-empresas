import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/auth/callback'];
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

/**
 * El widget (/embed/<clave>) solo se puede mostrar dentro de los sitios que
 * la empresa autorizó: se envía Content-Security-Policy frame-ancestors con
 * esos dominios. Si el chatbot no existe o está desactivado, no se puede
 * insertar en ningún sitio.
 */
async function embedResponse(request: NextRequest, publicKey: string) {
  let ancestors = "'none'";
  try {
    const res = await fetch(`${API_URL}/widget/${encodeURIComponent(publicKey)}/config`, {
      next: { revalidate: 60 },
    });
    if (res.ok) {
      const cfg = (await res.json()) as { allowedOrigins?: string[] };
      const origins = (cfg.allowedOrigins ?? []).filter((o) => /^https?:\/\/[^\s;'"]+$/.test(o));
      ancestors = ["'self'", ...origins].join(' ');
    }
  } catch {
    // sin configuración no se permite insertar
  }
  const response = NextResponse.next({ request });
  response.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`);
  return response;
}

/**
 * Refresca la sesión de Supabase en cada navegación y protege las rutas
 * privadas. La autorización real de los datos la hacen la API y RLS.
 */
export async function proxy(request: NextRequest) {
  const { pathname: path } = request.nextUrl;
  // Rutas públicas del widget: sin sesión ni cookies.
  if (path === '/widget.js') return NextResponse.next({ request });
  const embed = /^\/embed\/([^/]+)\/?$/.exec(path);
  if (embed) return embedResponse(request, embed[1]);

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // getClaims valida el JWT; no usar getSession() en el servidor.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);
  const { pathname } = request.nextUrl;

  if (!isLoggedIn && !PUBLIC_PATHS.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && (pathname === '/login' || pathname === '/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
