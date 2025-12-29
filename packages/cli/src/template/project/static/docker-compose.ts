import { Sink } from "~/types/sink.js";

export const clickhouseDockerCompose = `services:
  clickhouse:
    image: clickhouse/clickhouse-server:latest
    container_name: clickhouse
    ports:
      - "8123:8123"
    environment:
      CLICKHOUSE_DB: pipes
      CLICKHOUSE_USER: default
      CLICKHOUSE_PASSWORD: password
      CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT: "1"
`;

export const postgresDockerCompose = `services:
  postgres:
    image: postgres:latest
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
      POSTGRES_DB: pipes
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
`;

export function getDockerCompose(sink: Sink): string {
  return sink === "clickhouse"
    ? clickhouseDockerCompose
    : postgresDockerCompose;
}

