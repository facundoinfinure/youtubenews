# 💰 Guía de Costos - ChimpNews

## Comparación de Opciones

| Opción | Costo Mensual | GPU | Ovi | Mejor Para |
|--------|---------------|-----|-----|------------|
| **Cloud Run** | $5-20 | ❌ | ❌ | Desarrollo, pruebas |
| **Compute Preemptible** | $90-100 | ✅ | ✅ | Producción económica |
| **Compute Normal** | $330+ | ✅ | ✅ | Producción 24/7 |
| **Sin Backend** | $0* | ❌ | ❌ | Pruebas iniciales |

*Solo pagas por uso de Gemini API

---

## 💡 Recomendaciones por Caso de Uso

### 🧪 Desarrollo y Pruebas
**Usa: Cloud Run**
- Costo: ~$5-20/mes
- Solo pagas cuando generas videos
- Perfecto para probar la funcionalidad

### 🚀 Producción con Presupuesto Limitado
**Usa: Compute Engine Preemptible**
- Costo: ~$90-100/mes
- Tiene GPU para Ovi
- Puede ser interrumpida pero se reinicia automáticamente
- **Ahorro:** Apaga cuando no la uses (solo pagas por horas de uso)

### 🏢 Producción Empresarial
**Usa: Compute Engine Normal**
- Costo: ~$330+/mes
- Disponibilidad garantizada 24/7
- Sin interrupciones

---

## 🎯 Cómo Reducir Costos

### 1. Usa Instancias Preemptibles
- **Ahorro:** 60-80% del costo
- **Desventaja:** Pueden ser interrumpidas (pero se reinician automáticamente)

### 2. Apaga la Instancia Cuando No la Uses
- Solo pagas por horas de uso real
- Ejemplo: Si la usas 8 horas/día = ~$30/mes en lugar de $100/mes

### 3. Usa Cloud Run para Empezar
- Perfecto para desarrollo
- Migra a Compute Engine solo cuando necesites Ovi

### 4. Optimiza el Tamaño de la Instancia
- **n1-standard-1** es suficiente para Ovi (no necesitas n1-standard-4)
- Ahorro: ~$50/mes

### 5. Usa Disco Más Pequeño
- 30GB es suficiente para empezar (en lugar de 100GB)
- Ahorro: ~$2/mes

---

## 📊 Ejemplo de Costos Reales

### Escenario 1: Desarrollo Activo (4 horas/día)
- **Cloud Run:** ~$10/mes
- **Compute Preemptible:** ~$12/mes (solo cuando está encendida)
- **Recomendado:** Cloud Run

### Escenario 2: Producción Ligera (8 horas/día)
- **Cloud Run:** ~$15/mes
- **Compute Preemptible:** ~$25/mes
- **Recomendado:** Compute Preemptible (tienes Ovi disponible)

### Escenario 3: Producción 24/7
- **Cloud Run:** ~$20/mes (solo Gemini)
- **Compute Preemptible:** ~$100/mes (con Ovi)
- **Compute Normal:** ~$330/mes (con Ovi, sin interrupciones)
- **Recomendado:** Compute Preemptible (a menos que necesites garantía 24/7)

---

## 🛠️ Script para Apagar/Encender Instancia

Crea un script para ahorrar dinero:

```bash
# apagar-instancia.sh
gcloud compute instances stop chimpnews-backend --zone=us-central1-a

# encender-instancia.sh
gcloud compute instances start chimpnews-backend --zone=us-central1-a
```

**Uso:** Apaga la instancia cuando termines de trabajar, enciéndela cuando la necesites.

---

## 💰 Estimador de Costos de Google Cloud

Usa la calculadora oficial:
https://cloud.google.com/products/calculator

1. Selecciona "Compute Engine"
2. Configura tu instancia
3. Marca "Preemptible" para ver el ahorro
4. Ajusta las horas de uso

---

## ⚠️ Costos Ocultos a Considerar

1. **Tráfico de Red:** ~$0.12/GB después de los primeros 1GB/mes (gratis)
2. **Snapshots:** ~$0.026/GB/mes si haces backups
3. **IP Estática:** ~$1.46/mes si necesitas IP fija
4. **Logging:** Primeros 50GB/mes gratis, luego ~$0.50/GB

**Total adicional estimado:** ~$2-5/mes

---

## 🎯 Mi Recomendación Personal

**Para empezar:**
1. Usa **Cloud Run** ($5-20/mes)
2. Prueba la funcionalidad completa
3. Si necesitas Ovi, migra a **Compute Preemptible** ($90-100/mes)
4. Apaga la instancia cuando no la uses

**Ahorro total:** Puedes empezar con menos de $20/mes y escalar según necesites.

