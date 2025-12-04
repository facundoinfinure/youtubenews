import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * SerpAPI Proxy para Vercel Serverless Functions
 * 
 * Búsqueda de noticias usando Google News via SerpAPI
 * 
 * Uso con query:
 * - GET /api/serpapi?q=bitcoin&gl=us&hl=en
 * - GET /api/serpapi?q=economia+argentina&gl=ar&hl=es
 * 
 * Uso con topic_token (para noticias por tópico como Business, Technology, etc.):
 * - GET /api/serpapi?engine=google_news&topic_token=CAAq...&gl=us&hl=en
 */

const SERPAPI_BASE_URL = 'https://serpapi.com/search.json';

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).substring(7);
  
  console.log(`[${requestId}] [SerpAPI Proxy] ${req.method} ${req.url}`);

  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Verificar API key
  const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
  if (!SERPAPI_API_KEY) {
    console.error(`[${requestId}] ❌ SERPAPI_API_KEY not configured`);
    return res.status(500).json({ 
      error: 'SERPAPI_API_KEY not configured on server',
      message: 'Please configure SERPAPI_API_KEY in Vercel environment variables',
      requestId
    });
  }

  try {
    // Health check
    if (req.query.health === 'true') {
      return res.status(200).json({ 
        status: 'ok', 
        service: 'serpapi-proxy-vercel',
        apiKeyConfigured: !!SERPAPI_API_KEY
      });
    }

    // Construir URL con parámetros
    const searchParams = new URLSearchParams();
    
    // Parámetros requeridos
    searchParams.set('api_key', SERPAPI_API_KEY);
    
    // Engine (default: google_news)
    const engine = (req.query.engine as string) || 'google_news';
    searchParams.set('engine', engine);
    
    // Obtener query y topic_token
    const query = req.query.q as string;
    const topicToken = req.query.topic_token as string;
    
    // Debe tener al menos q o topic_token
    if (!query && !topicToken) {
      return res.status(400).json({ 
        error: 'Missing required parameter: q (search query) or topic_token',
        message: 'Provide either q for search or topic_token for topic-based news'
      });
    }
    
    // Si hay query, usarla
    if (query) {
      searchParams.set('q', query);
    }
    
    // Si hay topic_token, usarlo (para noticias por tópico)
    if (topicToken) {
      searchParams.set('topic_token', topicToken);
    }
    
    // Parámetros opcionales
    if (req.query.gl) searchParams.set('gl', req.query.gl as string); // Country (us, ar, mx, etc.)
    if (req.query.hl) searchParams.set('hl', req.query.hl as string); // Language (en, es, etc.)
    if (req.query.num) searchParams.set('num', req.query.num as string); // Number of results
    
    // Filtro de tiempo (tbs parameter) - solo para búsquedas con q, no para topic_token
    if (query) {
      if (req.query.tbs) {
        searchParams.set('tbs', req.query.tbs as string);
      } else {
        // Por defecto, noticias del último día (solo para búsquedas)
        searchParams.set('tbs', 'qdr:d');
      }
    }

    const fullUrl = `${SERPAPI_BASE_URL}?${searchParams.toString()}`;
    const logMsg = topicToken 
      ? `topic_token=${topicToken.substring(0, 20)}...` 
      : `q="${query}"`;
    console.log(`[${requestId}] Searching: ${logMsg}, gl=${req.query.gl || 'us'}, hl=${req.query.hl || 'en'}`);

    const fetchStartTime = Date.now();
    const response = await fetch(fullUrl);
    const fetchDuration = Date.now() - fetchStartTime;
    
    console.log(`[${requestId}] SerpAPI response: ${response.status} (${fetchDuration}ms)`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${requestId}] ❌ SerpAPI error:`, errorText);
      return res.status(response.status).json({ 
        error: 'SerpAPI request failed',
        details: errorText,
        requestId
      });
    }

    const data = await response.json();
    
    // Extraer solo las noticias relevantes para reducir payload
    const newsResults = data.news_results || [];
    const topStories = data.top_stories || [];
    
    const totalDuration = Date.now() - startTime;
    console.log(`[${requestId}] ✅ Found ${newsResults.length} news + ${topStories.length} top stories (${totalDuration}ms)`);

    return res.status(200).json({
      news_results: newsResults,
      top_stories: topStories,
      search_metadata: data.search_metadata,
      requestId
    });

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
