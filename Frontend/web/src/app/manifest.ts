import type { MetadataRoute } from "next";

/** Lets employees add the app to the home screen and open it full-screen (PWA). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Office · আমার অফিস",
    short_name: "My Office",
    description: "Attendance, leave, payslips and approvals",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f1f5f9",
    theme_color: "#047857",
    lang: "bn",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
