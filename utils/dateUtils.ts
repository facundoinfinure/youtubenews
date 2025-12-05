/**
 * Date Utilities
 * 
 * Shared date parsing and formatting functions.
 * Handles timezone issues consistently across the application.
 */

/**
 * Parse a date string (YYYY-MM-DD) as local date at noon
 * This avoids timezone issues that can occur with Date.parse()
 * 
 * @param dateString - Date in YYYY-MM-DD format
 * @returns Date object at noon local time
 */
export const parseLocalDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0); // Noon local time to avoid timezone issues
};

/**
 * Get yesterday's date as YYYY-MM-DD string
 */
export const getYesterdayString = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

/**
 * Get today's date as YYYY-MM-DD string
 */
export const getTodayString = (): string => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Format a Date object as YYYY-MM-DD string
 */
export const formatDateString = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

/**
 * Format a Date for display (localized)
 */
export const formatDateForDisplay = (date: Date, locale: string = 'en-US'): string => {
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

/**
 * Check if a date is today
 */
export const isToday = (date: Date): boolean => {
  const today = new Date();
  return date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
};

/**
 * Check if a date is yesterday
 */
export const isYesterday = (date: Date): boolean => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
};

/**
 * Get relative date string (Today, Yesterday, or formatted date)
 */
export const getRelativeDateString = (date: Date, locale: string = 'en-US'): string => {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return formatDateForDisplay(date, locale);
};
