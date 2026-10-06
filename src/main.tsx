import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, Theme } from './themes';
import { migrateBeforeRender } from './utils/secrets';

try { applyTheme((localStorage.getItem('dropqtt_theme') || 'cyberpunk') as Theme); } catch { applyTheme('cyberpunk'); }

// Awaits on purpose. A hook that reads a plaintext password off disk before the move
// happens will write that same plaintext back when its state changes, so the migration
// has to finish first -- or not start at all. `migrateBeforeRender` carries its own
// deadline, so a credential store that never answers delays the password, not the app.
void migrateBeforeRender()
  .then((report) => {
    if (report.moved > 0) console.info(`moved ${report.moved} broker password(s) into the system credential store`);
    report.failed.forEach((reason) => console.warn('credential store:', reason));
  })
  .catch((e: unknown) => console.warn('credential migration did not run:', String(e)))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
