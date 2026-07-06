import type { Plan } from "../project/plan"

export interface WebOptions {
  scope: string
  /** App directory name, e.g. "admin". */
  name: string
}

/**
 * Generates a Vite + React admin frontend that consumes the shared SDK. Because
 * it imports the workspace SDK, its Docker build runs from the repo root
 * (lwd git.path = ".") and filters to this app — see the generated Dockerfile.
 */
export function addWebApp(plan: Plan, opts: WebOptions): void {
  const dir = `apps/${opts.name}`
  const pkgName = `${opts.scope}/${opts.name}`

  plan.create(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: pkgName,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
          typecheck: "tsc --noEmit",
          test: "vitest run --passWithNoTests",
        },
        dependencies: {
          [`${opts.scope}/sdk`]: "workspace:*",
          react: "^18.3.1",
          "react-dom": "^18.3.1",
          "react-router-dom": "^7.9.3",
        },
        devDependencies: {
          "@types/react": "^18.3.3",
          "@types/react-dom": "^18.3.0",
          "@vitejs/plugin-react": "^4.3.1",
          typescript: "^5.5.4",
          vite: "^5.4.0",
          vitest: "^2.0.5",
        },
      },
      null,
      2,
    ) + "\n",
    "admin app package.json",
  )

  plan.create(
    `${dir}/tsconfig.json`,
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
          resolveJsonModule: true,
          noEmit: true,
        },
        include: ["src"],
      },
      null,
      2,
    ) + "\n",
    "admin tsconfig (ESM/bundler for Vite)",
  )

  plan.create(`${dir}/vite.config.ts`, VITE_CONFIG, "vite config")
  plan.create(`${dir}/index.html`, indexHtml(opts.name), "admin index.html")
  plan.create(`${dir}/src/main.tsx`, MAIN, "admin entry")
  plan.create(`${dir}/src/App.tsx`, appTsx(opts.scope), "admin App")
  plan.create(`${dir}/nginx.conf`, NGINX, "nginx SPA config")
  plan.create(`${dir}/Dockerfile`, dockerfile(pkgName, opts.name), "admin Dockerfile (root-context build)")
}

const VITE_CONFIG = `import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
})
`

function indexHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

const MAIN = `import React from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`

function appTsx(scope: string): string {
  return `import { useEffect, useState } from "react"
import { createClient, type HealthStatus } from "${scope}/sdk"

const api = createClient({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080" })

export function App(): JSX.Element {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: "degraded" }))
  }, [])
  return (
    <main style={{ fontFamily: "system-ui", padding: 32 }}>
      <h1>Admin</h1>
      <p>API health: {health?.status ?? "…"}</p>
    </main>
  )
}
`
}

const NGINX = `server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
`

function dockerfile(pkgName: string, name: string): string {
  return `# Deployed by lwd with git.path = "." and build.dockerfile = "apps/${name}/Dockerfile"
# (root context so the workspace SDK is available to the build).
FROM node:20-alpine AS builder
WORKDIR /repo
RUN npm install -g pnpm@9
COPY . .
RUN pnpm install --no-frozen-lockfile
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter "${pkgName}" build

FROM nginx:1.27-alpine
COPY --from=builder /repo/apps/${name}/dist /usr/share/nginx/html
COPY apps/${name}/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
`
}
