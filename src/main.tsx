import React from "react";
import ReactDOM from "react-dom/client";
import { FamilyApp } from "./family-app";
import "./globals.css";

const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN as string | undefined)?.replace(/\/$/, "")
  || "https://baefamily-api.jangwoo-fairway-four.workers.dev";
const nativeFetch = window.fetch.bind(window);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const original = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const isApi = original.startsWith("/api/");
  const url = isApi && API_ORIGIN ? `${API_ORIGIN}${original}` : input;
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  const token = localStorage.getItem("baefamily_session");
  if (isApi && token) headers.set("authorization", `Bearer ${token}`);

  const response = await nativeFetch(url, { ...init, headers, mode: isApi ? "cors" : init.mode });
  if (isApi && (original === "/api/auth/join" || original === "/api/auth/reset-pin") && response.ok) {
    const clone = response.clone();
    const body = await clone.json() as { token?: string };
    if (body.token) localStorage.setItem("baefamily_session", body.token);
  }
  if (isApi && original === "/api/auth/logout") localStorage.removeItem("baefamily_session");
  return response;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><FamilyApp /></React.StrictMode>,
);
