# 🔑 Environment Variables Setup

## Required Variables for Vercel

Add these environment variables in **Vercel Dashboard → Settings → Environment Variables**:

### 1. OpenAI API Key (Required)
```
OPENAI_API_KEY=sk-...
```
- **Used for:** GPT-4o (text generation), TTS (audio), DALL-E 3 (image fallback)
- **Get it from:** https://platform.openai.com/api-keys
- **Estimated cost:** ~$0.05-0.10 per video production

### 2. SerpAPI Key (Required)
```
SERPAPI_API_KEY=...
```
- **Used for:** News search via Google News
- **Get it from:** https://serpapi.com/
- **Free tier:** 100 searches/month
- **Estimated cost:** ~$0.01 per search

### 3. WaveSpeed API Key (Required - Already configured)
```
WAVESPEED_API_KEY=...
```
- **Used for:** InfiniteTalk video generation, Nano Banana image generation
- **Get it from:** https://wavespeed.ai/
- **Estimated cost:** ~$3-5 per 60-second video

### 4. Supabase (Already configured)
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## Service Architecture

| Service | Provider | Model | Fallback |
|---------|----------|-------|----------|
| 🔍 News Search | SerpAPI | Google News | - |
| 📝 Script Generation | OpenAI | GPT-4o | - |
| 🏷️ SEO Metadata | OpenAI | GPT-4o | - |
| 🎣 Viral Hook | OpenAI | GPT-4o | - |
| 📈 Trending Topics | SerpAPI | Google News | - |
| 🎙️ Audio/TTS | OpenAI | tts-1 | - |
| 🖼️ Images | WaveSpeed | Nano Banana Pro | DALL-E 3 |
| 🎬 Video Lip-Sync | WaveSpeed | InfiniteTalk Multi | - |

---

## Cost Breakdown per Video (~60 seconds)

| Service | Operation | Cost |
|---------|-----------|------|
| SerpAPI | 1 news search | ~$0.01 |
| OpenAI GPT-4o | Script + Metadata + Hook | ~$0.03 |
| OpenAI TTS | ~10 audio segments | ~$0.15 |
| WaveSpeed Nano Banana | 1-2 images | ~$0.14-0.28 |
| WaveSpeed InfiniteTalk | ~60s video (12 × 5s) | ~$3.60 |
| **Total** | | **~$4-5** |

---

## API Endpoints (Vercel Serverless Functions)

The following proxy endpoints are created automatically:

- `POST /api/openai?endpoint=chat/completions` - GPT-4o text generation
- `POST /api/openai?endpoint=audio/speech` - OpenAI TTS
- `POST /api/openai?endpoint=images/generations` - DALL-E 3
- `GET /api/serpapi?q=...&gl=us&hl=en` - SerpAPI news search
- `POST /api/wavespeed?path=...` - WaveSpeed API proxy

---

## Troubleshooting

### "OPENAI_API_KEY not configured"
Add `OPENAI_API_KEY` to Vercel environment variables and redeploy.

### "SERPAPI_API_KEY not configured"  
Add `SERPAPI_API_KEY` to Vercel environment variables and redeploy.

### "No news found"
Check that your SerpAPI key is valid and has remaining searches.

### Audio generation fails
Check OpenAI API key and ensure you have TTS access enabled.

### Image generation fails (both WaveSpeed and DALL-E)
Check both WAVESPEED_API_KEY and OPENAI_API_KEY are configured.
