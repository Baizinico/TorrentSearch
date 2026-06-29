import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 主题色：琥珀金 + 青蓝 + 炭灰（暗色优先）
        accent: {
          DEFAULT: '#F5B544', // 琥珀金
          hover: '#FCC657',
          muted: '#8C6914',
        },
        cyan: {
          DEFAULT: '#39D0D8',
          hover: '#5BE0E7',
        },
        // 背景层级（CSS 变量驱动，亮/暗双套）
        bg: {
          base: 'var(--bg-base)',
          card: 'var(--bg-card)',
          hover: 'var(--bg-hover)',
          subtle: 'var(--bg-subtle)',
        },
        // 文本层级（CSS 变量驱动）
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          subtle: 'var(--fg-subtle)',
        },
        // 边框（CSS 变量驱动）
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        danger: '#F87171',
        success: '#34D399',
        nsfw: '#C084FC',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['"Manrope"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '8px',
        btn: '6px',
        input: '4px',
      },
      maxWidth: {
        content: '1280px',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
