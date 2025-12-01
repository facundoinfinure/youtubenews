#!/bin/bash
# Deployment script for ChimpNews backend on Google Cloud Platform
# This script deploys the FastAPI backend to GCP Compute Engine with GPU support

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-your-project-id}"
REGION="${GCP_REGION:-us-central1}"
ZONE="${GCP_ZONE:-us-central1-a}"
INSTANCE_NAME="${INSTANCE_NAME:-chimpnews-backend}"
MACHINE_TYPE="${MACHINE_TYPE:-n1-standard-4}"
GPU_TYPE="${GPU_TYPE:-nvidia-tesla-t4}"
GPU_COUNT="${GPU_COUNT:-1}"
IMAGE_FAMILY="${IMAGE_FAMILY:-ubuntu-2204-lts}"
IMAGE_PROJECT="${IMAGE_PROJECT:-ubuntu-os-cloud}"
DISK_SIZE="${DISK_SIZE:-100GB}"

echo "🚀 Deploying ChimpNews Backend to GCP"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Zone: $ZONE"
echo "Instance: $INSTANCE_NAME"

# Set GCP project
gcloud config set project $PROJECT_ID

# Check if instance already exists
if gcloud compute instances describe $INSTANCE_NAME --zone=$ZONE &>/dev/null; then
    echo "⚠️  Instance $INSTANCE_NAME already exists. Stopping it first..."
    gcloud compute instances stop $INSTANCE_NAME --zone=$ZONE
    echo "🔄 Updating instance configuration..."
    
    # Update machine type if needed
    gcloud compute instances set-machine-type $INSTANCE_NAME \
        --machine-type=$MACHINE_TYPE \
        --zone=$ZONE
    
    # Attach GPU if not already attached
    if ! gcloud compute instances describe $INSTANCE_NAME --zone=$ZONE | grep -q "guestAccelerators"; then
        echo "📦 Attaching GPU..."
        gcloud compute instances attach-gpu $INSTANCE_NAME \
            --zone=$ZONE \
            --accelerator-type=$GPU_TYPE \
            --accelerator-count=$GPU_COUNT
    fi
    
    gcloud compute instances start $INSTANCE_NAME --zone=$ZONE
else
    echo "🆕 Creating new GPU instance..."
    
    # Create instance with GPU
    gcloud compute instances create $INSTANCE_NAME \
        --zone=$ZONE \
        --machine-type=$MACHINE_TYPE \
        --accelerator=type=$GPU_TYPE,count=$GPU_COUNT \
        --maintenance-policy=TERMINATE \
        --image-family=$IMAGE_FAMILY \
        --image-project=$IMAGE_PROJECT \
        --boot-disk-size=$DISK_SIZE \
        --boot-disk-type=pd-standard \
        --metadata=startup-script='#!/bin/bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
usermod -aG docker $USER

# Install NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | tee /etc/apt/sources.list.d/nvidia-docker.list
apt-get update && apt-get install -y nvidia-container-toolkit
systemctl restart docker

# Install Python and dependencies
apt-get update
apt-get install -y python3-pip git
pip3 install docker-compose

# Clone repository (adjust URL as needed)
# git clone https://github.com/your-repo/chimpnews.git /opt/chimpnews-backend
'
fi

# Wait for instance to be ready
echo "⏳ Waiting for instance to be ready..."
sleep 30

# Get instance IP
INSTANCE_IP=$(gcloud compute instances describe $INSTANCE_NAME --zone=$ZONE --format='get(networkInterfaces[0].accessConfigs[0].natIP)')
echo "✅ Instance ready at: $INSTANCE_IP"

# Copy files to instance (if using gcloud compute scp)
echo "📤 Copying backend files to instance..."
gcloud compute scp --recurse ./backend $INSTANCE_NAME:/opt/chimpnews-backend --zone=$ZONE || echo "⚠️  SCP failed, you may need to copy files manually"

# Setup instructions
echo ""
echo "📋 Next steps:"
echo "1. SSH into the instance:"
echo "   gcloud compute ssh $INSTANCE_NAME --zone=$ZONE"
echo ""
echo "2. Navigate to backend directory:"
echo "   cd /opt/chimpnews-backend"
echo ""
echo "3. Build and run Docker container:"
echo "   docker build -t chimpnews-backend ."
echo "   docker run -d -p 8080:8080 --gpus all -e GEMINI_API_KEY=your_key chimpnews-backend"
echo ""
echo "4. Or install Ovi and run directly:"
echo "   pip3 install -r requirements.txt"
echo "   uvicorn main:app --host 0.0.0.0 --port 8080"
echo ""
echo "5. Configure firewall rule:"
echo "   gcloud compute firewall-rules create allow-backend-8080 \\"
echo "     --allow tcp:8080 \\"
echo "     --source-ranges 0.0.0.0/0 \\"
echo "     --target-tags http-server"
echo ""
echo "Backend URL: http://$INSTANCE_IP:8080"

