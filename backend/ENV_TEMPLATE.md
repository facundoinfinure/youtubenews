# Backend Environment Variables Template

Copy this to `.env` in the backend directory:

```bash
# Server Configuration
PORT=8080
ALLOWED_ORIGINS=http://localhost:5173,https://youtubenews-ashen.vercel.app

# Gemini API (for fallback)
GEMINI_API_KEY=your_gemini_api_key_here

# Ovi Configuration
OVI_PATH=/app/ovi
# Optional: Set specific GPU devices (comma-separated)
# CUDA_VISIBLE_DEVICES=0,1

# YouTube API (for upload proxy)
# Access token is passed in request, but you can set default here if needed
# YOUTUBE_CLIENT_ID=your_youtube_client_id

# Logging
LOG_LEVEL=INFO
```

