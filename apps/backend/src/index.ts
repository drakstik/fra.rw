import "reflect-metadata";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppDataSource } from "./config/data-source.js";
import { authRouter } from "./routes/auth.routes.js";
import { errorHandler } from "./middleware/error-handler.js";

const app = express();

// Backend sits behind nginx on the same host (see docker-compose.yml).
// This tells Express to trust the single hop of X-Forwarded-For nginx
// sets, so req.ip / rate-limit keys reflect the real client IP instead
// of the nginx container's IP. `1` = trust exactly one proxy hop; do not
// widen this without also reconsidering the rate limiter's IP trust.
app.set("trust proxy", 1);

// Helmet headers here are defense-in-depth for the API itself — nginx
// already sets the frontend's security headers, but /api/ responses
// don't inherit those from a plain reverse-proxy pass-through.
app.use(helmet());
app.use(express.json({ limit: "32kb" })); // small limit: this API has no file uploads yet
app.use(cookieParser());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/auth", authRouter);

// Must be registered last — Express identifies error-handling middleware
// by its four-argument signature.
app.use(errorHandler);

AppDataSource.initialize()
  .then(() => {
    app.listen(3000, () => console.log("backend listening on 3000"));
  })
  .catch((err: unknown) => {
    console.error("DB connection failed", err);
    process.exit(1);
  });