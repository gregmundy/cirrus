FROM postgres:16

# Install PostGIS
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg lsb-release \
        postgresql-16-postgis-3 postgresql-16-postgis-3-scripts && \
    # Install TimescaleDB
    curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | \
      gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/debian/ $(lsb_release -cs) main" \
      > /etc/apt/sources.list.d/timescaledb.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends timescaledb-2-postgresql-16 && \
    rm -rf /var/lib/apt/lists/*

RUN echo "shared_preload_libraries = 'timescaledb'" >> /usr/share/postgresql/postgresql.conf.sample
