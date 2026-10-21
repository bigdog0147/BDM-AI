"use client";

import { useEffect } from "react";

/**
 * Registers the offline app shell.
 *
 * Registration is production-only. A service worker that caches the shell
 * would serve stale HTML and assets during development, which makes hot
 * reload look broken. It also keeps the developer experience free of a
 * background cache that has to be invalidated on every change.
 */
export default function SWRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("[SW] Registered:", registration.scope);

        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                console.log("[SW] New version available");
                // Could show a toast to refresh
              }
            });
          }
        });
      })
      .catch((error) => {
        console.error("[SW] Registration failed:", error);
      });

    // Listen for controller change (new SW activated)
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  }, []);

  return null;
}