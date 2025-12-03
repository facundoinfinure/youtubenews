"""
Backend Proxy para Wavespeed API
================================

Este es un ejemplo de backend proxy usando FastAPI para evitar errores CORS
cuando se llama a Wavespeed API desde el navegador.

Instalación:
    pip install fastapi uvicorn httpx python-dotenv

Ejecución:
    uvicorn backend_wavespeed_proxy_example:app --host 0.0.0.0 --port 8080

Variables de entorno (.env):
    WAVESPEED_API_KEY=tu_api_key_de_wavespeed
    CORS_ORIGINS=http://localhost:5173,https://tu-dominio.vercel.app

Luego en tu frontend, configura:
    VITE_BACKEND_URL=http://localhost:8080  (desarrollo)
    VITE_BACKEND_URL=https://tu-backend-url.com  (producción)
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx
import os
from dotenv import load_dotenv
from typing import Optional, Dict, Any

load_dotenv()

app = FastAPI(title="Wavespeed API Proxy")

# Configurar CORS
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000,https://*.vercel.app"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WAVESPEED_API_KEY = os.getenv("WAVESPEED_API_KEY")
WAVESPEED_BASE_URL = "https://api.wavespeed.ai"

if not WAVESPEED_API_KEY:
    print("⚠️ WARNING: WAVESPEED_API_KEY not found in environment variables")


@app.get("/")
async def root():
    return {
        "message": "Wavespeed API Proxy",
        "status": "running",
        "wavespeed_configured": bool(WAVESPEED_API_KEY)
    }


@app.post("/api/wavespeed/v1/tasks")
async def create_wavespeed_task(request: Request):
    """Proxy para crear una tarea de generación de video en Wavespeed"""
    if not WAVESPEED_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        body = await request.json()
        
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
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            return response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wavespeed/v1/tasks/{task_id}")
async def get_wavespeed_task(task_id: str):
    """Proxy para obtener el estado de una tarea de Wavespeed"""
    if not WAVESPEED_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{WAVESPEED_BASE_URL}/v1/tasks/{task_id}",
                headers={
                    "Authorization": f"Bearer {WAVESPEED_API_KEY}"
                }
            )
            
            if response.status_code >= 400:
                error_text = response.text
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            return response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/wavespeed/api/v3/google/nano-banana-pro/edit")
async def create_wavespeed_image_task(request: Request):
    """Proxy para crear una tarea de generación de imagen en Wavespeed"""
    if not WAVESPEED_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        body = await request.json()
        
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
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            return response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/wavespeed/api/v3/predictions/{task_id}/result")
async def get_wavespeed_image_task_result(task_id: str):
    """Proxy para obtener el resultado de una tarea de imagen de Wavespeed"""
    if not WAVESPEED_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="WAVESPEED_API_KEY not configured on server"
        )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{WAVESPEED_BASE_URL}/api/v3/predictions/{task_id}/result",
                headers={
                    "Authorization": f"Bearer {WAVESPEED_API_KEY}"
                }
            )
            
            if response.status_code >= 400:
                error_text = response.text
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Wavespeed API error: {error_text}"
                )
            
            return response.json()
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Wavespeed API timeout")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
