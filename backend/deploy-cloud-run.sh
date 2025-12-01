#!/bin/bash
# Alternative deployment: Google Cloud Run (serverless, but no GPU support)
# Note: Cloud Run doesn't support GPUs, so this uses Gemini fallback only

set -e

PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-chimpnews-backend}"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "🚀 Deploying ChimpNews Backend to Cloud Run"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"

# Set project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable cloudbuild.googleapis.com
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com

# Build and push Docker image
echo "📦 Building Docker image..."
gcloud builds submit --tag $IMAGE_NAME

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image $IMAGE_NAME \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --memory 4Gi \
    --cpu 2 \
    --timeout 900 \
    --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY},ALLOWED_ORIGINS=${ALLOWED_ORIGINS:-*}"

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
echo ""
echo "✅ Service deployed!"
echo "Backend URL: $SERVICE_URL"
echo ""
echo "⚠️  Note: Cloud Run doesn't support GPUs, so Ovi will not be available."
echo "   The service will use Gemini VEO 3 fallback only."

