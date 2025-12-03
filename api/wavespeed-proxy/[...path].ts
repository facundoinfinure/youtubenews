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
 */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Configurar CORS
  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
    ...(process.env.VITE_VERCEL_URL ? [process.env.VITE_VERCEL_URL] : []),
  ].filter(Boolean);

  if (origin && (allowedOrigins.includes(origin) || origin.includes('.vercel.app'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Manejar preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verificar API key
  const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
  if (!WAVESPEED_API_KEY) {
    console.error('❌ WAVESPEED_API_KEY not configured');
    return res.status(500).json({ 
      error: 'WAVESPEED_API_KEY not configured on server',
      message: 'Please configure WAVESPEED_API_KEY in Vercel environment variables'
    });
  }

  try {
    // Extraer el path del query parameter
    // Con api/wavespeed-proxy/[...path].ts, el path será ['v1', 'tasks'] para /api/wavespeed-proxy/v1/tasks
    const path = req.query.path as string | string[];
    const wavespeedPath = Array.isArray(path) ? path.join('/') : path || '';

    if (!wavespeedPath) {
      return res.status(400).json({ 
        error: 'Path required',
        message: 'Please provide a Wavespeed API path'
      });
    }

    const fullUrl = `${WAVESPEED_BASE_URL}/${wavespeedPath}`;

    console.log(`[Wavespeed Proxy] ${req.method} ${fullUrl}`);

    // Preparar headers
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Preparar body para POST/PUT requests
    let body: string | undefined;
    if ((req.method === 'POST' || req.method === 'PUT') && req.body) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    // Hacer la request a Wavespeed
    const response = await fetch(fullUrl, {
      method: req.method,
      headers,
      body,
    });

    const contentType = response.headers.get('content-type');
    let data: any;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Retornar la respuesta con el mismo status code
    return res.status(response.status).json(data);

  } catch (error: any) {
    console.error('[Wavespeed Proxy] Error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: error.toString()
    });
  }
}
