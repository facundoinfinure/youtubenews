# Configuración de Backend Proxy para Wavespeed

Para usar Wavespeed desde el frontend, necesitas un backend que actúe como proxy para evitar errores CORS.

## Opciones de Deployment

### Opción 1: Backend Local (Desarrollo)

**Para desarrollo local:**

1. **Instala las dependencias:**
   ```bash
   pip install fastapi uvicorn httpx python-dotenv
   ```

2. **Crea un archivo `.env` en la raíz del proyecto:**
   ```env
   WAVESPEED_API_KEY=tu_api_key_de_wavespeed
   CORS_ORIGINS=http://localhost:5173,http://localhost:3000
   ```

3. **Ejecuta el servidor:**
   ```bash
   python backend_wavespeed_proxy_example.py
   # O
   uvicorn backend_wavespeed_proxy_example:app --host 0.0.0.0 --port 8080
   ```

4. **Configura en tu frontend (`.env`):**
   ```env
   VITE_BACKEND_URL=http://localhost:8080
   ```

### Opción 2: Vercel Serverless Functions (Recomendado para Producción)

**Para producción en Vercel:**

1. **Crea la carpeta `api/` en la raíz de tu proyecto**

2. **Crea `api/wavespeed-proxy.ts`:**
   ```typescript
   import type { VercelRequest, VercelResponse } from '@vercel/node';

   export default async function handler(
     req: VercelRequest,
     res: VercelResponse
   ) {
     // Configurar CORS
     res.setHeader('Access-Control-Allow-Origin', '*');
     res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
     res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

     if (req.method === 'OPTIONS') {
       return res.status(200).end();
     }

     const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
     if (!WAVESPEED_API_KEY) {
       return res.status(500).json({ error: 'WAVESPEED_API_KEY not configured' });
     }

     const { path, method, body } = req.query;
     const wavespeedPath = Array.isArray(path) ? path.join('/') : path;

     try {
       const response = await fetch(`https://api.wavespeed.ai/${wavespeedPath}`, {
         method: method as string || 'GET',
         headers: {
           'Authorization': `Bearer ${WAVESPEED_API_KEY}`,
           'Content-Type': 'application/json',
         },
         body: method === 'POST' ? JSON.stringify(req.body) : undefined,
       });

       const data = await response.json();
       return res.status(response.status).json(data);
     } catch (error: any) {
       return res.status(500).json({ error: error.message });
     }
   }
   ```

3. **Configura variables de entorno en Vercel:**
   - Ve a tu proyecto en Vercel Dashboard
   - Settings > Environment Variables
   - Agrega: `WAVESPEED_API_KEY` = tu API key

4. **Configura en tu frontend (`.env` o Vercel Environment Variables):**
   ```env
   VITE_BACKEND_URL=https://tu-proyecto.vercel.app
   ```

### Opción 3: Railway / Render / Fly.io

**Para otros servicios serverless:**

1. **Sube el archivo `backend_wavespeed_proxy_example.py`**

2. **Configura las variables de entorno:**
   - `WAVESPEED_API_KEY` = tu API key
   - `CORS_ORIGINS` = tu dominio de frontend

3. **Obtén la URL de tu backend** (ej: `https://tu-backend.railway.app`)

4. **Configura en tu frontend:**
   ```env
   VITE_BACKEND_URL=https://tu-backend.railway.app
   ```

### Opción 4: Usar tu Backend Existente

Si ya tienes un backend (como el mencionado en el README):

1. **Agrega los endpoints de Wavespeed a tu backend existente**

2. **Usa la URL de tu backend existente:**
   ```env
   VITE_BACKEND_URL=https://tu-backend-existente.com
   ```

## Verificación

Después de configurar el backend:

1. **Verifica que el backend esté corriendo:**
   ```bash
   curl http://localhost:8080/  # Debe retornar {"message": "Wavespeed API Proxy", ...}
   ```

2. **Verifica desde el frontend:**
   ```javascript
   // En la consola del navegador
   const { checkWavespeedConfig } = await import('./services/wavespeedProxy');
   console.log(checkWavespeedConfig());
   // Debe mostrar: ✅ Using backend proxy at http://localhost:8080
   ```

## URLs de Ejemplo

**Desarrollo local:**
```
VITE_BACKEND_URL=http://localhost:8080
```

**Producción Vercel:**
```
VITE_BACKEND_URL=https://tu-proyecto.vercel.app
```

**Producción Railway:**
```
VITE_BACKEND_URL=https://tu-backend.railway.app
```

**Producción Render:**
```
VITE_BACKEND_URL=https://tu-backend.onrender.com
```

## Notas Importantes

- El backend **debe** tener la variable `WAVESPEED_API_KEY` configurada
- El backend **debe** permitir CORS desde tu dominio de frontend
- La URL debe ser accesible públicamente (no usar `localhost` en producción)
- No incluyas la barra final (`/`) en `VITE_BACKEND_URL`

## Troubleshooting

**Error: "Failed to connect to backend proxy"**
- Verifica que el backend esté corriendo
- Verifica que la URL en `VITE_BACKEND_URL` sea correcta
- Verifica que no haya firewall bloqueando la conexión

**Error: "CORS error"**
- Asegúrate de que el backend permita CORS desde tu dominio
- Verifica la configuración de `CORS_ORIGINS` en el backend

**Error: "WAVESPEED_API_KEY not configured"**
- Verifica que la variable de entorno esté configurada en el backend
- Reinicia el servidor después de agregar la variable
