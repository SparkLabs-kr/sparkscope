import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        spark: {
          purple: '#2563EB',
          'purple-soft': '#3B82F6',
          ink: '#1A1A1A',
          'ink-soft': '#514E5C',
          muted: '#8B8894',
          cream: '#F5F3EF',
          'light-purple': '#EEEDFC',
          border: '#E7E3DB',       // 크림 톤에 맞춘 따뜻한 하드라인
          'border-strong': '#DAD5CB',
          surface: '#FFFFFF',
          subtle: '#FAF8F4',       // 옅은 패널 배경
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(26,20,40,0.04)',
        'card-hover': '0 6px 20px -8px rgba(80,70,229,0.16)',
        pop: '0 8px 30px -12px rgba(26,20,40,0.18)',
      },
      borderRadius: {
        '2xl': '1rem',
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
