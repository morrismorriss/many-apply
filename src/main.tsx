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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
