import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "./ui/ui.css";

// Exponer React en window para plugins
if (typeof window !== "undefined") {
  (window as any).React = React;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
