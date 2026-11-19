import { defineConfig } from "nitro";

export default defineConfig({
  serverDir: "./server",
  preset: "netlify",
  runtimeConfig: {
    googleClientId: "",
    googleClientSecret: "",
    googleRedirectUri: "",
    googleCookieKey: "",
  },
});
