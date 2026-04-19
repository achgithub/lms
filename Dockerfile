# Stage 1: Build frontend (vite outDir overridden to /dist)
FROM node:20-alpine AS ui
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# Override outDir for Docker build — outputs to /frontend/dist
RUN npx vite build --outDir /dist

# Stage 2: Build Go backend
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY backend/go.mod ./
RUN GOFLAGS=-mod=mod go mod download
COPY backend/ ./
COPY --from=ui /dist ./static
RUN CGO_ENABLED=0 GOOS=linux go build -o lms-server .

# Stage 3: Minimal runtime
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/lms-server .
COPY --from=builder /app/static ./static
EXPOSE 8080
CMD ["./lms-server"]
