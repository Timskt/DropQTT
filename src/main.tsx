import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, Theme } from './themes';

try { applyTheme((localStorage.getItem('dropqtt_theme') || 'cyberpunk') as Theme); } catch { applyTheme('cyberpunk'); }

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
