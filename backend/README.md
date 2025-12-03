# Wavespeed API Proxy Backend

Backend proxy usando FastAPI para evitar errores CORS cuando se llama a Wavespeed API desde el navegador.

## 🚀 Inicio Rápido

### Instalación Local

1. **Instalar dependencias:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Configurar variables de entorno:**
   ```bash
   cp .env.example .env
   # Editar .env y agregar tu WAVESPEED_API_KEY
   ```

3. **Ejecutar el servidor:**
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8080
   # O simplemente:
   python main.py
   ```

4. **Verificar que funciona:**
   ```bash
   curl http://localhost:8080/health
   ```

5. **Ver documentación de API:**
   - Swagger UI: http://localhost:8080/docs
   - ReDoc: http://localhost:8080/redoc

## 📋 Variables de Entorno

Crea un archivo `.env` basado en `.env.example`:

- **WAVESPEED_API_KEY** (requerido): Tu API key de Wavespeed
- **CORS_ORIGINS** (opcional): Orígenes permitidos separados por comas. Por defecto: `http://localhost:5173,http://localhost:3000,https://*.vercel.app`
- **PORT** (opcional): Puerto del servidor. Por defecto: `8080`
- **DEBUG** (opcional): Mostrar errores detallados. Por defecto: `false`

## 🔧 Configuración del Frontend

En tu frontend, configura la variable de entorno:

```env
VITE_BACKEND_URL=http://localhost:8080  # Desarrollo
VITE_BACKEND_URL=https://tu-backend-url.com  # Producción
```

## 📡 Endpoints Disponibles

### Health Check
- `GET /` - Estado del servicio
- `GET /health` - Health check para monitoreo

### Video Generation
- `POST /api/wavespeed/v1/tasks` - Crear tarea de generación de video
- `GET /api/wavespeed/v1/tasks/{task_id}` - Obtener estado de tarea de video

### Image Generation
- `POST /api/wavespeed/api/v3/google/nano-banana-pro/edit` - Crear tarea de generación de imagen
- `GET /api/wavespeed/api/v3/predictions/{task_id}/result` - Obtener resultado de tarea de imagen

## 🚢 Despliegue

### Opción 1: Railway

1. **Crear cuenta en [Railway](https://railway.app)**

2. **Conectar tu repositorio:**
   - Ve a Railway Dashboard
   - Click en "New Project"
   - Selecciona "Deploy from GitHub repo"
   - Selecciona tu repositorio

3. **Configurar el proyecto:**
   - Railway detectará automáticamente que es un proyecto Python
   - Selecciona la carpeta `backend/` como raíz del proyecto

4. **Configurar variables de entorno:**
   - Ve a Settings > Variables
   - Agrega:
     - `WAVESPEED_API_KEY` = tu API key
     - `CORS_ORIGINS` = tus dominios permitidos (opcional)
     - `PORT` = Railway lo configura automáticamente

5. **Desplegar:**
   - Railway desplegará automáticamente
   - Obtén la URL de tu servicio (ej: `https://tu-proyecto.railway.app`)

6. **Configurar en frontend:**
   ```env
   VITE_BACKEND_URL=https://tu-proyecto.railway.app
   ```

### Opción 2: Render

1. **Crear cuenta en [Render](https://render.com)**

2. **Crear nuevo Web Service:**
   - Ve a Dashboard > New > Web Service
   - Conecta tu repositorio de GitHub

3. **Configurar el servicio:**
   - **Name**: wavespeed-proxy (o el nombre que prefieras)
   - **Environment**: Python 3
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Root Directory**: `backend` (si Render lo permite, o ajusta los comandos)

4. **Configurar variables de entorno:**
   - Ve a Environment
   - Agrega:
     - `WAVESPEED_API_KEY` = tu API key
     - `CORS_ORIGINS` = tus dominios permitidos (opcional)
     - `PORT` = Render lo configura automáticamente

5. **Desplegar:**
   - Click en "Create Web Service"
   - Render desplegará automáticamente
   - Obtén la URL (ej: `https://wavespeed-proxy.onrender.com`)

6. **Configurar en frontend:**
   ```env
   VITE_BACKEND_URL=https://wavespeed-proxy.onrender.com
   ```

### Opción 3: Fly.io

1. **Instalar Fly CLI:**
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```

2. **Autenticarse:**
   ```bash
   fly auth login
   ```

3. **Crear aplicación:**
   ```bash
   cd backend
   fly launch
   ```

4. **Configurar variables de entorno:**
   ```bash
   fly secrets set WAVESPEED_API_KEY=tu_api_key
   fly secrets set CORS_ORIGINS=tu_dominio
   ```

5. **Desplegar:**
   ```bash
   fly deploy
   ```

6. **Obtener URL:**
   ```bash
   fly info
   ```

### Opción 4: Google Cloud Run

1. **Instalar Google Cloud SDK**

2. **Autenticarse:**
   ```bash
   gcloud auth login
   ```

3. **Crear Dockerfile** (si no existe):
   ```dockerfile
   FROM python:3.11-slim
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install --no-cache-dir -r requirements.txt
   COPY . .
   CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
   ```

4. **Desplegar:**
   ```bash
   gcloud run deploy wavespeed-proxy \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars WAVESPEED_API_KEY=tu_api_key
   ```

## 🧪 Testing

### Probar Health Check
```bash
curl http://localhost:8080/health
```

### Probar Crear Tarea de Video
```bash
curl -X POST http://localhost:8080/api/wavespeed/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "model": "wan-i2v-720p",
    "prompt": "A chimpanzee hosting a news show",
    "aspect_ratio": "16:9"
  }'
```

## 📝 Logs

El backend incluye logging estructurado. Los logs incluyen:
- Creación de tareas
- Errores de API
- Timeouts
- Excepciones no manejadas

En producción, los logs estarán disponibles en el dashboard de tu plataforma de despliegue.

## 🔒 Seguridad

- **Nunca** expongas tu `WAVESPEED_API_KEY` en el frontend
- El backend maneja toda la autenticación con Wavespeed
- CORS está configurado para permitir solo orígenes específicos
- Los errores detallados solo se muestran si `DEBUG=true`

## 🐛 Troubleshooting

### Error: "WAVESPEED_API_KEY not configured"
- Verifica que la variable de entorno esté configurada
- Reinicia el servidor después de agregar la variable

### Error: "CORS error" en el frontend
- Verifica que tu dominio esté en `CORS_ORIGINS`
- Asegúrate de que no haya espacios en la lista de orígenes

### Error: "Connection refused"
- Verifica que el servidor esté corriendo
- Verifica que el puerto sea correcto
- Verifica que `VITE_BACKEND_URL` apunte a la URL correcta

## 📚 Documentación Adicional

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Wavespeed API Documentation](https://docs.wavespeed.ai/)
- [Railway Documentation](https://docs.railway.app/)
- [Render Documentation](https://render.com/docs)
