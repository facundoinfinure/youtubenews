# Configuración de Wavespeed Proxy en Vercel

Esta guía te ayudará a configurar el proxy de Wavespeed usando Vercel Serverless Functions.

## 📋 Pasos de Configuración

### 1. Instalar Dependencias

Ejecuta en tu terminal:

```bash
npm install --save-dev @vercel/node
```

### 2. Configurar Variables de Entorno en Vercel

1. Ve a tu proyecto en [Vercel Dashboard](https://vercel.com/dashboard)
2. Navega a **Settings** > **Environment Variables**
3. Agrega la siguiente variable:
   - **Name**: `WAVESPEED_API_KEY`
   - **Value**: Tu API key de Wavespeed
   - **Environment**: Production, Preview, Development (marca todas)

### 3. Configurar Variable en Frontend

En tu archivo `.env` o en Vercel Environment Variables, agrega:

```env
VITE_BACKEND_URL=https://tu-proyecto.vercel.app
```

**Nota**: Reemplaza `tu-proyecto.vercel.app` con la URL real de tu proyecto en Vercel.

Para obtener tu URL:
- Ve a tu proyecto en Vercel Dashboard
- La URL aparece en la parte superior (ej: `chimpnews.vercel.app`)
- O usa el dominio personalizado si lo tienes configurado

### 4. Desplegar

1. Haz commit y push de los cambios:
   ```bash
   git add .
   git commit -m "Add Wavespeed proxy for Vercel"
   git push
   ```

2. Vercel desplegará automáticamente

3. Verifica que el deployment sea exitoso

## ✅ Verificación

### 1. Verificar que el Endpoint Funciona

Abre en tu navegador o usa curl:

```bash
curl https://tu-proyecto.vercel.app/api/wavespeed-proxy/v1/tasks
```

Deberías recibir una respuesta (puede ser un error de autenticación, pero significa que el endpoint está funcionando).

### 2. Verificar desde el Frontend

Abre la consola del navegador y ejecuta:

```javascript
const { checkWavespeedConfig } = await import('./services/wavespeedProxy');
console.log(checkWavespeedConfig());
```

Debería mostrar:
```
{
  configured: true,
  message: "✅ Using backend proxy at https://tu-proyecto.vercel.app"
}
```

### 3. Probar una Llamada Real

En la consola del navegador:

```javascript
const { createWavespeedVideoTask } = await import('./services/wavespeedProxy');
// Esto debería funcionar sin errores de CORS
```

## 🔧 Estructura de Archivos

Después de la configuración, deberías tener:

```
tu-proyecto/
├── api/
│   └── [...path].ts          # Serverless function para Wavespeed
├── services/
│   └── wavespeedProxy.ts     # Cliente del proxy (ya existe)
└── package.json               # Con @vercel/node en devDependencies
```

## 📝 Endpoints Disponibles

El proxy soporta todos los endpoints de Wavespeed:

- `POST /api/wavespeed-proxy/v1/tasks` - Crear tarea de video
- `GET /api/wavespeed-proxy/v1/tasks/:taskId` - Obtener estado de tarea
- `POST /api/wavespeed-proxy/api/v3/google/nano-banana-pro/edit` - Crear tarea de imagen
- `GET /api/wavespeed-proxy/api/v3/predictions/:taskId/result` - Obtener resultado de imagen

## 🐛 Troubleshooting

### Error: "WAVESPEED_API_KEY not configured"

**Solución:**
1. Verifica que la variable esté configurada en Vercel Dashboard
2. Asegúrate de que esté marcada para el ambiente correcto (Production/Preview/Development)
3. Redespliega el proyecto después de agregar la variable

### Error: "Failed to fetch" o CORS

**Solución:**
1. Verifica que `VITE_BACKEND_URL` esté configurada correctamente
2. Asegúrate de que la URL no tenga una barra final (`/`)
3. Verifica que el dominio en `VITE_BACKEND_URL` coincida con tu proyecto en Vercel

### Error: "404 Not Found" en el endpoint

**Solución:**
1. Verifica que el archivo `api/[...path].ts` exista
2. Asegúrate de que `@vercel/node` esté instalado
3. Redespliega el proyecto

### El endpoint no se crea automáticamente

**Solución:**
1. Verifica que la carpeta `api/` esté en la raíz del proyecto
2. Verifica que el archivo se llame exactamente `[...path].ts`
3. Asegúrate de hacer commit y push de los cambios

## 📚 Recursos Adicionales

- [Vercel Serverless Functions Documentation](https://vercel.com/docs/functions)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

## ✨ Listo!

Una vez completados estos pasos, tu aplicación debería poder hacer llamadas a Wavespeed sin errores de CORS.
