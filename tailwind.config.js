/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
        "./App.tsx"
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                display: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['SF Mono', 'JetBrains Mono', 'monospace'],
            },
            colors: {
                // Primary accent (Sky blue)
                accent: {
                    50: '#f0f9ff',
                    100: '#e0f2fe',
                    200: '#bae6fd',
                    300: '#7dd3fc',
                    400: '#38bdf8',
                    500: '#0ea5e9',
                    600: '#0284c7',
                    700: '#0369a1',
                    800: '#075985',
                    900: '#0c4a6e',
                },
                // Legacy primary (keeping for backwards compat)
                primary: {
                    400: '#38bdf8',
                    500: '#0ea5e9',
                    600: '#0284c7',
                },
                // Background layers
                surface: {
                    base: '#09090b',
                    primary: '#0c0c0e',
                    elevated: '#141416',
                    hover: '#1a1a1e',
                }
            },
            borderRadius: {
                'xl': '12px',
                '2xl': '16px',
                '3xl': '20px',
            },
            boxShadow: {
                'glow': '0 0 24px rgba(14, 165, 233, 0.15)',
                'glow-strong': '0 0 40px rgba(14, 165, 233, 0.25)',
                'elevated': '0 8px 16px rgba(0, 0, 0, 0.25), 0 4px 8px rgba(0, 0, 0, 0.1)',
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease-out',
                'fade-in-up': 'fadeInUp 0.3s ease-out',
                'scale-in': 'scaleIn 0.2s ease-out',
                'slide-in-right': 'slideInRight 0.3s ease-out',
                'pulse-glow': 'pulseGlow 2s infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0' },
                    '100%': { opacity: '1' },
                },
                fadeInUp: {
                    '0%': { opacity: '0', transform: 'translateY(10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                scaleIn: {
                    '0%': { opacity: '0', transform: 'scale(0.95)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                slideInRight: {
                    '0%': { opacity: '0', transform: 'translateX(20px)' },
                    '100%': { opacity: '1', transform: 'translateX(0)' },
                },
                pulseGlow: {
                    '0%, 100%': { boxShadow: '0 0 0 0 rgba(14, 165, 233, 0.4)' },
                    '50%': { boxShadow: '0 0 0 8px rgba(14, 165, 233, 0)' },
                },
            },
            transitionTimingFunction: {
                'spring': 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
            backdropBlur: {
                'xs': '2px',
            },
        },
    },
    plugins: [],
}
