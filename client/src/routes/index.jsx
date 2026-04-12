import { createBrowserRouter, Navigate } from "react-router-dom";
import Layout from "../components/Layout.jsx";
import DashboardPage from "../pages/DashboardPage.jsx";
import JournalPage from "../pages/JournalPage.jsx";
import TradeDetailPage from "../pages/TradeDetailPage.jsx";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "journal", element: <JournalPage /> },
      { path: "journal/:tradeId", element: <TradeDetailPage /> },
    ],
  },
]);
