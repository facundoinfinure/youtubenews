# 🚀 Guía Paso a Paso - Instalación y Deployment de ChimpNews

Esta guía te llevará paso a paso para instalar y desplegar ChimpNews con Ovi y Gemini VEO 3.

---

## 📋 Tabla de Contenidos

1. [Requisitos Previos](#requisitos-previos)
2. [Paso 1: Configurar Frontend (Vercel)](#paso-1-configurar-frontend-vercel)
3. [Paso 2: Configurar Backend (Google Cloud)](#paso-2-configurar-backend-google-cloud)
4. [Paso 3: Instalar Ovi (Opcional)](#paso-3-instalar-ovi-opcional)
5. [Paso 4: Conectar Frontend y Backend](#paso-4-conectar-frontend-y-backend)
6. [Verificación y Pruebas](#verificación-y-pruebas)

---

## ✅ Requisitos Previos

Antes de comenzar, necesitas:

- ✅ Cuenta de GitHub (ya tienes el repo: `facundoinfinure/youtubenews`)
- ✅ Cuenta de Vercel (gratis)
- ✅ Cuenta de Google Cloud Platform (GCP)
- ✅ Cuenta de Supabase (gratis)
- ✅ API Key de Gemini (de Google AI Studio)
- ✅ OAuth Client ID de Google (para YouTube)

---

## 📱 Paso 1: Configurar Frontend (Vercel)

### 1.1 Conectar Repositorio a Vercel

1. Ve a [vercel.com](https://vercel.com) e inicia sesión
2. Click en **"Add New Project"**
3. Importa el repositorio: `facundoinfinure/youtubenews`
4. Vercel detectará automáticamente que es un proyecto Vite/React

### 1.2 Configurar Variables de Entorno en Vercel

En la configuración del proyecto, ve a **Settings → Environment Variables** y agrega:

```
VITE_ADMIN_EMAIL=tu-email@gmail.com
VITE_GEMINI_API_KEY=tu-gemini-api-key
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-supabase-anon-key
VITE_GOOGLE_CLIENT_ID=tu-google-client-id
VITE_BACKEND_URL=https://tu-backend-url.com
```

**⚠️ IMPORTANTE:** `VITE_BACKEND_URL` lo configurarás después del Paso 2.

### 1.3 Deploy

1. Click en **"Deploy"**
2. Espera a que termine el build
3. Copia la URL de tu app (ej: `https://chimpnews.vercel.app`)

---

## 🖥️ Paso 2: Configurar Backend (Google Cloud)

Tienes 2 opciones:

### Opción A: Compute Engine con GPU (Recomendado para Ovi)

**Costo:** ~$0.50-2.00/hora (puedes usar instancias preemptibles más baratas)

#### 2.1 Crear Proyecto en GCP

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Crea un nuevo proyecto o selecciona uno existente
3. Habilita la facturación (necesario para GPUs)

#### 2.2 Habilitar APIs Necesarias

```bash
# Instala Google Cloud SDK si no lo tienes
# https://cloud.google.com/sdk/docs/install

gcloud config set project TU-PROJECT-ID
gcloud services enable compute.googleapis.com
gcloud services enable containerregistry.googleapis.com
```

#### 2.3 Crear Instancia con GPU

```bash
# Opción 1: Usar el script automatizado
cd backend
chmod +x deploy-gcp.sh
export GCP_PROJECT_ID=tu-project-id
export GEMINI_API_KEY=tu-gemini-key
./deploy-gcp.sh

# Opción 2: Crear manualmente desde la consola
# Ve a Compute Engine → VM Instances → Create Instance
# - Machine type: n1-standard-4 (o mayor)
# - GPU: 1x NVIDIA T4 (o mejor)
# - Image: Ubuntu 22.04 LTS
# - Boot disk: 100GB
```

#### 2.4 Conectar a la Instancia

```bash
# Obtén la IP externa de tu instancia
gcloud compute instances list

# Conecta por SSH
gcloud compute ssh chimpnews-backend --zone=us-central1-a
```

#### 2.5 Instalar Dependencias en la Instancia

```bash
# Una vez dentro de la instancia SSH:

# 1. Instalar Python y dependencias
sudo apt update
sudo apt install -y python3-pip git docker.io

# 2. Instalar NVIDIA drivers (si no están instalados)
sudo apt install -y nvidia-driver-535
sudo reboot  # Reinicia la instancia

# 3. Después del reboot, instala Docker con GPU
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# 4. Clonar tu repositorio
git clone https://github.com/facundoinfinure/youtubenews.git
cd youtubenews/backend

# 5. Crear archivo .env
nano .env
```

#### 2.6 Configurar Variables de Entorno del Backend

Crea `backend/.env` con:

```env
PORT=8080
ALLOWED_ORIGINS=https://tu-app.vercel.app,http://localhost:5173
GEMINI_API_KEY=tu-gemini-api-key
OVI_PATH=/app/ovi
LOG_LEVEL=INFO
```

#### 2.7 Instalar y Ejecutar Backend

```bash
# Opción 1: Con Docker (Recomendado)
docker build -t chimpnews-backend .
docker run -d -p 8080:8080 \
  --gpus all \
  --env-file .env \
  --name chimpnews-backend \
  chimpnews-backend

# Opción 2: Directamente con Python
pip3 install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

#### 2.8 Configurar Firewall

```bash
# Permitir tráfico en el puerto 8080
gcloud compute firewall-rules create allow-backend-8080 \
  --allow tcp:8080 \
  --source-ranges 0.0.0.0/0 \
  --target-tags http-server
```

#### 2.9 Obtener URL del Backend

Tu backend estará disponible en: `http://TU-IP-EXTERNA:8080`

**Ejemplo:** `http://34.123.45.67:8080`

---

### Opción B: Cloud Run (Sin GPU, Solo Gemini)

**Costo:** Pay-per-use, muy económico para empezar

#### 2.1 Habilitar APIs

```bash
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
```

#### 2.2 Deploy con Script

```bash
cd backend
chmod +x deploy-cloud-run.sh
export GCP_PROJECT_ID=tu-project-id
export GEMINI_API_KEY=tu-gemini-key
export ALLOWED_ORIGINS=https://tu-app.vercel.app
./deploy-cloud-run.sh
```

El script te dará la URL del backend automáticamente.

**⚠️ Nota:** Cloud Run no soporta GPUs, así que solo usará Gemini VEO 3.

---

## 🎬 Paso 3: Instalar Ovi (Opcional)

Solo si usaste **Opción A (Compute Engine con GPU)**:

### 3.1 Clonar e Instalar Ovi

```bash
# En tu instancia de Compute Engine
cd /opt
git clone https://github.com/character-ai/Ovi.git
cd Ovi
pip3 install -r requirements.txt

# Descargar pesos del modelo (si es necesario)
# Sigue las instrucciones del README de Ovi
```

### 3.2 Configurar Ovi en el Backend

Actualiza `backend/.env`:

```env
OVI_PATH=/opt/Ovi
```

Reinicia el backend:

```bash
docker restart chimpnews-backend
# o si usas Python directamente, reinicia uvicorn
```

---

## 🔗 Paso 4: Conectar Frontend y Backend

### 4.1 Actualizar Variable de Entorno en Vercel

1. Ve a tu proyecto en Vercel
2. Settings → Environment Variables
3. Actualiza `VITE_BACKEND_URL` con la URL de tu backend:
   - Compute Engine: `http://TU-IP:8080` o `https://tu-dominio.com`
   - Cloud Run: La URL que te dio el script

### 4.2 Redeploy Frontend

1. En Vercel, ve a **Deployments**
2. Click en los 3 puntos del último deployment
3. Click en **"Redeploy"**

---

## ✅ Verificación y Pruebas

### 1. Verificar Backend

```bash
# Desde tu computadora o navegador
curl http://TU-BACKEND-URL/health

# Deberías ver:
# {
#   "status": "healthy",
#   "ovi_available": true/false,
#   "gemini_available": true
# }
```

### 2. Verificar Frontend

1. Abre tu app en Vercel
2. Inicia sesión con Google
3. Selecciona un canal
4. Elige una fecha
5. Click en "Start Production"

### 3. Verificar Generación de Video

- Si Ovi está disponible: Usará Ovi primero
- Si Ovi falla: Automáticamente usará Gemini VEO 3
- Los logs mostrarán qué proveedor se usó

---

## 🐛 Solución de Problemas

### Backend no responde

```bash
# Verificar que el contenedor está corriendo
docker ps

# Ver logs
docker logs chimpnews-backend

# Verificar firewall
gcloud compute firewall-rules list
```

### Error de CORS

- Verifica que `ALLOWED_ORIGINS` en el backend incluya tu URL de Vercel
- Asegúrate de incluir `https://` en la URL

### Ovi no disponible

- Verifica que los drivers de NVIDIA estén instalados: `nvidia-smi`
- Verifica que Docker tenga acceso a GPU: `docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi`
- El backend automáticamente usará Gemini como fallback

### Error 429 de Gemini

- Has excedido la cuota de Gemini
- Espera o actualiza tu plan en Google AI Studio
- Considera usar Ovi para evitar límites

---

## 📊 Costos Estimados

### Opción A: Compute Engine con GPU
- **T4 GPU:** ~$0.35/hora
- **n1-standard-4:** ~$0.19/hora
- **Total:** ~$0.54/hora (~$13/día si corre 24/7)
- **Preemptible:** 60-80% más barato pero puede ser interrumpido

### Opción B: Cloud Run
- **Solo pagas por uso:** ~$0.00002400 por request
- **Muy económico para empezar**

---

## 🎉 ¡Listo!

Tu aplicación debería estar funcionando. Si tienes problemas, revisa los logs:

- **Backend:** `docker logs chimpnews-backend`
- **Frontend:** Logs en Vercel Dashboard

---

## 📞 Próximos Pasos

1. Configurar dominio personalizado (opcional)
2. Configurar SSL/HTTPS para el backend (usando Cloud Load Balancer)
3. Optimizar costos usando instancias preemptibles
4. Configurar monitoreo y alertas

