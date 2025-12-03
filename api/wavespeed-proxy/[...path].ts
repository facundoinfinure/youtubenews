import type { VercelRequest, VercelResponse } from '@vercel/node';

const WAVESPEED_BASE_URL = 'https://api.wavespeed.ai';

/**
 * Wavespeed API Proxy para Vercel Serverless Functions
 * 
 * Este endpoint actúa como proxy dinámico para todas las rutas de Wavespeed.
 * 
 * Uso:
 * - POST /api/wavespeed-proxy/v1/tasks
 * - GET /api/wavespeed-proxy/v1/tasks/:taskId
 * - POST /api/wavespeed-proxy/api/v3/google/nano-banana-pro/edit
 * - GET /api/wavespeed-proxy/api/v3/predictions/:taskId/result
 * 
 * NOTA: Si este endpoint no funciona en producción, considera usar el backend separado
 * en la carpeta backend/ que puede desplegarse en Railway, Render, o Fly.io
 */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`[${requestId}] [Wavespeed Proxy] ${req.method} ${req.url}`);

  // Configurar CORS
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    process.env.VERCEL ? `https://${process.env.VERCEL}` : '',
    ...(process.env.VITE_VERCEL_URL ? [process.env.VITE_VERCEL_URL] : []),
  ].filter(Boolean);

  if (origin && (allowedOrigins.includes(origin) || origin.includes('.vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    console.log(`[${requestId}] CORS allowed for origin: ${origin}`);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
    console.log(`[${requestId}] CORS set to * (no matching origin found)`);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Manejar preflight requests
  if (req.method === 'OPTIONS') {
    console.log(`[${requestId}] OPTIONS preflight request`);
    return res.status(200).end();
  }

  // Verificar API key
  const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
  if (!WAVESPEED_API_KEY) {
    console.error(`[${requestId}] ❌ WAVESPEED_API_KEY not configured`);
    return res.status(500).json({ 
      error: 'WAVESPEED_API_KEY not configured on server',
      message: 'Please configure WAVESPEED_API_KEY in Vercel environment variables',
      requestId
    });
  }

  try {
    // Extraer el path del query parameter
    // Con api/wavespeed-proxy/[...path].ts, el path será ['v1', 'tasks'] para /api/wavespeed-proxy/v1/tasks
    const path = req.query.path as string | string[];
    const wavespeedPath = Array.isArray(path) ? path.join('/') : path || '';

    console.log(`[${requestId}] Path extracted:`, { 
      raw: req.query.path, 
      processed: wavespeedPath,
      queryKeys: Object.keys(req.query),
      url: req.url
    });
    
    // Health check para el proxy mismo
    if (wavespeedPath === 'health' || wavespeedPath === 'ping') {
      return res.status(200).json({ status: 'ok', service: 'wavespeed-proxy-vercel' });
    }

    if (!wavespeedPath) {
      console.error(`[${requestId}] ❌ No path provided in request`);
      return res.status(400).json({ 
        error: 'Path required',
        message: 'Please provide a Wavespeed API path',
        requestId,
        query: req.query
      });
    }

    const fullUrl = `${WAVESPEED_BASE_URL}/${wavespeedPath}`;
    console.log(`[${requestId}] Proxying to: ${req.method} ${fullUrl}`);

    // Preparar headers
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Preparar body para POST/PUT requests
    let body: string | undefined;
    if ((req.method === 'POST' || req.method === 'PUT') && req.body) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      console.log(`[${requestId}] Request body size: ${body.length} chars`);
    }

    // Hacer la request a Wavespeed
    const fetchStartTime = Date.now();
    const response = await fetch(fullUrl, {
      method: req.method,
      headers,
      body,
    });

    const fetchDuration = Date.now() - fetchStartTime;
    console.log(`[${requestId}] Wavespeed response: ${response.status} (${fetchDuration}ms)`);

    const contentType = response.headers.get('content-type');
    let data: any;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[${requestId}] ✅ Request completed in ${totalDuration}ms`);

    // Retornar la respuesta con el mismo status code
    return res.status(response.status).json(data);

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error(`[${requestId}] ❌ Error after ${totalDuration}ms:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.toString() : undefined,
      requestId
    });
  }
}
