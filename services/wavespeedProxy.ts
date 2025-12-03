/**
 * Wavespeed API Proxy Service
 * 
 * IMPORTANT: Wavespeed API has CORS restrictions and cannot be called directly from the browser.
 * This service provides helper functions and error handling, but actual API calls should be made
 * from a backend server or through a proxy.
 * 
 * For production, you need to:
 * 1. Create a backend API endpoint that proxies requests to Wavespeed
 * 2. Update the API URLs in this file to point to your backend proxy
 * 3. Ensure your backend has the WAVESPEED_API_KEY environment variable
 */

const getWavespeedApiKey = () => import.meta.env.VITE_WAVESPEED_API_KEY || "";

// Configuration: Set this to your backend proxy URL if you have one
// Auto-detect Vercel URL in production if not explicitly configured
const getProxyUrl = (): string => {
  // First check if explicitly configured
  const explicitUrl = import.meta.env.VITE_BACKEND_URL || "";
  if (explicitUrl && explicitUrl.length > 0) {
    return explicitUrl;
  }
  
  // Auto-detect from current origin (works in production on Vercel)
  if (typeof window !== 'undefined' && window.location) {
    const origin = window.location.origin;
    // Only use auto-detection if we're on a Vercel domain or localhost
    if (origin.includes('vercel.app') || origin.includes('localhost')) {
      return origin;
    }
  }
  
  return "";
};

/**
 * Check if we should use a backend proxy for Wavespeed calls
 */
const shouldUseProxy = (): boolean => {
  const proxyUrl = getProxyUrl();
  return !!proxyUrl && proxyUrl.length > 0;
};

/**
 * Get the base URL for Wavespeed API calls
 * Returns proxy URL if available, otherwise direct Wavespeed URL (will fail with CORS)
 */
const getWavespeedBaseUrl = (): string => {
  if (shouldUseProxy()) {
    const proxyUrl = getProxyUrl().replace(/\/$/, ''); // Remove trailing slash
    // Para Vercel Serverless Functions, la ruta es /api/wavespeed-proxy
    return `${proxyUrl}/api/wavespeed-proxy`;
  }
  return "https://api.wavespeed.ai";
};

/**
 * Make a proxied request to Wavespeed API
 * This will use your backend proxy if configured, otherwise attempt direct call (may fail with CORS)
 */
