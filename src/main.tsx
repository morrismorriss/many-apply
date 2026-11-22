import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/hauora-sans/400.css";
import "@fontsource/hauora-sans/500.css";
import "@fontsource/hauora-sans/600.css";
import "@fontsource/hauora-sans/700.css";
import "@fontsource/eb-garamond/400.css";
import "@fontsource/eb-garamond/400-italic.css";
import "@fontsource/eb-garamond/500.css";
import "@fontsource/eb-garamond/600.css";
import "./styles/app.css";
import "./lib/charts";
import App from "./App";

// A file dropped outside a drop zone would otherwise make the window open it
// and leave the app. Drop zones handle their own events first.
for (const ev of ["dragover", "drop"]) window.addEventListener(ev, (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
