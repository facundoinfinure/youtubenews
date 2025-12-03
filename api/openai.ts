import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * OpenAI API Proxy para Vercel Serverless Functions
 * 
 * Soporta:
 * - Chat Completions (GPT-4o, GPT-4o-mini)
 * - Text-to-Speech (TTS)
 * - Image Generation (DALL-E 3)
 * 
 * Uso:
 * - POST /api/openai?endpoint=chat/completions
 * - POST /api/openai?endpoint=audio/speech
 * - POST /api/openai?endpoint=images/generations
 */

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`[${requestId}] [OpenAI Proxy] ${req.method} ${req.url}`);

  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Manejar preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verificar API key
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    console.error(`[${requestId}] ❌ OPENAI_API_KEY not configured`);
    return res.status(500).json({ 
      error: 'OPENAI_API_KEY not configured on server',
      message: 'Please configure OPENAI_API_KEY in Vercel environment variables',
      requestId
    });
  }

  try {
    // Obtener el endpoint de OpenAI del query parameter
    const endpoint = req.query.endpoint as string;

    console.log(`[${requestId}] Endpoint:`, endpoint);
    
    // Health check
    if (!endpoint || endpoint === 'health' || endpoint === 'ping') {
      return res.status(200).json({ 
        status: 'ok', 
        service: 'openai-proxy-vercel',
        apiKeyConfigured: !!OPENAI_API_KEY
      });
    }

    const fullUrl = `${OPENAI_BASE_URL}/${endpoint}`;
    console.log(`[${requestId}] Proxying to: ${req.method} ${fullUrl}`);

    // Preparar headers
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    };

    // Preparar body
    let body: string | undefined;
    if (req.method === 'POST' && req.body) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      console.log(`[${requestId}] Request body size: ${body.length} chars`);
    }

    // Hacer la request a OpenAI
    const fetchStartTime = Date.now();
    const response = await fetch(fullUrl, {
      method: req.method,
      headers,
      body,
    });

    const fetchDuration = Date.now() - fetchStartTime;
    console.log(`[${requestId}] OpenAI response: ${response.status} (${fetchDuration}ms)`);

    // Para TTS, la respuesta es audio binario
    if (endpoint === 'audio/speech') {
      const audioBuffer = await response.arrayBuffer();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');
      
      const totalDuration = Date.now() - startTime;
      console.log(`[${requestId}] ✅ TTS completed in ${totalDuration}ms`);
      
      return res.status(response.status).json({
        audio: base64Audio,
        format: 'mp3'
      });
    }

    // Para otros endpoints, respuesta JSON
    const contentType = response.headers.get('content-type');
    let data: any;

    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[${requestId}] ✅ Request completed in ${totalDuration}ms`);

    return res.status(response.status).json(data);

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    console.error(`[${requestId}] ❌ Error after ${totalDuration}ms:`, {
      message: error.message,
      stack: error.stack,
    });
    
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      requestId
    });
  }
}
