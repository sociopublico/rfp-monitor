FROM node:24-alpine

WORKDIR /app

# Dependencias del sistema para Puppeteer + Chromium del sistema
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Usar Chromium del sistema (no descargar el de Puppeteer)
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copiar archivos de dependencias
COPY package.json package-lock.json ./

# Instalar dependencias de producción
RUN npm ci --omit=dev && npm cache clean --force

# Copiar código de la aplicación
COPY . .

# Preparar directorio de datos y usuario no-root (uid del usuario `node` de la imagen oficial)
RUN mkdir -p /app/data \
    && chown -R node:node /app

USER node

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "api/server.js"]
