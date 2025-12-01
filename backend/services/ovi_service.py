"""
Ovi video generation service with multi-GPU support.
"""
import os
import logging
import base64
import asyncio
from typing import Optional, Dict, List, Any
import subprocess
import sys

logger = logging.getLogger(__name__)


class OviService:
    """Service for generating videos using Ovi with multi-GPU support."""
    
    def __init__(self):
        self.available = self._check_ovi_availability()
        self.ovi_path = os.getenv("OVI_PATH", "/app/ovi")
        self.num_gpus = self._detect_gpus()
        
        if self.available:
            logger.info(f"Ovi service initialized with {self.num_gpus} GPU(s)")
        else:
            logger.warning("Ovi not available, will use Gemini fallback")
    
    def _check_ovi_availability(self) -> bool:
        """Check if Ovi is available in the system."""
        try:
            # Check if Ovi directory exists or can be imported
            ovi_path = os.getenv("OVI_PATH", "/app/ovi")
            if os.path.exists(ovi_path):
                return True
            
            # Try to import ovi if installed as package
            try:
                import ovi
                return True
            except ImportError:
                pass
            
            return False
        except Exception as e:
            logger.warning(f"Ovi availability check failed: {e}")
            return False
    
    def _detect_gpus(self) -> int:
        """Detect number of available GPUs."""
        try:
            import torch
            if torch.cuda.is_available():
                return torch.cuda.device_count()
        except ImportError:
            pass
        
        # Fallback: check nvidia-smi
        try:
            result = subprocess.run(
                ["nvidia-smi", "--list-gpus"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0:
                return len(result.stdout.strip().split("\n"))
        except Exception:
            pass
        
        return 0
    
    def is_available(self) -> bool:
        """Check if Ovi service is available."""
        return self.available
    
    async def generate_video(
        self,
        prompt: str,
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        negative_prompt: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Generate a video using Ovi.
        
        Returns:
            Dict with 'video_base64' or 'video_url' and metadata, or None on failure
        """
        if not self.available:
            return None
        
        try:
            # For now, we'll use a subprocess approach to call Ovi
            # This can be optimized later with direct Python imports
            
            # Prepare Ovi command
            # Based on Ovi's API from the HuggingFace model card
            # Ovi typically uses a CLI or Python API
            
            # Example: Using Ovi's Python API if available
            # This is a placeholder - actual implementation depends on Ovi's API
            
            # Option 1: Direct Python import (if Ovi is installed as package)
            try:
                from ovi import OviGenerator
                
                generator = OviGenerator()
                
                # Generate video
                # Note: Actual API may differ - check Ovi documentation
                video_path = await asyncio.to_thread(
                    generator.generate,
                    prompt=prompt,
                    aspect_ratio=aspect_ratio,
                    resolution=resolution,
                    negative_prompt=negative_prompt,
                )
                
                # Read video file and convert to base64
                with open(video_path, "rb") as f:
                    video_data = f.read()
                    video_base64 = base64.b64encode(video_data).decode("utf-8")
                
                return {
                    "video_base64": video_base64,
                    "video_url": None,
                    "provider": "ovi",
                }
            
            except ImportError:
                # Option 2: Use subprocess to call Ovi CLI
                logger.info("Ovi package not found, trying CLI approach")
                
                # This is a placeholder - adjust based on actual Ovi CLI
                cmd = [
                    "python", "-m", "ovi.generate",
                    "--prompt", prompt,
                    "--aspect-ratio", aspect_ratio,
                    "--resolution", resolution,
                ]
                
                if negative_prompt:
                    cmd.extend(["--negative-prompt", negative_prompt])
                
                # Run Ovi generation
                result = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                
                stdout, stderr = await result.communicate()
                
                if result.returncode != 0:
                    logger.error(f"Ovi generation failed: {stderr.decode()}")
                    return None
                
                # Parse output (adjust based on actual Ovi output format)
                output_path = stdout.decode().strip()
                
                if os.path.exists(output_path):
                    with open(output_path, "rb") as f:
                        video_data = f.read()
                        video_base64 = base64.b64encode(video_data).decode("utf-8")
                    
                    return {
                        "video_base64": video_base64,
                        "video_url": None,
                        "provider": "ovi",
                    }
                
                return None
        
        except Exception as e:
            logger.error(f"Ovi video generation error: {e}")
            return None
    
    async def generate_videos_batch(
        self,
        prompts: List[str],
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        negative_prompt: Optional[str] = None,
    ) -> List[Optional[Dict[str, Any]]]:
        """
        Generate multiple videos in parallel using multi-GPU support.
        
        Returns:
            List of video results (same format as generate_video)
        """
        if not self.available:
            return [None] * len(prompts)
        
        try:
            # Distribute prompts across available GPUs
            if self.num_gpus > 1:
                # Multi-GPU parallel processing
                tasks_per_gpu = len(prompts) // self.num_gpus
                remaining = len(prompts) % self.num_gpus
                
                tasks = []
                prompt_idx = 0
                
                for gpu_id in range(self.num_gpus):
                    gpu_prompts = []
                    count = tasks_per_gpu + (1 if gpu_id < remaining else 0)
                    
                    for _ in range(count):
                        if prompt_idx < len(prompts):
                            gpu_prompts.append(prompts[prompt_idx])
                            prompt_idx += 1
                    
                    if gpu_prompts:
                        # Set CUDA_VISIBLE_DEVICES for this GPU
                        task = self._generate_on_gpu(
                            gpu_prompts, gpu_id, aspect_ratio, resolution, negative_prompt
                        )
                        tasks.append(task)
                
                # Wait for all GPU tasks
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Flatten results
                flat_results = []
                for result in results:
                    if isinstance(result, Exception):
                        logger.error(f"GPU task error: {result}")
                        flat_results.extend([None] * len(prompts))
                    else:
                        flat_results.extend(result)
                
                return flat_results[:len(prompts)]
            
            else:
                # Single GPU or CPU: sequential processing
                results = []
                for prompt in prompts:
                    result = await self.generate_video(
                        prompt, aspect_ratio, resolution, negative_prompt
                    )
                    results.append(result)
                return results
        
        except Exception as e:
            logger.error(f"Batch video generation error: {e}")
            return [None] * len(prompts)
    
    async def _generate_on_gpu(
        self,
        prompts: List[str],
        gpu_id: int,
        aspect_ratio: str,
        resolution: str,
        negative_prompt: Optional[str],
    ) -> List[Optional[Dict[str, Any]]]:
        """Generate videos on a specific GPU."""
        import os
        original_env = os.environ.get("CUDA_VISIBLE_DEVICES")
        
        try:
            # Set GPU visibility
            os.environ["CUDA_VISIBLE_DEVICES"] = str(gpu_id)
            
            # Generate videos for this GPU
            results = []
            for prompt in prompts:
                result = await self.generate_video(
                    prompt, aspect_ratio, resolution, negative_prompt
                )
                results.append(result)
            
            return results
        
        finally:
            # Restore original GPU visibility
            if original_env is not None:
                os.environ["CUDA_VISIBLE_DEVICES"] = original_env
            elif "CUDA_VISIBLE_DEVICES" in os.environ:
                del os.environ["CUDA_VISIBLE_DEVICES"]

