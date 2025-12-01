"""
FastAPI backend for ChimpNews video generation.
Handles Ovi video generation with Gemini VEO 3 fallback, and YouTube upload proxy.
"""
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import logging

from services.ovi_service import OviService
from services.gemini_fallback import GeminiFallback
from services.youtube_proxy import YouTubeProxy

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ChimpNews Video Generation API", version="1.0.0")

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize services
ovi_service = OviService()
gemini_fallback = GeminiFallback()
youtube_proxy = YouTubeProxy()


# Request/Response Models
class VideoGenerationRequest(BaseModel):
    prompt: str
    aspect_ratio: str = "16:9"  # "16:9" or "9:16"
    resolution: str = "720p"
    negative_prompt: Optional[str] = None


class VideoGenerationResponse(BaseModel):
    video_url: Optional[str] = None
    video_base64: Optional[str] = None
    provider: str  # "ovi" or "gemini"
    error: Optional[str] = None


class BatchVideoGenerationRequest(BaseModel):
    prompts: List[str]
    aspect_ratio: str = "16:9"
    resolution: str = "720p"
    negative_prompt: Optional[str] = None


class BatchVideoGenerationResponse(BaseModel):
    videos: List[VideoGenerationResponse]
    errors: List[str] = []


class YouTubeUploadRequest(BaseModel):
    metadata: Dict[str, Any]
    access_token: str


# Health check
@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "ovi_available": ovi_service.is_available(),
        "gemini_available": gemini_fallback.is_available(),
    }


# Video generation endpoint
@app.post("/api/v1/generate-video", response_model=VideoGenerationResponse)
async def generate_video(request: VideoGenerationRequest):
    """
    Generate a video using Ovi (primary) or Gemini VEO 3 (fallback).
    """
    try:
        logger.info(f"Generating video with prompt: {request.prompt[:50]}...")
        
        # Try Ovi first
        if ovi_service.is_available():
            try:
                result = await ovi_service.generate_video(
                    prompt=request.prompt,
                    aspect_ratio=request.aspect_ratio,
                    resolution=request.resolution,
                    negative_prompt=request.negative_prompt,
                )
                if result:
                    return VideoGenerationResponse(
                        video_base64=result.get("video_base64"),
                        video_url=result.get("video_url"),
                        provider="ovi",
                    )
            except Exception as e:
                logger.warning(f"Ovi generation failed: {e}, falling back to Gemini")
        
        # Fallback to Gemini VEO 3
        if gemini_fallback.is_available():
            try:
                result = await gemini_fallback.generate_video(
                    prompt=request.prompt,
                    aspect_ratio=request.aspect_ratio,
                    resolution=request.resolution,
                    negative_prompt=request.negative_prompt,
                )
                if result:
                    return VideoGenerationResponse(
                        video_url=result.get("video_url"),
                        provider="gemini",
                    )
            except Exception as e:
                logger.error(f"Gemini fallback also failed: {e}")
        
        raise HTTPException(
            status_code=500,
            detail="Both Ovi and Gemini video generation failed"
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Video generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Batch video generation (for parallel processing)
@app.post("/api/v1/generate-videos-batch", response_model=BatchVideoGenerationResponse)
async def generate_videos_batch(request: BatchVideoGenerationRequest):
    """
    Generate multiple videos in parallel using multi-GPU support.
    """
    try:
        logger.info(f"Generating {len(request.prompts)} videos in batch")
        
        # Use Ovi for batch if available (supports multi-GPU)
        if ovi_service.is_available():
            try:
                results = await ovi_service.generate_videos_batch(
                    prompts=request.prompts,
                    aspect_ratio=request.aspect_ratio,
                    resolution=request.resolution,
                    negative_prompt=request.negative_prompt,
                )
                
                videos = []
                for i, result in enumerate(results):
                    if result:
                        videos.append(VideoGenerationResponse(
                            video_base64=result.get("video_base64"),
                            video_url=result.get("video_url"),
                            provider="ovi",
                        ))
                    else:
                        videos.append(VideoGenerationResponse(
                            provider="ovi",
                            error=f"Failed to generate video {i+1}",
                        ))
                
                return BatchVideoGenerationResponse(videos=videos)
            
            except Exception as e:
                logger.warning(f"Ovi batch generation failed: {e}, falling back to sequential Gemini")
        
        # Fallback: sequential Gemini generation
        videos = []
        errors = []
        for i, prompt in enumerate(request.prompts):
            try:
                result = await gemini_fallback.generate_video(
                    prompt=prompt,
                    aspect_ratio=request.aspect_ratio,
                    resolution=request.resolution,
                    negative_prompt=request.negative_prompt,
                )
                if result:
                    videos.append(VideoGenerationResponse(
                        video_url=result.get("video_url"),
                        provider="gemini",
                    ))
                else:
                    videos.append(VideoGenerationResponse(
                        provider="gemini",
                        error=f"Failed to generate video {i+1}",
                    ))
            except Exception as e:
                errors.append(f"Video {i+1}: {str(e)}")
                videos.append(VideoGenerationResponse(
                    provider="gemini",
                    error=str(e),
                ))
        
        return BatchVideoGenerationResponse(videos=videos, errors=errors)
    
    except Exception as e:
        logger.error(f"Batch video generation error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# YouTube upload proxy
@app.post("/api/v1/youtube/upload")
async def upload_to_youtube(
    file: UploadFile = File(...),
    metadata: str = None,  # JSON string
    access_token: str = None,
):
    """
    Proxy endpoint for YouTube uploads to avoid CORS issues.
    """
    try:
        if not access_token:
            raise HTTPException(status_code=401, detail="Access token required")
        
        import json
        metadata_dict = json.loads(metadata) if metadata else {}
        
        result = await youtube_proxy.upload_video(
            video_file=file,
            metadata=metadata_dict,
            access_token=access_token,
        )
        
        return JSONResponse(content=result)
    
    except Exception as e:
        logger.error(f"YouTube upload error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)

