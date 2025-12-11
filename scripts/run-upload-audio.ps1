# Script PowerShell para ejecutar el endpoint de upload-audio en Vercel
# 
# Uso: .\scripts\run-upload-audio.ps1
# 
# Asegúrate de reemplazar $vercelUrl con tu URL de Vercel

param(
    [string]$VercelUrl = $env:VERCEL_URL,
    [switch]$Music = $true,
    [switch]$SoundEffects = $true
)

# Si no se proporciona URL, intentar detectarla desde git remote
if ([string]::IsNullOrEmpty($VercelUrl)) {
    try {
        $gitRemote = git remote get-url origin 2>$null
        if ($gitRemote -match 'vercel\.app') {
            $VercelUrl = $gitRemote -replace '.*@', 'https://' -replace '\.git$', '' -replace ':', '/'
        }
    } catch {
        # Ignorar errores
    }
}

if ([string]::IsNullOrEmpty($VercelUrl)) {
    Write-Host "❌ Error: Debes proporcionar la URL de Vercel" -ForegroundColor Red
    Write-Host ""
    Write-Host "Opciones:" -ForegroundColor Yellow
    Write-Host "  1. Como parámetro: .\scripts\run-upload-audio.ps1 -VercelUrl 'https://tu-proyecto.vercel.app'" -ForegroundColor Cyan
    Write-Host "  2. Variable de entorno: `$env:VERCEL_URL = 'https://tu-proyecto.vercel.app'" -ForegroundColor Cyan
    Write-Host "  3. Obtenerla desde Vercel Dashboard > Settings > Domains" -ForegroundColor Cyan
    Write-Host ""
    exit 1
}

$url = "$VercelUrl/api/upload-audio"
$body = @{
    music = $Music
    soundEffects = $SoundEffects
} | ConvertTo-Json

Write-Host "🚀 Ejecutando upload-audio en Vercel..." -ForegroundColor Cyan
Write-Host "   URL: $url" -ForegroundColor Gray
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $url `
        -Method POST `
        -ContentType "application/json" `
        -Body $body `
        -ErrorAction Stop

    Write-Host "✅ Proceso completado!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 Resumen:" -ForegroundColor Cyan
    Write-Host "   Música subida: $($response.summary.musicUploaded)" -ForegroundColor White
    Write-Host "   Efectos subidos: $($response.summary.soundEffectsUploaded)" -ForegroundColor White
    Write-Host "   Errores: $($response.summary.errors)" -ForegroundColor $(if ($response.summary.errors -gt 0) { "Yellow" } else { "White" })
    Write-Host ""
    
    if ($response.results.music.PSObject.Properties.Count -gt 0) {
        Write-Host "🎵 Música disponible:" -ForegroundColor Cyan
        $response.results.music.PSObject.Properties | ForEach-Object {
            Write-Host "   - $($_.Name): $($_.Value)" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    if ($response.results.soundEffects.PSObject.Properties.Count -gt 0) {
        Write-Host "🔊 Efectos de sonido disponibles:" -ForegroundColor Cyan
        $response.results.soundEffects.PSObject.Properties | ForEach-Object {
            Write-Host "   - $($_.Name): $($_.Value)" -ForegroundColor Gray
        }
        Write-Host ""
    }
    
    if ($response.results.errors.Count -gt 0) {
        Write-Host "⚠️  Errores:" -ForegroundColor Yellow
        $response.results.errors | ForEach-Object {
            Write-Host "   - $($_.file): $($_.error)" -ForegroundColor Red
        }
    }
    
} catch {
    Write-Host "❌ Error ejecutando el endpoint:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.ErrorDetails.Message) {
        Write-Host ""
        Write-Host "Detalles:" -ForegroundColor Yellow
        Write-Host $_.ErrorDetails.Message -ForegroundColor Gray
    }
    
    exit 1
}
