# Configuración de Backend Proxy para Wavespeed

Para usar Wavespeed desde el frontend, necesitas un backend que actúe como proxy para evitar errores CORS y proteger tu API Key.

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

## Opción 2: Vercel Serverless Functions

Si despliegas tu frontend en Vercel, puedes usar las Serverless Functions incluidas en la carpeta `api/`.

### Configuración

1. **Configura la variable de entorno en Vercel:**
   - Ve a tu proyecto en Vercel Dashboard
   - Settings > Environment Variables
   - Agrega: `WAVESPEED_API_KEY` = tu API key

2. **No necesitas configurar `VITE_BACKEND_URL`:**
   - El frontend detectará automáticamente que está corriendo en Vercel y usará los endpoints relativos `/api/wavespeed-proxy`.

### Troubleshooting Vercel

Si recibes errores 404 en los endpoints de Vercel:

1. Verifica que el archivo `api/wavespeed-proxy/[...path].ts` exista.
2. Asegúrate de que `vercel.json` configure correctamente la función (sin rewrites conflictivos).
3. Asegúrate de que la variable `WAVESPEED_API_KEY` esté configurada en Vercel.
4. Revisa los logs en Vercel Dashboard > Functions.

## Verificación

Para verificar qué método se está usando, abre la consola del navegador:

```javascript
const { checkWavespeedConfig } = await import('./services/wavespeedProxy');
console.log(checkWavespeedConfig());
```

- Si devuelve "Using backend proxy at ...", está usando la Opción 1.
- Si devuelve warnings o usa rutas relativas, está intentando usar la Opción 2 o llamadas directas (que fallarán por CORS).
