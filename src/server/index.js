import express from "express";
import cors from "cors";
import { connectMongo } from "../db/connectMongo.js";
import dashboardRoutes from "./routes/dashboard.js";
import tradesRoutes from "./routes/trades.js";
import positionsRoutes from "./routes/positions.js";
import journalRoutes from "./routes/journal.js";
import cycleRoutes from "./routes/cycle.js";

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

app.get("/api/health", (req, res) => res.json({ ok: true }));

async function startServer() {
  try {
    await connectMongo();
    app.listen(PORT, () => {
      console.log(`Dashboard API running on http://localhost:${PORT}`);
      console.log("Mounted routes: /api/dashboard | /api/trades | /api/positions | /api/journal | /api/cycle | /api/health");
    });
  } catch (err) {
    console.error("Failed to connect to MongoDB:", err.message);
    process.exit(1);
  }
}

await startServer();
