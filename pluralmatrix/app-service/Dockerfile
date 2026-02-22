FROM node:18-slim

WORKDIR /app

# Install OpenSSL (Required by Prisma)
RUN apt-get update -y && apt-get install -y openssl ca-certificates

COPY package*.json ./
RUN npm install

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npx tsc

EXPOSE 9000

CMD ["node", "dist/index.js"]
