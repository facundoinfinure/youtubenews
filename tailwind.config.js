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
                sans: ['Inter', 'sans-serif'],
                headline: ['Anton', 'sans-serif'],
            },
            colors: {
                primary: {
                    400: '#FACC15', // Yellow-400
                    500: '#EAB308', // Yellow-500
                    600: '#CA8A04', // Yellow-600
                },
                accent: {
                    300: '#FCA5A5', // Red-300
                    400: '#F87171', // Red-400
                    500: '#EF4444', // Red-500
                }
            },
        },
    },
    plugins: [],
}