export const wavespeedRequest = async (
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: any;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> => {
  const { method = 'GET', body, headers = {} } = options;
  
  if (shouldUseProxy()) {
    // Para Vercel, usar el formato /api/wavespeed-proxy/...path
    const proxyUrl = getProxyUrl().replace(/\/$/, '');
    // Remover el leading slash del endpoint si existe
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const url = `${proxyUrl}/api/wavespeed-proxy/${cleanEndpoint}`;
    
    return fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  
  // Direct call (will fail with CORS)
  const baseUrl = getWavespeedBaseUrl();
  const url = `${baseUrl}${endpoint}`;

  // If using proxy, the API key should be handled by the backend
  // If direct call, include API key in headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers
  };

  if (!shouldUseProxy()) {
    const apiKey = getWavespeedApiKey();
    if (apiKey) {
      requestHeaders['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    return response;
  } catch (error: any) {
    // Handle CORS and network errors
    if (error.message?.includes('CORS') || error.message?.includes('Failed to fetch')) {
      const errorMsg = shouldUseProxy()
        ? `Failed to connect to backend proxy at ${baseUrl}. Please check your VITE_BACKEND_URL configuration.`
        : `CORS error: Wavespeed API cannot be called directly from the browser. ` +
          `Please configure a backend proxy by setting VITE_BACKEND_URL environment variable. ` +
          `See services/wavespeedProxy.ts for setup instructions.`;
      
      console.error(`[Wavespeed Proxy] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    throw error;
  }
};

/**
 * Create a Wavespeed video generation task
 */
export const createWavespeedVideoTask = async (
  prompt: string,
  aspectRatio: '16:9' | '9:16',
  referenceImageUrl?: string,
  model?: string
): Promise<string> => {
  const endpoint = 'v1/tasks';
  
  const requestBody: any = {
    model: model || 'wan-i2v-720p',
    prompt: prompt,
    aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9',
  };

  if (referenceImageUrl) {
    // Handle data URIs
    if (referenceImageUrl.startsWith('data:')) {
      console.log(`[Wavespeed] 📸 Reference image is a data URI (${referenceImageUrl.length} chars)`);
    } else {
      console.log(`[Wavespeed] 📸 Using reference image URL: ${referenceImageUrl.substring(0, 80)}...`);
    }
    requestBody.images = [referenceImageUrl];
    console.log(`[Wavespeed] ✅ Reference image added to video generation request`);
  } else {
    console.warn(`[Wavespeed] ⚠️ No reference image provided - video may not match the intended podcast studio scene`);
  }

  console.log(`[Wavespeed] 🚀 Creating video generation task with model: ${model || 'wan-i2v-720p'}`);
  console.log(`[Wavespeed] 📝 Prompt length: ${prompt.length} chars`);
  console.log(`[Wavespeed] 📐 Aspect ratio: ${aspectRatio}`);

  const response = await wavespeedRequest(endpoint, {
    method: 'POST',
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Wavespeed] ❌ API error: ${response.status} - ${errorText}`);
    throw new Error(`Wavespeed API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`[Wavespeed] 📦 Response data:`, JSON.stringify(data, null, 2));
  
  const taskId = data.task_id || data.id || data.data?.id || data.data?.task_id;
  
  if (!taskId) {
    console.error(`[Wavespeed] ❌ No task ID found in response:`, data);
    throw new Error(`Wavespeed API did not return a task ID. Response: ${JSON.stringify(data)}`);
  }
  
  console.log(`[Wavespeed] ✅ Task created with ID: ${taskId}`);
  return taskId;
};

/**
 * Poll a Wavespeed task for completion
 */
export const pollWavespeedTask = async (taskId: string): Promise<string> => {
  const endpoint = `v1/tasks/${taskId}`;
  const maxRetries = 60; // 5 minutes max
  let retries = 0;

  console.log(`[Wavespeed] 🔄 Starting to poll task: ${taskId}`);

  while (retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    const response = await wavespeedRequest(endpoint, {
      method: 'GET'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Wavespeed] ❌ Polling error (${response.status}): ${errorText}`);
      throw new Error(`Wavespeed polling error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log(`[Wavespeed] 📊 Poll attempt ${retries + 1}/${maxRetries} - Status: ${data.status || data.data?.status || 'unknown'}`);
    
    const status = data.status || data.data?.status;
    const rawVideoUrl = 
      data.result?.video_url || 
      data.data?.result?.video_url ||
      data.video_url ||
      data.data?.video_url ||
      (data.outputs && data.outputs[0]) ||
      (data.data?.outputs && data.data.outputs[0]);
    
    let videoUrl: string | null = null;
    if (rawVideoUrl) {
      if (typeof rawVideoUrl === 'string') {
        videoUrl = rawVideoUrl;
      } else if (typeof rawVideoUrl === 'object' && rawVideoUrl !== null) {
        videoUrl = rawVideoUrl.url || rawVideoUrl.video_url || rawVideoUrl.href || null;
        if (!videoUrl && Array.isArray(rawVideoUrl)) {
          videoUrl = rawVideoUrl.find((item: any) => typeof item === 'string') || null;
        }
      }
    }
    
    if (status === "completed") {
      if (videoUrl && typeof videoUrl === 'string') {
        console.log(`[Wavespeed] ✅ Video generation completed! URL: ${videoUrl.substring(0, 100)}...`);
        return videoUrl;
      } else {
        console.error(`[Wavespeed] ❌ Task completed but no valid video URL found. Response:`, JSON.stringify(data, null, 2));
        throw new Error(`Wavespeed task completed but no valid video URL was returned. Task ID: ${taskId}`);
      }
    } else if (status === "failed" || data.data?.status === "failed") {
      const errorMsg = data.error || data.data?.error || data.message || "Unknown error";
      console.error(`[Wavespeed] ❌ Task failed: ${errorMsg}`);
      throw new Error(`Wavespeed task failed: ${errorMsg}`);
    } else if (status === "processing" || status === "pending" || !status) {
      console.log(`[Wavespeed] ⏳ Task still processing... (${retries + 1}/${maxRetries})`);
    } else {
      console.warn(`[Wavespeed] ⚠️ Unknown status: ${status}, continuing to poll...`);
    }

    retries++;
  }

  console.error(`[Wavespeed] ❌ Video generation timed out after ${maxRetries} attempts`);
  throw new Error(`Wavespeed video generation timed out after ${maxRetries} attempts`);
};

/**
 * Create a Wavespeed image generation task (Nano Banana Pro Edit)
 */
export const createWavespeedImageTask = async (
  prompt: string,
  aspectRatio: '16:9' | '9:16' | '1:1' = '16:9',
  inputImageUrl?: string
): Promise<string> => {
  const endpoint = 'api/v3/google/nano-banana-pro/edit';
  
  const requestBody: any = {
    prompt: prompt,
    aspect_ratio: aspectRatio,
    resolution: "2k",
    output_format: "png",
    enable_sync_mode: false,
    enable_base64_output: false
  };

  // Nano Banana Pro Edit requires an input image
  if (inputImageUrl) {
    requestBody.images = [inputImageUrl];
  }

  const response = await wavespeedRequest(endpoint, {
    method: 'POST',
    body: requestBody
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Wavespeed image API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  // WaveSpeed API v3 returns data.id as the task ID
  const taskId = data.data?.id || data.id;
  
  if (!taskId) {
    throw new Error(`Wavespeed API did not return a task ID. Response: ${JSON.stringify(data)}`);
  }
  
  return taskId;
};

/**
 * Poll a Wavespeed image task for completion
 */
export const pollWavespeedImageTask = async (taskId: string): Promise<string> => {
  const endpoint = `api/v3/predictions/${taskId}/result`;
  const maxRetries = 60; // 5 minutes max
  let retries = 0;

  while (retries < maxRetries) {
    await new Promise(resolve => setTimeout(resolve, 3000)); // Check every 3 seconds for images

    const response = await wavespeedRequest(endpoint, {
      method: 'GET'
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Wavespeed image polling error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Check for completed status and image URL
    const status = data.data?.status || data.status;
    
    if (status === "completed") {
      const imageUrl = data.data?.outputs?.[0] || data.outputs?.[0];
      if (imageUrl) {
        return typeof imageUrl === 'string' ? imageUrl : imageUrl.url || imageUrl.href || imageUrl;
      } else {
        throw new Error(`Wavespeed image task completed but no image URL was returned. Task ID: ${taskId}`);
      }
    } else if (status === "failed") {
      const errorMsg = data.error || data.data?.error || data.message || "Unknown error";
      throw new Error(`Wavespeed image task failed: ${errorMsg}`);
    }

    retries++;
  }

  throw new Error(`Wavespeed image generation timed out after ${maxRetries} attempts`);
};

/**
 * Check if Wavespeed is properly configured
 */
export const checkWavespeedConfig = (): { configured: boolean; message: string } => {
  const apiKey = getWavespeedApiKey();
  const proxyUrl = getProxyUrl();
  
  if (proxyUrl) {
    return {
      configured: true,
      message: `✅ Using backend proxy at ${proxyUrl}`
    };
  }
  
  if (apiKey) {
    return {
      configured: false,
      message: `⚠️ Wavespeed API key found but no backend proxy configured. ` +
                `Direct browser calls will fail due to CORS. ` +
                `Proxy will auto-detect Vercel URL in production.`
    };
  }
  
  return {
    configured: false,
    message: `❌ Wavespeed API key not found. Set WAVESPEED_API_KEY in Vercel environment variables.`
  };
};
