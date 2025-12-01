#!/bin/bash
# ⭐ RECOMENDADO: Deployment a Google Cloud Run
# Serverless, económico, y fácil de configurar
# Nota: Cloud Run no soporta GPUs, usa Gemini VEO 3 directamente

set -e

# Configuración
PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-chimpnews-backend}"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Colores para output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Desplegando ChimpNews Backend a Cloud Run${NC}"
echo "Proyecto: $PROJECT_ID"
echo "Región: $REGION"
echo "Servicio: $SERVICE_NAME"
echo ""

# Verificar que las variables requeridas estén configuradas
if [ "$PROJECT_ID" == "your-project-id" ]; then
    echo -e "${YELLOW}⚠️  Error: Debes configurar GCP_PROJECT_ID${NC}"
    echo "Ejemplo: export GCP_PROJECT_ID=mi-proyecto"
    exit 1
fi

if [ -z "$GEMINI_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  Error: Debes configurar GEMINI_API_KEY${NC}"
    echo "Ejemplo: export GEMINI_API_KEY=tu-api-key"
    exit 1
fi

# Configurar proyecto
echo -e "${BLUE}📋 Configurando proyecto de GCP...${NC}"
gcloud config set project $PROJECT_ID

# Habilitar APIs necesarias
echo -e "${BLUE}🔧 Habilitando APIs necesarias...${NC}"
gcloud services enable cloudbuild.googleapis.com --quiet
gcloud services enable run.googleapis.com --quiet
gcloud services enable containerregistry.googleapis.com --quiet

# Construir y subir imagen Docker
echo -e "${BLUE}📦 Construyendo imagen Docker...${NC}"
echo "Esto puede tomar 5-10 minutos..."
gcloud builds submit --tag $IMAGE_NAME

# Desplegar a Cloud Run
echo -e "${BLUE}🚀 Desplegando a Cloud Run...${NC}"

# Configurar ALLOWED_ORIGINS si no está definido
if [ -z "$ALLOWED_ORIGINS" ]; then
    ALLOWED_ORIGINS="*"
    echo -e "${YELLOW}⚠️  ALLOWED_ORIGINS no configurado, usando '*' (permite todos)${NC}"
    echo "Para producción, configura: export ALLOWED_ORIGINS=https://tu-app.vercel.app"
fi

gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 4Gi \
    --cpu 2 \
    --timeout 900 \
    --min-instances 0 \
    --max-instances 10 \
    --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY},ALLOWED_ORIGINS=${ALLOWED_ORIGINS},PORT=8080" \
    --quiet

# Obtener URL del servicio
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')

echo ""
echo -e "${GREEN}✅ ¡Servicio desplegado exitosamente!${NC}"
echo ""
echo -e "${GREEN}📍 URL del Backend:${NC} $SERVICE_URL"
echo ""
echo -e "${BLUE}📝 Próximos pasos:${NC}"
echo "1. Copia la URL del backend: $SERVICE_URL"
echo "2. Ve a Vercel → Settings → Environment Variables"
echo "3. Agrega/actualiza: VITE_BACKEND_URL=$SERVICE_URL"
echo "4. Redeploy tu frontend en Vercel"
echo ""
echo -e "${YELLOW}ℹ️  Nota: Cloud Run no soporta GPUs, así que Ovi no estará disponible.${NC}"
echo "   El servicio usará Gemini VEO 3 directamente (más económico)."
echo ""
echo -e "${GREEN}💰 Costo estimado: ~\$5-20/mes (solo pagas por uso)${NC}"

