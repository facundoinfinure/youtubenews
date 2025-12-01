# ChimpNews Backend

FastAPI backend service for video generation using Ovi (primary) and Gemini VEO 3 (fallback), with YouTube upload proxy.

## Features

- **Ovi Integration**: Primary video generation with multi-GPU support
- **Gemini VEO 3 Fallback**: Automatic fallback when Ovi is unavailable
- **Multi-GPU Processing**: Parallel video generation across multiple GPUs
- **YouTube Upload Proxy**: Resolves CORS issues for YouTube uploads
- **Health Checks**: Monitoring endpoints for service status

## Prerequisites

- Python 3.10+
- CUDA-capable GPU(s) (for Ovi)
- Google Cloud account (for deployment)
- Gemini API key (for fallback)

## Local Development

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Install Ovi** (optional, for local GPU testing):
   ```bash
   git clone https://github.com/character-ai/Ovi.git
   cd Ovi
   pip install -e .
   ```

3. **Set environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Run the server**:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8080 --reload
   ```

## API Endpoints

### Health Check
```
GET /health
```

### Generate Single Video
```
POST /api/v1/generate-video
Body: {
  "prompt": "Your video prompt",
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "negative_prompt": "Optional negative prompt"
}
```

### Generate Multiple Videos (Batch)
```
POST /api/v1/generate-videos-batch
Body: {
  "prompts": ["prompt1", "prompt2", ...],
  "aspect_ratio": "16:9",
  "resolution": "720p"
}
```

### YouTube Upload Proxy
```
POST /api/v1/youtube/upload
Form Data:
  - file: Video file
  - metadata: JSON string with video metadata
  - access_token: YouTube OAuth token
```

## Deployment

### Option 1: Google Cloud Compute Engine (GPU Support)

For production with GPU support:

```bash
chmod +x deploy-gcp.sh
./deploy-gcp.sh
```

This creates a GPU-enabled VM instance and deploys the backend.

### Option 2: Google Cloud Run (Serverless, No GPU)

For serverless deployment (Gemini fallback only):

```bash
chmod +x deploy-cloud-run.sh
./deploy-cloud-run.sh
```

**Note**: Cloud Run doesn't support GPUs, so Ovi will not be available.

### Option 3: Docker

Build and run with Docker:

```bash
docker build -t chimpnews-backend .
docker run -d -p 8080:8080 \
  --gpus all \
  -e GEMINI_API_KEY=your_key \
  -e ALLOWED_ORIGINS=http://localhost:5173 \
  chimpnews-backend
```

## Environment Variables

- `PORT`: Server port (default: 8080)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `GEMINI_API_KEY`: Google Gemini API key (for fallback)
- `OVI_PATH`: Path to Ovi installation (optional)
- `CUDA_VISIBLE_DEVICES`: GPU device IDs (optional, comma-separated)

## Multi-GPU Configuration

The service automatically detects available GPUs and distributes batch video generation across them. To specify specific GPUs:

```bash
export CUDA_VISIBLE_DEVICES=0,1,2,3
```

## Troubleshooting

### Ovi Not Available
- Check GPU availability: `nvidia-smi`
- Verify Ovi installation
- Service will automatically fall back to Gemini VEO 3

### CORS Issues
- Ensure `ALLOWED_ORIGINS` includes your frontend URL
- Check firewall rules for Cloud Run/Compute Engine

### GPU Out of Memory
- Reduce batch size
- Use lower resolution
- Enable model quantization if supported by Ovi

## Monitoring

Check service health:
```bash
curl http://your-backend-url/health
```

Response includes availability status for both Ovi and Gemini services.

