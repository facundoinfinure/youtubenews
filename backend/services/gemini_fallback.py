"""
Gemini VEO 3 fallback service for video generation.
Uses HTTP API directly since Python SDK may not fully support VEO yet.
"""
import os
import logging
from typing import Optional, Dict, Any
import asyncio
import httpx
import json

logger = logging.getLogger(__name__)


class GeminiFallback:
    """Fallback service using Gemini VEO 3 for video generation."""
    
    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY")
        self.available = self.api_key is not None
        
        if self.available:
            logger.info("Gemini fallback service initialized")
        else:
            logger.warning("Gemini API key not found, fallback unavailable")
    
    def is_available(self) -> bool:
        """Check if Gemini service is available."""
        return self.available
    
    async def generate_video(
        self,
        prompt: str,
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        negative_prompt: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Generate a video using Gemini VEO 3 via HTTP API.
        
        Returns:
            Dict with 'video_url' and metadata, or None on failure
        """
        if not self.available:
            return None
        
        try:
            # Use HTTP API directly for Gemini VEO
            # API endpoint: https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning
            api_url = f"https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning?key={self.api_key}"
            
            # Prepare request payload
            payload = {
                "prompt": prompt,
                "config": {
                    "numberOfVideos": 1,
                    "resolution": resolution,
                    "aspectRatio": aspect_ratio,
                }
            }
            
            if negative_prompt:
                payload["negativePrompt"] = negative_prompt
            
            # Start video generation
            async with httpx.AsyncClient(timeout=300.0) as client:
                response = await client.post(
                    api_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
                
                if not response.is_success:
                    error_text = response.text
                    logger.error(f"Gemini API error: {error_text}")
                    return None
                
                operation_data = response.json()
                operation_name = operation_data.get("name")
                
                if not operation_name:
                    logger.error("No operation name in response")
                    return None
                
                # Poll for completion
                video_url = await self._poll_for_video_http(operation_name)
                
                if video_url:
                    return {
                        "video_url": video_url,
                        "provider": "gemini",
                    }
                
                return None
        
        except Exception as e:
            logger.error(f"Gemini video generation error: {e}")
            return None
    
    async def _poll_for_video_http(self, operation_name: str, max_retries: int = 30) -> Optional[str]:
        """Poll for video generation completion using HTTP API."""
        api_url = f"https://generativelanguage.googleapis.com/v1beta/{operation_name}?key={self.api_key}"
        
        retries = 0
        while retries < max_retries:
            await asyncio.sleep(5)  # Wait 5 seconds between polls
            
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.get(api_url)
                    
                    if not response.is_success:
                        logger.warning(f"Poll request failed: {response.text}")
                        retries += 1
                        continue
                    
                    operation_data = response.json()
                    
                    # Check if operation is done
                    if operation_data.get("done", False):
                        # Extract video URI from response
                        try:
                            response_data = operation_data.get("response", {})
                            generated_videos = response_data.get("generatedVideos", [])
                            
                            if generated_videos and len(generated_videos) > 0:
                                video_uri = generated_videos[0].get("video", {}).get("uri")
                                
                                if video_uri:
                                    # Append API key for access
                                    return f"{video_uri}&key={self.api_key}"
                        except Exception as e:
                            logger.warning(f"Error extracting video URI: {e}")
                        
                        return None
                    
                    retries += 1
            
            except Exception as e:
                logger.warning(f"Poll error (retry {retries}): {e}")
                retries += 1
        
        logger.error("Video generation timed out")
        return None

