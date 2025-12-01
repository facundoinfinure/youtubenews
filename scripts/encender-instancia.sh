#!/bin/bash
# Script para encender la instancia de Compute Engine

set -e

# Configuración
PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
INSTANCE_NAME="${INSTANCE_NAME:-chimpnews-backend}"
ZONE="${GCP_ZONE:-us-central1-a}"

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}🚀 Encendiendo instancia...${NC}"

# Verificar que las variables estén configuradas
if [ "$PROJECT_ID" == "your-project-id" ]; then
    echo "⚠️  Error: Debes configurar GCP_PROJECT_ID"
    echo "Ejemplo: export GCP_PROJECT_ID=mi-proyecto"
    exit 1
fi

# Configurar proyecto
gcloud config set project $PROJECT_ID > /dev/null 2>&1

# Verificar estado actual
STATUS=$(gcloud compute instances describe $INSTANCE_NAME \
    --zone=$ZONE \
    --format='get(status)' 2>/dev/null || echo "NOT_FOUND")

if [ "$STATUS" == "NOT_FOUND" ]; then
    echo "❌ Instancia no encontrada: $INSTANCE_NAME"
    exit 1
fi

if [ "$STATUS" == "RUNNING" ]; then
    echo "ℹ️  La instancia ya está encendida"
else
    # Encender instancia
    echo "⚡ Encendiendo instancia $INSTANCE_NAME..."
    gcloud compute instances start $INSTANCE_NAME --zone=$ZONE
    
    echo "⏳ Esperando que la instancia esté lista..."
    sleep 30
fi

# Obtener IP externa
IP=$(gcloud compute instances describe $INSTANCE_NAME \
    --zone=$ZONE \
    --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo -e "${GREEN}✅ Instancia encendida!${NC}"
echo ""
echo "📍 Backend URL: http://$IP:8080"
echo ""
echo "🔍 Verificando salud del backend..."
sleep 10

# Verificar que el backend responde
if curl -s -f "http://$IP:8080/health" > /dev/null; then
    echo -e "${GREEN}✅ Backend respondiendo correctamente${NC}"
else
    echo -e "${YELLOW}⚠️  Backend aún no responde. Espera unos minutos más.${NC}"
    echo "   Puede tomar 1-2 minutos para que el backend se inicie completamente"
fi

echo ""
echo "💡 Para apagar cuando termines: ./scripts/apagar-instancia.sh"

