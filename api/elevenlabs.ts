import type { VercelRequest, VercelResponse } from '@vercel/node';

const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';

/**
 * ElevenLabs API Proxy para Vercel Serverless Functions
 * 
 * Este endpoint actúa como proxy para la API de ElevenLabs.
 * La ruta de ElevenLabs se pasa como query parameter 'endpoint'
 * 
 * Uso:
 * - POST /api/elevenlabs?endpoint=v1/text-to-speech/{voice_id}
 * 
 * Documentación: https://elevenlabs.io/docs/api-reference/text-to-speech
 */

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`[${requestId}] [ElevenLabs Proxy] ${req.method} ${req.url}`);

  // Configurar CORS
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
  const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVENLABS_API_KEY) {
    console.error(`[${requestId}] ❌ ELEVENLABS_API_KEY not configured`);
    return res.status(500).json({ 
      error: 'ELEVENLABS_API_KEY not configured on server',
      message: 'Please configure ELEVENLABS_API_KEY in Vercel environment variables',
      requestId
    });
  }

  try {
    // Obtener el endpoint de ElevenLabs del query parameter
    const elevenlabsEndpoint = req.query.endpoint as string;

    console.log(`[${requestId}] Endpoint from query:`, elevenlabsEndpoint);
    
    // Health check para el proxy mismo
    if (!elevenlabsEndpoint || elevenlabsEndpoint === 'health' || elevenlabsEndpoint === 'ping') {
      return res.status(200).json({ 
        status: 'ok', 
        service: 'elevenlabs-proxy-vercel',
        apiKeyConfigured: !!ELEVENLABS_API_KEY
      });
    }

    const fullUrl = `${ELEVENLABS_BASE_URL}/${elevenlabsEndpoint}`;
    console.log(`[${requestId}] Proxying to: ${req.method} ${fullUrl}`);

    // Preparar headers
    const headers: Record<string, string> = {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    };

    // Preparar body para POST requests
    let body: string | undefined;
    if ((req.method === 'POST' || req.method === 'PUT') && req.body) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      console.log(`[${requestId}] Request body size: ${body.length} chars`);
    }

    // Hacer la request a ElevenLabs
    const fetchStartTime = Date.now();
    const response = await fetch(fullUrl, {
      method: req.method,
      headers,
      body,
    });

    const fetchDuration = Date.now() - fetchStartTime;
    console.log(`[${requestId}] ElevenLabs response: ${response.status} (${fetchDuration}ms)`);

    const contentType = response.headers.get('content-type');

    // Si es audio, convertir a base64 y retornar
    if (contentType && (contentType.includes('audio/') || contentType.includes('application/octet-stream'))) {
      const arrayBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(arrayBuffer).toString('base64');
      
      // Intentar obtener la duración del header si está disponible
      const durationHeader = response.headers.get('x-audio-duration');
      const duration = durationHeader ? parseFloat(durationHeader) : undefined;
      
      const totalDuration = Date.now() - startTime;
      console.log(`[${requestId}] ✅ Audio generated in ${totalDuration}ms (${arrayBuffer.byteLength} bytes)`);

      return res.status(200).json({
        audio: base64Audio,
        format: 'mp3',
        contentType: contentType,
        duration: duration,
        size: arrayBuffer.byteLength
      });
    }

    // Si es JSON, retornar directamente
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      
      const totalDuration = Date.now() - startTime;
      console.log(`[${requestId}] ✅ Request completed in ${totalDuration}ms`);

      return res.status(response.status).json(data);
    }

    // Otro tipo de respuesta
    const text = await response.text();
    
    const totalDuration = Date.now() - startTime;
    console.log(`[${requestId}] ✅ Request completed in ${totalDuration}ms`);

    return res.status(response.status).send(text);

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

