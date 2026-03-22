ARG SERVICE

# Stage 1: Build
FROM rust:1.84 AS builder
ARG SERVICE
WORKDIR /app
COPY Cargo.toml ./
COPY Cargo.lock* ./
COPY acquisition/ acquisition/
COPY backend/ backend/
COPY alerting/ alerting/
COPY monitor/ monitor/
RUN cargo build --release --bin ${SERVICE}

# Stage 2: Runtime
FROM debian:bookworm-slim
ARG SERVICE
RUN apt-get update && apt-get install -y ca-certificates libpq5 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/${SERVICE} /usr/local/bin/service
CMD ["service"]
