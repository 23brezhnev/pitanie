import type { NextConfig } from 'next';

const config: NextConfig = {
  // Данные меняются после каждой записи от Claude, поэтому клиентский кеш
  // роутера для динамических страниц отключён: иначе после перехода назад
  // видно вчерашние цифры. Ключ static не трогаем — Next 16 требует там >= 30,
  // а статических страниц с данными у нас нет.
  experimental: { staleTimes: { dynamic: 0 } },
};

export default config;
