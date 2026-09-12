/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        // Això et permetrà fer servir "bg-brand-500" o "text-brand-500"
        brand: {
          400: '#22d3ee', // Cyan clar (mode fosc)
          500: '#0891b2', // Cyan mig (mode clar)
        },
      },
    },
  },
  plugins: [],
};