import "reflect-metadata";
import { DataSource } from "typeorm";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const AppDataSource = new DataSource({
  type: "postgres",
  host: requireEnv("DB_HOST"),
  port: Number(process.env.DB_PORT ?? 5432),
  username: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  database: requireEnv("DB_NAME"),
  synchronize: false,
  logging: process.env.NODE_ENV !== "production",
  entities: ["src/entities/**/*.ts"],
  migrations: ["src/migrations/**/*.ts"],
});
