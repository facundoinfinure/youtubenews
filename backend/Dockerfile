# Use NVIDIA CUDA base image for GPU support
FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# Set working directory
WORKDIR /app

# Install Python and system dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Install Ovi from GitHub
# Note: Adjust this based on actual Ovi installation method
RUN pip3 install git+https://github.com/character-ai/Ovi.git || echo "Ovi installation failed, will use fallback"

# Copy application code
COPY . .

# Expose port
EXPOSE 8080

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python3 -c "import requests; requests.get('http://localhost:8080/health')" || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]

