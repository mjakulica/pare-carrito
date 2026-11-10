FROM node:22-alpine
WORKDIR /app
# pdftoppm: pasa a imagen los comprobantes que llegan en PDF por WhatsApp.
RUN apk add --no-cache poppler-utils
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY schema.sql ./
COPY src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
