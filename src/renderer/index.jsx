import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const logError = (message) => {
  try {
    if (window.api && typeof window.api.invoke === "function") {
      window.api.invoke("log-error", message);
    }
  } catch (e) {}
};

const report = (tag, error) => {
  logError(`${tag}: ${error && error.stack ? error.stack : String(error)}`);
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    report(
      "componentDidCatch",
      `${error && error.stack ? error.stack : String(error)}\n${info && info.componentStack ? info.componentStack : ""}`
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            fontFamily: "system-ui, sans-serif",
            color: "#1e3a5f",
            textAlign: "center",
            padding: 24,
            gap: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>Ocurrió un error inesperado</h2>
          <pre
            style={{
              maxWidth: 560,
              maxHeight: 200,
              overflow: "auto",
              fontSize: 11,
              background: "#f1f5f9",
              padding: 12,
              textAlign: "left",
              lineHeight: 1.4,
            }}
          >
            {String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}
          </pre>
          <button
            onClick={() => location.reload()}
            style={{
              padding: "10px 24px",
              border: "none",
              borderRadius: 6,
              background: "#1e3a5f",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener("error", (e) => report("window.onerror", e.error || e.message));
window.addEventListener("unhandledrejection", (e) => report("unhandledrejection", e.reason));

const container = document.getElementById("root");
const root = createRoot(container);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);