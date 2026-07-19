import "./amplify";
import "./index.css";
import "./i18n"; // resolve device locale and set <html lang> before first paint
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
