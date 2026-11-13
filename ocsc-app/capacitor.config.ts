import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "me.ocsc.intelligence",
  appName: "OCSC Intelligence",
  webDir: "www",
  backgroundColor: "#141414",
  appendUserAgent: "OCSCIntelligenceApp",
  server: {
    url: "https://computer.ocsc.me",
    errorPath: "offline.html",
    // Sign-in goes through Evolve, then Supabase and Microsoft, in the app's own window so the
    // session lands in the app. Every other site opens in the system browser.
    allowNavigation: [
      "evolve.ocsc.me",
      "axywhnegcerpjqjiuhhn.supabase.co",
      "login.microsoftonline.com",
      "login.microsoft.com",
      "login.live.com",
    ],
  },
  ios: {
    contentInset: "never",
  },
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
