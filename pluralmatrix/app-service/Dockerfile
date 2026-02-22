FROM node:22-slim

WORKDIR /app

# Install dependencies for building
RUN apt-get update -y && apt-get install -y openssl ca-certificates

# 1. Build Frontend
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# 2. Build Backend
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npx tsc

EXPOSE 9000

CMD ["node", "dist/index.js"]
