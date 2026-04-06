/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        poly: {
          green: '#00C853',
          red: '#FF1744',
          blue: '#2979FF',
          dark: '#0a0e17',
          card: '#111827',
          border: '#1f2937',
        },
      },
    },
  },
  plugins: [],
};
