import express from "express";
import cors from "cors";
import { connectMongo } from "../db/connectMongo.js";
import dashboardRoutes from "./routes/dashboard.js";
import tradesRoutes from "./routes/trades.js";
import positionsRoutes from "./routes/positions.js";
import journalRoutes from "./routes/journal.js";
import cycleRoutes from "./routes/cycle.js";
import performanceRoutes from "./routes/performance.js";
import exposureRoutes from "./routes/exposure.js";
import expectancyRoutes from "./routes/expectancy.js";
import candidatesRoutes from "./routes/candidates.js";
import rejectionsRoutes from "./routes/rejections.js";

const app = express();
const PORT = process.env.PORT ?? 5000;
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

app.use(cors({ origin: [CLIENT_URL], credentials: true }));
app.use(express.json());

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/trades", tradesRoutes);
app.use("/api/positions", positionsRoutes);
app.use("/api/journal", journalRoutes);
app.use("/api/cycle", cycleRoutes);
app.use("/api/performance", performanceRoutes);
app.use("/api/exposure", exposureRoutes);
app.use("/api/expectancy", expectancyRoutes);
app.use("/api/candidates", candidatesRoutes);
app.use("/api/rejections", rejectionsRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

async function startServer() {
  try {
    await connectMongo();
    app.listen(PORT, () => {
      console.log(`Dashboard API running on http://localhost:${PORT}`);
      console.log("Mounted routes: /api/dashboard | /api/trades | /api/positions | /api/journal | /api/cycle | /api/performance | /api/exposure | /api/expectancy | /api/candidates | /api/rejections | /api/health");
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }
}

await startServer();
