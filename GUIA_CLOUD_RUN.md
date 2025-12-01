# ⭐ Guía Rápida: Deploy a Cloud Run

Esta es la forma más fácil y económica de desplegar el backend de ChimpNews.

## ✅ Requisitos Previos

1. Cuenta de Google Cloud Platform
2. Google Cloud SDK instalado ([instalar aquí](https://cloud.google.com/sdk/docs/install))
3. API Key de Gemini

## 🚀 Pasos Rápidos

### 1. Configurar Variables de Entorno

```bash
# Reemplaza con tus valores reales
export GCP_PROJECT_ID=tu-proyecto-id
export GEMINI_API_KEY=tu-gemini-api-key
export ALLOWED_ORIGINS=https://tu-app.vercel.app
```

**💡 Tip:** Si no tienes la URL de Vercel aún, usa `*` temporalmente:
```bash
export ALLOWED_ORIGINS=*
```

### 2. Ejecutar Script de Deployment

```bash
cd backend
chmod +x deploy-cloud-run.sh
./deploy-cloud-run.sh
```

El script hará todo automáticamente:
- ✅ Habilitará las APIs necesarias
- ✅ Construirá la imagen Docker
- ✅ Desplegará a Cloud Run
- ✅ Te dará la URL del backend

**⏱️ Tiempo estimado:** 5-10 minutos

### 3. Copiar URL del Backend

El script te mostrará algo como:
```
📍 URL del Backend: https://chimpnews-backend-xxxxx-uc.a.run.app
```

**Copia esta URL** - la necesitarás para el frontend.

### 4. Configurar Frontend en Vercel

1. Ve a tu proyecto en [Vercel](https://vercel.com)
2. Settings → Environment Variables
3. Agrega o actualiza:
   ```
   VITE_BACKEND_URL=https://chimpnews-backend-xxxxx-uc.a.run.app
   ```
4. Ve a Deployments → Click en los 3 puntos → Redeploy

### 5. ¡Listo!

Tu backend está funcionando. Prueba:

```bash
curl https://tu-backend-url/health
```

Deberías ver:
```json
{
  "status": "healthy",
  "ovi_available": false,
  "gemini_available": true
}
```

---

## 🔧 Configuración Manual (Si Prefieres)

Si prefieres hacerlo paso a paso:

### Paso 1: Habilitar APIs

```bash
gcloud config set project TU-PROJECT-ID
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

### Paso 2: Construir Imagen

```bash
cd backend
gcloud builds submit --tag gcr.io/TU-PROJECT-ID/chimpnews-backend
```

### Paso 3: Desplegar

```bash
gcloud run deploy chimpnews-backend \
  --image gcr.io/TU-PROJECT-ID/chimpnews-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 4Gi \
  --cpu 2 \
  --timeout 900 \
  --set-env-vars "GEMINI_API_KEY=tu-key,ALLOWED_ORIGINS=https://tu-app.vercel.app"
```

---

## 💰 Costos

- **Sin uso:** $0
- **Con uso moderado:** $5-20/mes
- **Con uso intensivo:** $20-50/mes

Solo pagas por:
- Requests procesados
- Memoria/CPU usada durante ejecución
- Tráfico de red (primeros 1GB/mes gratis)

---

## 🐛 Solución de Problemas

### Error: "Project not found"
```bash
# Verifica tu proyecto
gcloud projects list

# Configura el proyecto correcto
gcloud config set project TU-PROJECT-ID
```

### Error: "API not enabled"
```bash
# Habilita las APIs manualmente
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
```

### Error: "Permission denied"
```bash
# Verifica que tienes los permisos necesarios
gcloud projects get-iam-policy TU-PROJECT-ID
```

### El backend no responde
```bash
# Verifica los logs
gcloud run services logs read chimpnews-backend --region us-central1

# Verifica el estado
gcloud run services describe chimpnews-backend --region us-central1
```

---

## 🔄 Actualizar el Backend

Cuando hagas cambios:

```bash
cd backend
./deploy-cloud-run.sh
```

El script reconstruirá y redesplegará automáticamente.

---

## 📊 Monitoreo

Ver uso y costos:
1. Ve a [Cloud Console](https://console.cloud.google.com)
2. Cloud Run → chimpnews-backend
3. Verás métricas de uso, requests, y costos

---

## ✅ Ventajas de Cloud Run

- ✅ **Económico:** Solo pagas por uso
- ✅ **Escalable:** Escala automáticamente
- ✅ **Fácil:** Sin servidores que mantener
- ✅ **Rápido:** Deployment en minutos
- ✅ **Seguro:** HTTPS incluido

## ⚠️ Limitaciones

- ❌ No soporta GPUs (no puedes usar Ovi)
- ❌ Timeout máximo: 15 minutos por request
- ❌ Cold start: Primera request puede ser lenta (~5-10 segundos)

Para producción con Ovi, considera migrar a Compute Engine más adelante.

