# Refactoring Notes

Este documento detalla las mejoras de código realizadas para mejorar la mantenibilidad del proyecto.

## Cambios Realizados (Diciembre 2024)

### 1. Nueva Estructura de Utilidades (`utils/`)

Se creó una carpeta `utils/` con funciones compartidas para eliminar código duplicado:

```
utils/
├── index.ts          # Re-exports todo
├── videoAssets.ts    # Funciones de manejo de VideoAssets
└── dateUtils.ts      # Funciones de parseo/formateo de fechas
```

#### `videoAssets.ts`
- `EMPTY_VIDEO_ASSETS` - Constante para estado inicial
- `normalizeVideoAssets()` - Normaliza campos null/undefined
- `hasVideoAssets()` - Verifica si hay assets presentes
- `mergeVideoAssets()` - Combina dos objetos de assets
- `countVideoAssets()` - Cuenta total de assets

#### `dateUtils.ts`
- `parseLocalDate()` - Parsea YYYY-MM-DD evitando problemas de timezone
- `getYesterdayString()` - Retorna fecha de ayer como string
- `getTodayString()` - Retorna fecha de hoy como string
- `formatDateString()` - Formatea Date a YYYY-MM-DD
- `formatDateForDisplay()` - Formatea para mostrar al usuario
- `isToday()` / `isYesterday()` - Helpers de comparación
- `getRelativeDateString()` - "Today", "Yesterday", o fecha formateada

### 2. Configuración Centralizada (`config/`)

Se creó una carpeta `config/` para centralizar configuraciones de servicios:

```
config/
├── index.ts          # Re-exports todo
└── services.ts       # Configuraciones de servicios externos
```

#### Configuraciones incluidas:
- `openaiConfig` - Modelos, timeouts, retries de OpenAI
- `wavespeedConfig` - Resolución, costos de WaveSpeed
- `shotstackConfig` - Configuración de composición de video
- `serpApiConfig` - TTLs de caché para noticias
- `cacheConfig` - TTLs de caché general
- `retryConfig` - Configuración de reintentos
- `productionConfig` - Límites de producción
- `costEstimation` - Estimación de costos por operación

### 3. Archivos Actualizados

#### `App.tsx`
- Ahora importa utilidades de `utils/`
- Eliminó definiciones duplicadas de `EMPTY_VIDEO_ASSETS`, `normalizeVideoAssets`, `hasVideoAssets`
- Usa `getYesterdayString()` y `parseLocalDate()` de utils

#### `hooks/useProduction.ts`
- Ahora importa utilidades de `utils/videoAssets`
- Eliminó definiciones locales duplicadas

## Beneficios

1. **DRY (Don't Repeat Yourself)** - Código duplicado eliminado
2. **Single Source of Truth** - Las funciones están en un solo lugar
3. **Fácil de testear** - Las utilidades se pueden testear unitariamente
4. **Fácil de mantener** - Cambios en un solo lugar afectan a toda la app
5. **Mejor organización** - Estructura de carpetas más clara

## Próximas Mejoras Sugeridas

### Alta Prioridad
- [ ] Refactorizar `App.tsx` en componentes más pequeños
- [ ] Mover lógica de producción a hooks dedicados
- [ ] Agregar tests unitarios para utilidades

### Media Prioridad
- [ ] Implementar React Query para data fetching
- [ ] Agregar Error Boundaries por feature
- [ ] Crear Context para estado global de producción

### Baja Prioridad
- [ ] Migrar a un state manager (Zustand, Jotai)
- [ ] Implementar lazy loading de componentes
- [ ] Agregar Storybook para componentes UI

## Cómo Usar las Nuevas Utilidades

```typescript
// Antes (código duplicado)
const EMPTY_VIDEO_ASSETS = { intro: null, ... };

// Ahora
import { EMPTY_VIDEO_ASSETS, normalizeVideoAssets } from './utils';

// Para fechas
import { parseLocalDate, getYesterdayString } from './utils';
const yesterday = getYesterdayString();
const date = parseLocalDate('2024-12-05');

// Para configuración
import { openaiConfig, retryConfig } from './config';
const timeout = openaiConfig.timeout;
```
