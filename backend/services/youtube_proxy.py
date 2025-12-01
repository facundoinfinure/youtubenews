"""
YouTube upload proxy service to avoid CORS issues.
"""
import os
import logging
import httpx
from typing import Dict, Any, Optional
from fastapi import UploadFile

logger = logging.getLogger(__name__)


class YouTubeProxy:
    """Proxy service for YouTube API uploads."""
    
    def __init__(self):
        self.youtube_api_base = "https://www.googleapis.com/upload/youtube/v3"
    
    async def upload_video(
        self,
        video_file: UploadFile,
        metadata: Dict[str, Any],
        access_token: str,
    ) -> Dict[str, Any]:
        """
        Upload video to YouTube via proxy.
        
        Returns:
            Dict with video URL or error message
        """
        try:
            # Step 1: Initiate resumable upload
            async with httpx.AsyncClient(timeout=300.0) as client:
                # Get file size
                video_data = await video_file.read()
                file_size = len(video_data)
                
                # Initiate upload
                init_response = await client.post(
                    f"{self.youtube_api_base}/videos?uploadType=resumable&part=snippet,status",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                        "X-Upload-Content-Length": str(file_size),
                        "X-Upload-Content-Type": video_file.content_type or "video/webm",
                    },
                    json={
                        "snippet": {
                            "title": metadata.get("title", "Untitled"),
                            "description": metadata.get("description", ""),
                            "tags": metadata.get("tags", []),
                            "categoryId": metadata.get("categoryId", "25"),  # News & Politics
                        },
                        "status": {
                            "privacyStatus": metadata.get("privacyStatus", "private"),
                            "selfDeclaredMadeForKids": False,
                        },
                    },
                )
                
                if not init_response.is_success:
                    error_text = init_response.text
                    logger.error(f"YouTube upload initiation failed: {error_text}")
                    raise Exception(f"YouTube upload initiation failed: {error_text}")
                
                upload_url = init_response.headers.get("Location")
                if not upload_url:
                    raise Exception("No upload URL received from YouTube")
                
                # Step 2: Upload the video file
                upload_response = await client.put(
                    upload_url,
                    headers={
                        "Content-Type": video_file.content_type or "video/webm",
                        "Content-Length": str(file_size),
                    },
                    content=video_data,
                )
                
                if upload_response.is_success:
                    response_data = upload_response.json()
                    video_id = response_data.get("id")
                    
                    if video_id:
                        return {
                            "success": True,
                            "video_url": f"https://youtu.be/{video_id}",
                            "video_id": video_id,
                        }
                    else:
                        raise Exception("No video ID in response")
                else:
                    error_text = upload_response.text
                    logger.error(f"YouTube upload failed: {error_text}")
                    raise Exception(f"YouTube upload failed: {error_text}")
        
        except Exception as e:
            logger.error(f"YouTube proxy upload error: {e}")
            return {
                "success": False,
                "error": str(e),
            }

