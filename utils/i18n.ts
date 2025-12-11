/**
 * Internationalization (i18n) Utilities
 * 
 * Simple translation system based on channel language settings.
 * Supports English (default) and Spanish (Argentina).
 */

export type SupportedLanguage = 'en' | 'es';

// Detect language from channel config language string
export const detectLanguage = (languageString?: string): SupportedLanguage => {
  if (!languageString) return 'en';
  
  const normalized = languageString.toLowerCase().trim();
  
  // Spanish detection
  if (
    normalized.includes('spanish') ||
    normalized.includes('español') ||
    normalized.includes('espanol') ||
    normalized.includes('argentina') ||
    normalized === 'es' ||
    normalized === 'es-ar'
  ) {
    return 'es';
  }
  
  // Default to English
  return 'en';
};

// Translation keys for the app
export interface Translations {
  // General
  loading: string;
  error: string;
  success: string;
  cancel: string;
  confirm: string;
  save: string;
  close: string;
  back: string;
  next: string;
  retry: string;
  
  // Production Wizard
  wizard: {
    title: string;
    fetchNews: string;
    selectNews: string;
    generateScripts: string;
    reviewScripts: string;
    generateAudios: string;
    generateVideos: string;
    renderFinal: string;
    publish: string;
    done: string;
    
    // Actions
    generatingAudios: string;
    generatingVideos: string;
    audiosCompleted: string;
    videosCompleted: string;
    
    // Confirmation
    closeConfirmTitle: string;
    closeConfirmMessage: string;
    closeConfirmYes: string;
  };
  
  // Admin Dashboard
  admin: {
    title: string;
    settings: string;
    productions: string;
    overview: string;
    costs: string;
    cache: string;
    render: string;
    createChannel: string;
    saveChanges: string;
    exit: string;
  };
  
  // Audio/Video
  media: {
    generatingAudio: string;
    audioGenerated: string;
    audioFailed: string;
    generatingVideo: string;
    videoGenerated: string;
    videoFailed: string;
    regenerate: string;
  };
  
  // Errors
  errors: {
    timeout: string;
    rateLimit: string;
    networkError: string;
    unknownError: string;
  };
}

// English translations (default)
const en: Translations = {
  loading: 'Loading...',
  error: 'Error',
  success: 'Success',
  cancel: 'Cancel',
  confirm: 'Confirm',
  save: 'Save',
  close: 'Close',
  back: 'Back',
  next: 'Next',
  retry: 'Retry',
  
  wizard: {
    title: 'Production Wizard',
    fetchNews: 'Fetch News',
    selectNews: 'Select News',
    generateScripts: 'Generate Scripts',
    reviewScripts: 'Review Scripts',
    generateAudios: 'Generate Audios',
    generateVideos: 'Generate Videos',
    renderFinal: 'Render Final',
    publish: 'Publish',
    done: 'Done',
    
    generatingAudios: 'Generating audios...',
    generatingVideos: 'Generating videos...',
    audiosCompleted: 'completed',
    videosCompleted: 'completed',
    
    closeConfirmTitle: 'Close Production Wizard?',
    closeConfirmMessage: 'Your progress has been saved automatically. You can resume this production later from the Admin Dashboard.',
    closeConfirmYes: 'Yes, close',
  },
  
  admin: {
    title: 'Admin Dashboard',
    settings: 'Settings',
    productions: 'Productions',
    overview: 'Overview',
    costs: 'Costs',
    cache: 'Cache',
    render: 'Render',
    createChannel: 'Create Channel',
    saveChanges: 'Save Changes',
    exit: 'Exit',
  },
  
  media: {
    generatingAudio: 'Generating audio...',
    audioGenerated: 'Audio generated',
    audioFailed: 'Audio failed',
    generatingVideo: 'Generating video...',
    videoGenerated: 'Video generated',
    videoFailed: 'Video failed',
    regenerate: 'Regenerate',
  },
  
  errors: {
    timeout: 'Request timeout. Please try again.',
    rateLimit: 'API rate limit reached. Please wait a moment.',
    networkError: 'Network error. Check your connection.',
    unknownError: 'An unexpected error occurred.',
  },
};

// Spanish (Argentina) translations
const es: Translations = {
  loading: 'Cargando...',
  error: 'Error',
  success: 'Éxito',
  cancel: 'Cancelar',
  confirm: 'Confirmar',
  save: 'Guardar',
  close: 'Cerrar',
  back: 'Volver',
  next: 'Siguiente',
  retry: 'Reintentar',
  
  wizard: {
    title: 'Asistente de Producción',
    fetchNews: 'Buscar Noticias',
    selectNews: 'Seleccionar Noticias',
    generateScripts: 'Generar Guiones',
    reviewScripts: 'Revisar Guiones',
    generateAudios: 'Generar Audios',
    generateVideos: 'Generar Videos',
    renderFinal: 'Renderizar Final',
    publish: 'Publicar',
    done: 'Completado',
    
    generatingAudios: 'Generando audios...',
    generatingVideos: 'Generando videos...',
    audiosCompleted: 'completados',
    videosCompleted: 'completados',
    
    closeConfirmTitle: '¿Cerrar Asistente de Producción?',
    closeConfirmMessage: 'Tu progreso se ha guardado automáticamente. Podrás retomar esta producción más tarde desde el Panel de Administración.',
    closeConfirmYes: 'Sí, cerrar',
  },
  
  admin: {
    title: 'Panel de Administración',
    settings: 'Configuración',
    productions: 'Producciones',
    overview: 'Resumen',
    costs: 'Costos',
    cache: 'Caché',
    render: 'Renderizado',
    createChannel: 'Crear Canal',
    saveChanges: 'Guardar Cambios',
    exit: 'Salir',
  },
  
  media: {
    generatingAudio: 'Generando audio...',
    audioGenerated: 'Audio generado',
    audioFailed: 'Audio falló',
    generatingVideo: 'Generando video...',
    videoGenerated: 'Video generado',
    videoFailed: 'Video falló',
    regenerate: 'Regenerar',
  },
  
  errors: {
    timeout: 'Tiempo de espera agotado. Intenta de nuevo.',
    rateLimit: 'Límite de API alcanzado. Espera un momento.',
    networkError: 'Error de conexión. Verifica tu internet.',
    unknownError: 'Ocurrió un error inesperado.',
  },
};

// All translations
const translations: Record<SupportedLanguage, Translations> = { en, es };

/**
 * Get translations for a specific language
 */
export const getTranslations = (language: SupportedLanguage): Translations => {
  return translations[language] || translations.en;
};

/**
 * Get translations based on channel language string
 */
export const getTranslationsForChannel = (channelLanguage?: string): Translations => {
  const lang = detectLanguage(channelLanguage);
  return getTranslations(lang);
};

/**
 * Hook-friendly translation getter
 * Returns a function that can be used to get translations
 */
export const createT = (channelLanguage?: string) => {
  const t = getTranslationsForChannel(channelLanguage);
  return t;
};

export default { detectLanguage, getTranslations, getTranslationsForChannel, createT };

