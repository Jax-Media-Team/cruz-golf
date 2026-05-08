import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cruz Golf",
    short_name: "Cruz Golf",
    description: "Live scoring + betting for Cruz's golf group.",
    start_url: "/",
    display: "standalone",
    background_color: "#04150f",
    theme_color: "#0d3b2a",
    icons: [
      { src: "/cruz-logo.png", sizes: "any", type: "image/png", purpose: "any" }
    ]
  };
}
