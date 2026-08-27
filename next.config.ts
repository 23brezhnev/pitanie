import type { NextConfig } from 'next';

const config: NextConfig = {
  // Данные меняются после каждой записи от Claude, кеш страниц только мешает.
  experimental: { staleTimes: { dynamic: 0, static: 0 } },
};

export default config;
