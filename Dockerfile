FROM node:20-alpine

WORKDIR /app

# Instalar dependencias del sistema para Puppeteer/Chrome
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Configurar Puppeteer para usar Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copiar archivos de dependencias
COPY package.json package-lock.json ./

# Instalar dependencias (solo producción para imagen más pequeña)
RUN npm ci --only=production

# Copiar código de la API
COPY . .

# Exponer puerto
EXPOSE 3000

# Variables de entorno
ENV NODE_ENV=production
ENV PORT=3000

# Comando para iniciar el servidor
CMD ["node", "api/server.js"]
