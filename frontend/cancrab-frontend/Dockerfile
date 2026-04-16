# ─── Stage 1: build Angular app ──────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ─── Stage 2: nginx serving the built app ────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist/cancrab-frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
