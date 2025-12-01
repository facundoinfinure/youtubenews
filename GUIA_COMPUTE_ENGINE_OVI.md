# 🚀 Guía Completa: Compute Engine Preemptible con Ovi

Esta guía te llevará paso a paso para configurar Compute Engine Preemptible con GPU para usar Ovi, optimizando costos apagando la instancia cuando no la uses.

## 💰 Costos

- **Si corre 24/7:** ~$90-100/mes
- **Si la apagas cuando no la usas (8 horas/día):** ~$25-30/mes
- **Solo pagas por las horas que está encendida**

**Ahorro:** Puedes reducir costos en 70-80% apagando cuando no la uses.

---

## ✅ Requisitos Previos

1. Cuenta de Google Cloud Platform
2. Facturación habilitada (necesario para GPUs)
3. Google Cloud SDK instalado
4. API Key de Gemini (para fallback)

---

## 📋 Paso 1: Crear Instancia Preemptible con GPU

### Opción A: Desde la Consola Web (Recomendado)

1. Ve a [Google Cloud Console](https://console.cloud.google.com)
2. Compute Engine → VM Instances → Create Instance

**Configuración Recomendada:**

```
Nombre: chimpnews-backend
Región: us-central1 (más barato)
Zona: Cualquiera (Google puede elegir automáticamente)

Machine Configuration:
- Series: N1
- Machine type: n1-standard-2 (2 vCPU, 7.5 GB RAM) - suficiente para Ovi
- ✅ Marca "Preemptible" (MUY IMPORTANTE - reduce costo 70%)

GPU:
- ✅ Marca "GPU"
- GPU type: NVIDIA T4
- Number of GPUs: 1

Boot disk:
- OS: Ubuntu 22.04 LTS
- Size: 30GB (suficiente para empezar)

Firewall:
- ✅ Allow HTTP traffic
- ✅ Allow HTTPS traffic
```

3. Click en **"Create"**

**⏱️ Tiempo:** 2-5 minutos

### Opción B: Desde la Línea de Comandos

```bash
# Configurar proyecto
export GCP_PROJECT_ID=tu-proyecto-id
export ZONE=us-central1-a

gcloud config set project $GCP_PROJECT_ID

# Crear instancia preemptible con GPU
gcloud compute instances create chimpnews-backend \
  --zone=$ZONE \
  --machine-type=n1-standard-2 \
  --preemptible \
  --accelerator=type=nvidia-tesla-t4,count=1 \
  --maintenance-policy=TERMINATE \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --tags=http-server,https-server
```

---

## 📋 Paso 2: Conectar a la Instancia

```bash
# Obtener IP externa
gcloud compute instances list

# Conectar por SSH
gcloud compute ssh chimpnews-backend --zone=us-central1-a
```

---

## 📋 Paso 3: Instalar Drivers de NVIDIA

Una vez dentro de la instancia SSH:

```bash
# 1. Actualizar sistema
sudo apt update && sudo apt upgrade -y

# 2. Instalar drivers de NVIDIA
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers autoinstall

# 3. Reiniciar (necesario para cargar drivers)
sudo reboot
```

**⏱️ Tiempo:** 5-10 minutos (incluyendo reboot)

**Después del reboot:** Vuelve a conectar por SSH y verifica:

```bash
# Verificar que GPU está disponible
nvidia-smi

# Deberías ver información de la GPU T4
```

---

## 📋 Paso 4: Instalar Docker con Soporte GPU

```bash
# 1. Instalar Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# 2. Instalar NVIDIA Container Toolkit
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker

# 3. Verificar Docker con GPU
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi

# Deberías ver la información de la GPU
```

---

## 📋 Paso 5: Instalar Ovi

```bash
# 1. Instalar dependencias de Python
sudo apt install -y python3-pip python3-venv git

# 2. Clonar repositorio de Ovi
cd /opt
sudo git clone https://github.com/character-ai/Ovi.git
cd Ovi

# 3. Crear entorno virtual
python3 -m venv venv
source venv/bin/activate

# 4. Instalar dependencias de Ovi
pip install --upgrade pip
pip install -r requirements.txt

# 5. Descargar pesos del modelo (si es necesario)
# Sigue las instrucciones del README de Ovi
# Puede requerir descargar modelos grandes (varios GB)

# 6. Verificar instalación
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"
```

**⏱️ Tiempo:** 10-30 minutos (depende de la descarga de modelos)

---

## 📋 Paso 6: Instalar Backend de ChimpNews

```bash
# 1. Clonar repositorio
cd /opt
sudo git clone https://github.com/facundoinfinure/youtubenews.git
cd youtubenews/backend

# 2. Crear archivo .env
sudo nano .env
```

Contenido de `.env`:

```env
PORT=8080
ALLOWED_ORIGINS=https://tu-app.vercel.app,http://localhost:5173
GEMINI_API_KEY=tu-gemini-api-key
OVI_PATH=/opt/Ovi
LOG_LEVEL=INFO
```

```bash
# 3. Instalar dependencias de Python
sudo apt install -y python3-pip
pip3 install -r requirements.txt

# 4. Opción A: Ejecutar directamente
uvicorn main:app --host 0.0.0.0 --port 8080

# Opción B: Con Docker (recomendado)
sudo docker build -t chimpnews-backend .
sudo docker run -d \
  --name chimpnews-backend \
  --gpus all \
  -p 8080:8080 \
  --env-file .env \
  --restart=always \
  chimpnews-backend
```

---

## 📋 Paso 7: Configurar Firewall

```bash
# Permitir tráfico en puerto 8080
gcloud compute firewall-rules create allow-backend-8080 \
  --allow tcp:8080 \
  --source-ranges 0.0.0.0/0 \
  --target-tags http-server \
  --description "Allow backend API"
```

---

## 📋 Paso 8: Obtener URL del Backend

```bash
# Obtener IP externa
gcloud compute instances describe chimpnews-backend \
  --zone=us-central1-a \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

Tu backend estará en: `http://TU-IP:8080`

**💡 Tip:** Para tener una URL fija, configura un Load Balancer o usa un dominio con DNS.

---

## 💰 Paso 9: Scripts para Apagar/Encender (Ahorrar Dinero)

Crea estos scripts en tu computadora local:

### `apagar-instancia.sh`

```bash
#!/bin/bash
export GCP_PROJECT_ID=tu-proyecto-id
export ZONE=us-central1-a

gcloud config set project $GCP_PROJECT_ID
gcloud compute instances stop chimpnews-backend --zone=$ZONE

echo "✅ Instancia apagada. Ahorrando dinero 💰"
echo "Para encender: ./encender-instancia.sh"
```

### `encender-instancia.sh`

```bash
#!/bin/bash
export GCP_PROJECT_ID=tu-proyecto-id
export ZONE=us-central1-a

gcloud config set project $GCP_PROJECT_ID
gcloud compute instances start chimpnews-backend --zone=$ZONE

echo "⏳ Esperando que la instancia esté lista..."
sleep 30

# Obtener IP
IP=$(gcloud compute instances describe chimpnews-backend \
  --zone=$ZONE \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo "✅ Instancia encendida!"
echo "📍 Backend URL: http://$IP:8080"
echo "🔍 Verificar: curl http://$IP:8080/health"
```

### Hacer ejecutables:

```bash
chmod +x apagar-instancia.sh
chmod +x encender-instancia.sh
```

### Uso:

```bash
# Apagar cuando termines de trabajar
./apagar-instancia.sh

# Encender cuando la necesites
./encender-instancia.sh
```

**💰 Ahorro:** Si la apagas 16 horas/día, ahorras ~$60-70/mes

---

## 🔄 Paso 10: Configurar Auto-Start del Backend

Para que el backend se inicie automáticamente cuando la instancia se encienda:

### Opción A: Con systemd (Recomendado)

```bash
# En la instancia SSH
sudo nano /etc/systemd/system/chimpnews-backend.service
```

Contenido:

```ini
[Unit]
Description=ChimpNews Backend
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/youtubenews/backend
ExecStart=/usr/bin/docker start chimpnews-backend
ExecStop=/usr/bin/docker stop chimpnews-backend
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Habilitar servicio
sudo systemctl daemon-reload
sudo systemctl enable chimpnews-backend
sudo systemctl start chimpnews-backend
```

### Opción B: Con startup script

```bash
# Crear script de inicio
sudo nano /opt/start-backend.sh
```

Contenido:

```bash
#!/bin/bash
cd /opt/youtubenews/backend
docker start chimpnews-backend || docker run -d \
  --name chimpnews-backend \
  --gpus all \
  -p 8080:8080 \
  --env-file .env \
  --restart=always \
  chimpnews-backend
```

```bash
sudo chmod +x /opt/start-backend.sh

# Agregar a crontab para ejecutar al inicio
(crontab -l 2>/dev/null; echo "@reboot /opt/start-backend.sh") | crontab -
```

---

## ✅ Verificación

### 1. Verificar GPU

```bash
nvidia-smi
```

### 2. Verificar Ovi

```bash
cd /opt/Ovi
source venv/bin/activate
python3 -c "import torch; print(f'CUDA: {torch.cuda.is_available()}')"
```

### 3. Verificar Backend

```bash
# Desde tu computadora local
curl http://TU-IP:8080/health

# Deberías ver:
# {
#   "status": "healthy",
#   "ovi_available": true,
#   "gemini_available": true
# }
```

---

## 🐛 Solución de Problemas

### GPU no detectada

```bash
# Verificar drivers
nvidia-smi

# Si no funciona, reinstalar drivers
sudo apt remove --purge '^nvidia-.*'
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers autoinstall
sudo reboot
```

### Ovi no funciona

```bash
# Verificar CUDA en Python
cd /opt/Ovi
source venv/bin/activate
python3 -c "import torch; print(torch.cuda.is_available())"

# Debería mostrar: True
```

### Backend no responde

```bash
# Ver logs de Docker
docker logs chimpnews-backend

# Reiniciar contenedor
docker restart chimpnews-backend
```

### Instancia preemptible interrumpida

Las instancias preemptibles pueden ser detenidas por Google con 30 segundos de aviso. El backend se reiniciará automáticamente cuando vuelvas a encender la instancia (si configuraste auto-start).

---

## 💡 Tips para Optimizar Costos

1. **Apaga cuando no la uses:** Ahorra 70-80% del costo
2. **Usa instancias preemptibles:** 70% más baratas
3. **Monitorea uso:** Ve a Cloud Console → Compute Engine → Instances
4. **Configura alertas:** Para saber cuándo gastas mucho
5. **Usa scripts:** Automatiza apagar/encender

---

## 📊 Monitoreo de Costos

1. Ve a [Cloud Console](https://console.cloud.google.com)
2. Billing → Reports
3. Filtra por "Compute Engine"
4. Verás costos por hora/día/mes

---

## 🎯 Próximos Pasos

1. ✅ Configura el frontend en Vercel con `VITE_BACKEND_URL=http://TU-IP:8080`
2. ✅ Prueba generar un video
3. ✅ Verifica que Ovi se está usando (revisa logs)
4. ✅ Configura scripts para apagar/encender
5. ✅ Monitorea costos

---

## 📝 Resumen de Comandos Útiles

```bash
# Ver estado de instancia
gcloud compute instances list

# Apagar instancia
gcloud compute instances stop chimpnews-backend --zone=us-central1-a

# Encender instancia
gcloud compute instances start chimpnews-backend --zone=us-central1-a

# Conectar por SSH
gcloud compute ssh chimpnews-backend --zone=us-central1-a

# Ver logs del backend
gcloud compute ssh chimpnews-backend --zone=us-central1-a --command "docker logs chimpnews-backend"

# Verificar GPU
gcloud compute ssh chimpnews-backend --zone=us-central1-a --command "nvidia-smi"
```

---

¡Listo! Ahora tienes Ovi funcionando en Compute Engine Preemptible, optimizando costos apagando cuando no la uses. 💰

