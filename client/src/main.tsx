import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { installApiFetch } from "./api";
import "./styles/globals.css";

// Install API fetch wrapper for ngrok/external API support
installApiFetch();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
