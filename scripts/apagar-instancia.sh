#!/bin/bash
# Script para apagar la instancia de Compute Engine y ahorrar dinero

set -e

# Configuración
PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
INSTANCE_NAME="${INSTANCE_NAME:-chimpnews-backend}"
ZONE="${GCP_ZONE:-us-central1-a}"

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}💰 Apagando instancia para ahorrar dinero...${NC}"

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

if [ "$STATUS" == "TERMINATED" ]; then
    echo "ℹ️  La instancia ya está apagada"
    exit 0
fi

# Apagar instancia
echo "🛑 Apagando instancia $INSTANCE_NAME..."
gcloud compute instances stop $INSTANCE_NAME --zone=$ZONE

echo ""
echo -e "${GREEN}✅ Instancia apagada exitosamente${NC}"
echo ""
echo "💰 Ahorrando dinero mientras está apagada"
echo "Para encender: ./scripts/encender-instancia.sh"
echo ""
echo "💡 Tip: Solo pagas por las horas que la instancia está encendida"

