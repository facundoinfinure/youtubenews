# Comandos Git para Commit y Push

## Opción 1: Commit con mensaje descriptivo (Recomendado)

```bash
git commit -m "feat: Mejoras UX/UI móvil y sistema de audio con Supabase Storage

- Mejoras UX/UI móvil: botones más grandes, mejor spacing, sin scroll horizontal
- Sistema de música de fondo y efectos de sonido con timing preciso
- Integración con Supabase Storage para almacenar archivos de audio
- Endpoint API en Vercel para subir archivos de audio automáticamente
- Scripts para subir archivos de audio a Supabase Storage
- Extensión de tipos Scene para incluir metadata de efectos de sonido
- Actualización de generación de scripts para incluir timing preciso de efectos"
```

## Opción 2: Commit simple

```bash
git commit -m "feat: Mejoras móvil y sistema de audio con Supabase"
```

## Push al repositorio remoto

```bash
git push origin main
```

## O hacer todo en una línea

```bash
git commit -m "feat: Mejoras UX/UI móvil y sistema de audio con Supabase Storage" && git push origin main
```

---

## 🎵 Después del Push: Subir Audio a Supabase

Una vez que Vercel despliegue los cambios, ejecuta el endpoint para subir los archivos de audio:

### En PowerShell:

```powershell
# 1. Configura tu URL de Vercel (reemplaza con tu URL real)
$env:VERCEL_URL = "https://tu-proyecto.vercel.app"

# 2. Ejecuta el script
.\scripts\run-upload-audio.ps1
```

### O manualmente con curl/PowerShell:

```powershell
$vercelUrl = "https://tu-proyecto.vercel.app"

Invoke-RestMethod -Uri "$vercelUrl/api/upload-audio" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"music": true, "soundEffects": true}'
```

Ver más detalles en `INSTRUCCIONES_AUDIO.md`
