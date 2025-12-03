"""
Wavespeed API Proxy Backend
===========================

Backend proxy usando FastAPI para evitar errores CORS cuando se llama a 
Wavespeed API desde el navegador.

Este backend actúa como intermediario entre el frontend y la API de Wavespeed,
manejando autenticación, CORS y proporcionando logging estructurado.
"""

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Cargar variables de entorno
load_dotenv()

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuración
WAVESPEED_API_KEY = os.getenv("WAVESPEED_API_KEY")
WAVESPEED_BASE_URL = "https://api.wavespeed.ai"
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,https://*.vercel.app"
).split(",")
PORT = int(os.getenv("PORT", "8080"))

# Validar configuración
if not WAVESPEED_API_KEY:
    logger.warning("⚠️ WAVESPEED_API_KEY not found in environment variables")

# Configurar FastAPI
app = FastAPI(
    title="Wavespeed API Proxy",
    description="Proxy backend para Wavespeed API que maneja CORS y autenticación",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configurar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Modelos Pydantic para validación
class HealthResponse(BaseModel):
    message: str
    status: str
    wavespeed_configured: bool
    version: str = "1.0.0"


class ErrorResponse(BaseModel):
    error: str
    message: Optional[str] = None
    details: Optional[str] = None


# Endpoints
@app.get("/", response_model=HealthResponse, tags=["Health"])
async def root():
    """
    Health check endpoint.
    
    Retorna el estado del servicio y si Wavespeed está configurado.
    """
    return {
        "message": "Wavespeed API Proxy",
        "status": "running",
        "wavespeed_configured": bool(WAVESPEED_API_KEY),
        "version": "1.0.0"
    }


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health():
    """
    Health check endpoint (alternativo).
    
    Útil para monitoreo y verificación de estado del servicio.
    """
    return {
        "message": "Wavespeed API Proxy",
        "status": "healthy",
        "wavespeed_configured": bool(WAVESPEED_API_KEY),
        "version": "1.0.0"
    }


@app.post("/api/wavespeed/v1/tasks", tags=["Wavespeed Video"])
async def create_wavespeed_task(request: Request):
    """
    Proxy para crear una tarea de generación de video en Wavespeed.
    
    Endpoint: POST /api/wavespeed/v1/tasks
    
    Body esperado:
    - model: string (ej: "wan-i2v-720p")
    - prompt: string
    - aspect_ratio: string (ej: "16:9" o "9:16")
    - images: array (opcional, URLs o data URIs de imágenes de referencia)
    """
    if not WAVESPEED_API_KEY:
        logger.error("WAVESPEED_API_KEY not configured")
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        body = await request.json()
        logger.info(f"Creating Wavespeed video task: model={body.get('model')}, prompt_length={len(body.get('prompt', ''))}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{WAVESPEED_BASE_URL}/v1/tasks",
                json=body,
                headers={
                    "Authorization": f"Bearer {WAVESPEED_API_KEY}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code >= 400:
                error_text = response.text
                logger.error(f"Wavespeed API error: {response.status_code} - {error_text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            result = response.json()
            task_id = result.get("task_id") or result.get("id") or result.get("data", {}).get("id")
            logger.info(f"✅ Video task created: {task_id}")
            return result
            
    except httpx.TimeoutException:
        logger.error("Wavespeed API timeout")
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error creating video task: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wavespeed/v1/tasks/{task_id}", tags=["Wavespeed Video"])
async def get_wavespeed_task(task_id: str):
    """
    Proxy para obtener el estado de una tarea de Wavespeed.
    
    Endpoint: GET /api/wavespeed/v1/tasks/{task_id}
    
    Retorna el estado actual de la tarea y el resultado si está completada.
    """
    if not WAVESPEED_API_KEY:
        logger.error("WAVESPEED_API_KEY not configured")
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        logger.debug(f"Polling Wavespeed task: {task_id}")
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{WAVESPEED_BASE_URL}/v1/tasks/{task_id}",
                headers={
                    "Authorization": f"Bearer {WAVESPEED_API_KEY}"
                }
            )
            
            if response.status_code >= 400:
                error_text = response.text
                logger.error(f"Wavespeed API error: {response.status_code} - {error_text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            return response.json()
            
    except httpx.TimeoutException:
        logger.error("Wavespeed API timeout")
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error polling task: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/wavespeed/api/v3/google/nano-banana-pro/edit", tags=["Wavespeed Image"])
async def create_wavespeed_image_task(request: Request):
    """
    Proxy para crear una tarea de generación de imagen en Wavespeed.
    
    Endpoint: POST /api/wavespeed/api/v3/google/nano-banana-pro/edit
    
    Body esperado:
    - prompt: string
    - aspect_ratio: string (ej: "16:9", "9:16", "1:1")
    - resolution: string (ej: "2k")
    - output_format: string (ej: "png")
    - images: array (opcional, imagen de entrada para edición)
    """
    if not WAVESPEED_API_KEY:
        logger.error("WAVESPEED_API_KEY not configured")
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        body = await request.json()
        logger.info(f"Creating Wavespeed image task: prompt_length={len(body.get('prompt', ''))}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{WAVESPEED_BASE_URL}/api/v3/google/nano-banana-pro/edit",
                json=body,
                headers={
                    "Authorization": f"Bearer {WAVESPEED_API_KEY}",
                    "Content-Type": "application/json"
                }
            )
            
            if response.status_code >= 400:
                error_text = response.text
                logger.error(f"Wavespeed API error: {response.status_code} - {error_text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            result = response.json()
            task_id = result.get("data", {}).get("id") or result.get("id")
            logger.info(f"✅ Image task created: {task_id}")
            return result
            
    except httpx.TimeoutException:
        logger.error("Wavespeed API timeout")
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error creating image task: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wavespeed/api/v3/predictions/{task_id}/result", tags=["Wavespeed Image"])
async def get_wavespeed_image_task_result(task_id: str):
    """
    Proxy para obtener el resultado de una tarea de imagen de Wavespeed.
    
    Endpoint: GET /api/wavespeed/api/v3/predictions/{task_id}/result
    
    Retorna el resultado de la tarea de imagen si está completada.
    """
    if not WAVESPEED_API_KEY:
        logger.error("WAVESPEED_API_KEY not configured")
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        logger.debug(f"Polling Wavespeed image task: {task_id}")
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{WAVESPEED_BASE_URL}/api/v3/predictions/{task_id}/result",
                headers={
                    "Authorization": f"Bearer {WAVESPEED_API_KEY}"
                }
            )
            
            if response.status_code >= 400:
                error_text = response.text
                logger.error(f"Wavespeed API error: {response.status_code} - {error_text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            return response.json()
            
    except httpx.TimeoutException:
        logger.error("Wavespeed API timeout")
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Unexpected error polling image task: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Manejo de errores global
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Manejo global de excepciones no capturadas."""
    logger.exception(f"Unhandled exception: {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "message": str(exc) if os.getenv("DEBUG", "false").lower() == "true" else "An unexpected error occurred"
        }
    )


if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting Wavespeed API Proxy on port {PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
