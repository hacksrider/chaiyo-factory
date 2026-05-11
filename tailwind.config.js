/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./resources/**/*.blade.php",
    "./resources/**/*.js",
    "./resources/**/*.jsx", 
    "./resources/**/*.vue",
    "./resources/js/**/*.jsx",
    "./resources/js/**/*.js",
  ],
  theme: {
    extend: {
      screens: {
        '3xl': '1600px',
      },
    },
  },
  plugins: [],
}