import express from "express";
import cors from "cors";
import dashboardRoutes from "./routes/dashboard.js";
import tradesRoutes from "./routes/trades.js";

const app = express();
const PORT = process.env.PORT ?? 5000;
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

app.use(cors({ origin: [CLIENT_URL], credentials: true }));
app.use(express.json());

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/trades", tradesRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Dashboard API running on http://localhost:${PORT}`);
});
