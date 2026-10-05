import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// Reveal the app once it has rendered with its fonts, all at once.
const fonts = document.fonts?.ready ?? Promise.resolve();
fonts.then(() =>
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("booting");
      document.documentElement.classList.add("booted");
    }),
  ),
);
