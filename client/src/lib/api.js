import axios from "axios";

const baseURL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

if (!import.meta.env.VITE_API_URL) {
  console.warn("Missing VITE_API_URL, using fallback http://localhost:5000/api");
}

export const api = axios.create({ baseURL });
