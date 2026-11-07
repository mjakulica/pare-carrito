FROM node:20-alpine
# Chromium del sistema (puppeteer-core no baja otro).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont tzdata
ENV PUPPETEER_SKIP_DOWNLOAD=1 TZ=America/Argentina/Salta
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY index.js ./
CMD ["node", "index.js"]
