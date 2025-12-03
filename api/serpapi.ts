import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * SerpAPI Proxy para Vercel Serverless Functions
 * 
 * Búsqueda de noticias usando Google News via SerpAPI
 * 
 * Uso:
 * - GET /api/serpapi?q=bitcoin&gl=us&hl=en
 * - GET /api/serpapi?q=economia+argentina&gl=ar&hl=es
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
    searchParams.set('engine', 'google_news');
    
    // Query de búsqueda
    const query = req.query.q as string;
    if (!query) {
      return res.status(400).json({ error: 'Missing required parameter: q (search query)' });
    }
    searchParams.set('q', query);
    
    // Parámetros opcionales
    if (req.query.gl) searchParams.set('gl', req.query.gl as string); // Country (us, ar, mx, etc.)
    if (req.query.hl) searchParams.set('hl', req.query.hl as string); // Language (en, es, etc.)
    if (req.query.num) searchParams.set('num', req.query.num as string); // Number of results
    
    // Filtro de tiempo (tbs parameter)
    // qdr:d = past day, qdr:w = past week, qdr:m = past month
    if (req.query.tbs) {
      searchParams.set('tbs', req.query.tbs as string);
    } else {
      // Por defecto, noticias del último día
      searchParams.set('tbs', 'qdr:d');
    }

    const fullUrl = `${SERPAPI_BASE_URL}?${searchParams.toString()}`;
    console.log(`[${requestId}] Searching: q="${query}", gl=${req.query.gl || 'us'}, hl=${req.query.hl || 'en'}`);

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
