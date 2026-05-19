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
        xs: '480px',
        '3xl': '1600px',
        tv: '1920px',
      },
    },
  },
  plugins: [],
}