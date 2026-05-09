/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0b0b0b',
        panel: '#151515',
        'panel-hover': '#1f1f1f',
        accent: '#8b5cf6',
        'accent-hover': '#7c3aed',
        text: '#f3f4f6',
        'text-muted': '#9ca3af',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
