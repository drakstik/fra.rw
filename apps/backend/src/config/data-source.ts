import "reflect-metadata";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DataSource } from "typeorm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// Check that .env exists and returns the value, given a name key
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Set NODE_ENV=production and the code for .js or .ts extension.
const isProduction = process.env.NODE_ENV === "production";
const sourceExt = isProduction ? "js" : "ts";



export const AppDataSource = new DataSource({
  type: "postgres",
  host: requireEnv("DB_HOST"),
  port: Number(process.env.DB_PORT ?? 5432),
  username: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  database: requireEnv("DB_NAME"),
  uuidExtension: "pgcrypto", // postgres extension for generating uuid
  // Set DB_SSL=false if single-host app, and DB_SSL=true if multi-host
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : false,
  // Security: to mitigate resource exhaustion
  extra: {
    max: 10, // Maximum of 10 connections at once
    statement_timeout: 10_000, // End query if it exceeds 10secs
    idle_in_transaction_session_timeout: 10_000, // End session if it exceeds 10secs
  },
  synchronize: false,
  logging: !isProduction, // True when not in production
  // Find path to TypeORM entity & migration files as js or ts, depending on whether running in prod or dev.
  entities: [path.join(__dirname, "..", "entities", "**", `*.${sourceExt}`)],
  migrations: [
    path.join(__dirname, "..", "migrations", "**", `*.${sourceExt}`),
  ],
});
