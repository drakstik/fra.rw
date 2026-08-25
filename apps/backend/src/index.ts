import "reflect-metadata";
import express from "express";
import { AppDataSource } from "./config/data-source.js";

const app = express();
app.get("/health", (_req, res) => res.json({ status: "ok" }));

AppDataSource.initialize()
  .then(() => {
    app.listen(3000, () => console.log("backend listening on 3000"));
  })
  .catch((err: unknown) => {
    console.error("DB connection failed", err);
    process.exit(1);
  });
