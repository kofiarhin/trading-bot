import { createBrowserRouter } from "react-router-dom";
import DashboardPage from "../pages/DashboardPage.jsx";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <DashboardPage />,
  },
]);
