# Configuración de Backend Proxy para Wavespeed

Para usar Wavespeed desde el frontend, necesitas un backend que actúe como proxy para evitar errores CORS y proteger tu API Key.

## API de Wavespeed v3

La aplicación usa la API v3 de Wavespeed con los siguientes endpoints:

- **Crear video I2V 720p**: `POST /api/v3/wavespeed-ai/wan-2.1/i2v-720p`
- **Crear video I2V 480p**: `POST /api/v3/wavespeed-ai/wan-2.1/i2v-480p`
- **Obtener resultado**: `GET /api/v3/predictions/{taskId}/result`
- **Editar imagen**: `POST /api/v3/google/nano-banana-pro/edit`

Documentación oficial: https://wavespeed.ai/docs/docs

## Opción 1: Backend Local / Separado (Recomendado)

Esta opción te da un backend completo en Python usando FastAPI. Es ideal para tener logs detallados, control total y poder desplegar en cualquier plataforma (Railway, Render, Fly.io, etc.).

### Instalación y Uso

1. Navega a la carpeta `backend/`:
   ```bash
   cd backend
   ```

2. Sigue las instrucciones detalladas en `backend/README.md` para instalar dependencias y ejecutar el servidor.

3. Configura tu frontend para usar este backend:
   En tu archivo `.env`:
   ```env
   VITE_BACKEND_URL=http://localhost:8080  # Desarrollo
   VITE_BACKEND_URL=https://tu-backend.railway.app  # Producción
   ```

## Opción 2: Vercel Serverless Functions (Actual)

Si despliegas tu frontend en Vercel, puedes usar las Serverless Functions incluidas en la carpeta `api/`.

### Configuración

1. **Configura la variable de entorno en Vercel:**
   - Ve a tu proyecto en Vercel Dashboard
   - Settings > Environment Variables
   - Agrega: `WAVESPEED_API_KEY` = tu API key de Wavespeed

2. **No necesitas configurar `VITE_BACKEND_URL`:**
   - El frontend detectará automáticamente que está corriendo en Vercel y usará los endpoints relativos `/api/wavespeed-proxy`.

### Endpoints del Proxy

El proxy transforma las rutas de la siguiente manera:

| Frontend llama a | Proxy envía a |
|-----------------|---------------|
| `/api/wavespeed-proxy/api/v3/wavespeed-ai/wan-2.1/i2v-720p` | `https://api.wavespeed.ai/api/v3/wavespeed-ai/wan-2.1/i2v-720p` |
| `/api/wavespeed-proxy/api/v3/predictions/{id}/result` | `https://api.wavespeed.ai/api/v3/predictions/{id}/result` |

### Troubleshooting Vercel

Si recibes errores 404 en los endpoints de Vercel:

1. **Verifica que el archivo exista**: `api/wavespeed-proxy/[...path].ts`
2. **Verifica `vercel.json`**: Debe tener la configuración de rewrites correcta
3. **Verifica la variable de entorno**: `WAVESPEED_API_KEY` debe estar configurada en Vercel
4. **Revisa los logs**: Vercel Dashboard > Deployments > (último deployment) > Functions

### Verificar configuración

Para verificar que el proxy funciona:

```bash
# Test del health check
curl https://tu-app.vercel.app/api/wavespeed-proxy/health
```

Debería devolver: `{"status":"ok","service":"wavespeed-proxy-vercel"}`

## Verificación en el Frontend

Para verificar qué método se está usando, abre la consola del navegador:

```javascript
const { checkWavespeedConfig } = await import('./services/wavespeedProxy');
console.log(checkWavespeedConfig());
```

- Si devuelve "Using backend proxy at ...", está usando el proxy correctamente.
- Si devuelve warnings o usa rutas relativas, está intentando usar las Serverless Functions de Vercel.
