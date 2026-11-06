FROM node:22-alpine
WORKDIR /app
# git: una dependencia de la libreria de WhatsApp vinculado se baja de GitHub.
RUN apk add --no-cache git
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
EXPOSE 8090
CMD ["node", "src/index.js"]
