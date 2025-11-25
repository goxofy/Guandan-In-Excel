# Stage 1: Build the frontend
FROM node:18-alpine AS frontend-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: Setup the backend and serve
FROM node:18-alpine
WORKDIR /app/server

# Copy backend dependencies
COPY server/package*.json ./
RUN npm install --production

# Copy backend source code
COPY server/ ./

# Copy built frontend assets from Stage 1
# We copy them to ../client/dist because server.js expects them there
# relative to /app/server, so /app/client/dist
COPY --from=frontend-builder /app/client/dist /app/client/dist

# Expose the port the app runs on
EXPOSE 3001

# Command to run the application
CMD ["node", "server.js"]
