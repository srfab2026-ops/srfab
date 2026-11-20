# AI Rules

## Tech stack
- This is a small, static web application built with plain HTML, CSS, and browser-native JavaScript; do not migrate it to React or add a frontend build system unless explicitly requested.
- `public/index.html` contains the primary bill app and its client-side interface.
- `public/thanks.html` is the customer-facing PhonePe return/thank-you page.
- Backend endpoints are implemented as Netlify Functions in `netlify/functions/` using JavaScript ES modules and the Netlify Functions runtime.
- `netlify.toml` configures the `public` publish directory and Netlify Functions directory.
- `package.json` declares the Node package as an ES module and currently includes `@netlify/blobs` for persistent server-side storage.
- Server-side code uses Node.js built-ins such as `node:crypto` for cryptographic operations and the standard `fetch` API for PhonePe requests.
- Persistent application data is stored with Netlify Blobs; there is no separate database or ORM configured.

## Library and implementation rules
- Use browser-native HTML, CSS, and JavaScript for frontend behavior; avoid adding frameworks, component libraries, CSS frameworks, or bundlers for routine changes.
- Use Netlify Functions for server-only behavior, API routes, authentication, payment processing, and access to secrets or persistent data. Never put credentials or secret logic in public files.
- Use `@netlify/blobs` for persistent app data in the backend; do not add a database client or local-file persistence unless the architecture is explicitly changed.
- Use Node.js built-ins for backend utilities where possible; do not add a dependency for functionality already supplied by the runtime.
- Integrate PhonePe through the existing server-side API flow. Keep API secrets in Netlify environment variables and never expose them to browser code.
- Keep the client and function API contract consistent when changing request paths, methods, or payloads; update both sides together.
- Keep deploy configuration in `netlify.toml` aligned with the existing static publish directory and functions directory; avoid changing deployment settings unless required by the task.
- Make focused changes in the existing files and preserve the app's plain-file structure; do not introduce TypeScript, React Router, shadcn/ui, or other project scaffolding that is not present in this app.
