import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        spark: {
          purple: '#5046E5',
          ink: '#1A1A1A',
          cream: '#F5F3EF',
          'light-purple': '#EEEDFC',
        },
      },
      fontFamily: {
        sans: [
          'Suit',
          '-apple-system',
          'BlinkMacSystemFont',
          '맑은 고딕',
          'Malgun Gothic',
          'Apple SD Gothic Neo',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
export default config;
