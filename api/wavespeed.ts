import type { VercelRequest, VercelResponse } from '@vercel/node';

const WAVESPEED_BASE_URL = 'https://api.wavespeed.ai';

/**
 * Wavespeed API Proxy para Vercel Serverless Functions
 * 
 * Este endpoint actúa como proxy para la API de Wavespeed.
 * La ruta de Wavespeed se pasa como query parameter 'path'
 * 
 * Uso:
 * - POST /api/wavespeed?path=api/v3/wavespeed-ai/wan-2.1/i2v-720p
 * - GET /api/wavespeed?path=api/v3/predictions/{taskId}/result
 * 
 * Documentación: https://wavespeed.ai/docs/docs
 */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`[${requestId}] [Wavespeed Proxy] ${req.method} ${req.url}`);

  // Configurar CORS - permitir todas las origenes para simplificar
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    // Obtener el path de Wavespeed del query parameter
    const wavespeedPath = req.query.path as string;

    console.log(`[${requestId}] Path from query:`, wavespeedPath);
    
    // Health check para el proxy mismo
    if (!wavespeedPath || wavespeedPath === 'health' || wavespeedPath === 'ping') {
      return res.status(200).json({ 
        status: 'ok', 
        service: 'wavespeed-proxy-vercel',
        apiKeyConfigured: !!WAVESPEED_API_KEY
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
