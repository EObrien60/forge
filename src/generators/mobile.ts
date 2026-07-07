import type { ExampleDomain } from "../types"
import type { Plan } from "../project/plan"

export interface MobileOptions {
  scope: string
  /** App directory name, e.g. "mobile" or "driver". */
  name: string
  example: ExampleDomain
}

/**
 * Generates an Expo (React Native) app that drives the API through the shared
 * SDK. Ships to app stores via EAS, so it gets no lwd manifest or Dockerfile.
 * No build/typecheck scripts, so the workspace CI (pnpm -r build/typecheck)
 * skips it — Expo builds happen through EAS, not CI.
 */
export function addMobileApp(plan: Plan, opts: MobileOptions): void {
  const dir = `apps/${opts.name}`
  const notes = opts.example === "notes"

  plan.create(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: `${opts.scope}/${opts.name}`,
        version: "0.1.0",
        private: true,
        main: "index.ts",
        scripts: {
          start: "expo start",
          android: "expo start --android",
          ios: "expo start --ios",
          test: 'echo "no mobile tests yet"',
        },
        dependencies: {
          [`${opts.scope}/sdk`]: "workspace:*",
          expo: "~51.0.0",
          "expo-status-bar": "~1.12.1",
          react: "18.2.0",
          "react-native": "0.74.5",
        },
        devDependencies: {
          "@babel/core": "^7.24.0",
          "@types/react": "~18.2.79",
          typescript: "~5.3.3",
        },
      },
      null,
      2,
    ) + "\n",
    "mobile app package.json (Expo)",
  )

  plan.create(`${dir}/app.json`, appJson(opts.name), "Expo app config")
  plan.create(`${dir}/eas.json`, EAS, "EAS build profiles")
  plan.create(`${dir}/babel.config.js`, BABEL, "babel config")
  plan.create(
    `${dir}/tsconfig.json`,
    JSON.stringify({ extends: "expo/tsconfig.base", compilerOptions: { strict: true }, include: ["**/*.ts", "**/*.tsx"] }, null, 2) + "\n",
    "mobile tsconfig",
  )
  plan.create(`${dir}/.gitignore`, GITIGNORE, "mobile gitignore")
  plan.create(`${dir}/index.ts`, INDEX, "Expo entrypoint (registerRootComponent)")
  plan.create(`${dir}/src/api.ts`, apiTs(opts.scope, notes), "mobile API client instance")
  plan.create(`${dir}/App.tsx`, notes ? APP_NOTES : APP_BASE, "mobile App")

  plan.addEnvVar({ name: "EXPO_PUBLIC_API_URL", example: "http://localhost:8080", comment: "API base URL baked into the mobile build" })
  plan.nextStep(`Mobile: cd apps/${opts.name} && npx expo start (needs Expo Go or a dev build).`)
}

function appJson(name: string): string {
  return (
    JSON.stringify(
      {
        expo: {
          name,
          slug: name,
          version: "1.0.0",
          orientation: "portrait",
          userInterfaceStyle: "automatic",
          newArchEnabled: true,
          ios: { supportsTablet: true },
          android: {},
        },
      },
      null,
      2,
    ) + "\n"
  )
}

const INDEX = `import { registerRootComponent } from "expo"
import App from "./App"

// Robust monorepo entry (avoids expo/AppEntry.js resolution issues under pnpm).
registerRootComponent(App)
`

const EAS = `{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal" },
    "production": {}
  },
  "submit": { "production": {} }
}
`

const BABEL = `module.exports = function (api) {
  api.cache(true)
  return { presets: ["babel-preset-expo"] }
}
`

const GITIGNORE = `.expo/
dist/
web-build/
*.orig.*
`

function apiTs(scope: string, notes: boolean): string {
  const typeReexport = notes
    ? `export type { HealthStatus, Note, CreateNoteInput, UpdateNoteInput } from "${scope}/sdk"`
    : `export type { HealthStatus } from "${scope}/sdk"`
  return `import { createClient } from "${scope}/sdk"
${typeReexport}

export const api = createClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8080",
})
`
}

const APP_BASE = `import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { StyleSheet, Text, View } from "react-native"
import { api, type HealthStatus } from "./src/api"

export default function App(): JSX.Element {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: "degraded" }))
  }, [])
  return (
    <View style={styles.container}>
      <Text style={styles.h1}>App</Text>
      <Text>API health: {health?.status ?? "…"}</Text>
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 64, gap: 8 },
  h1: { fontSize: 24, fontWeight: "600" },
})
`

const APP_NOTES = `import { StatusBar } from "expo-status-bar"
import { useEffect, useState } from "react"
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import { api, type Note } from "./src/api"

export default function App(): JSX.Element {
  const [notes, setNotes] = useState<Note[]>([])
  const [title, setTitle] = useState("")

  const reload = () => api.notes.list().then(setNotes).catch(() => {})
  useEffect(() => {
    reload()
  }, [])

  const add = async () => {
    if (!title.trim()) return
    await api.notes.create({ title })
    setTitle("")
    reload()
  }

  return (
    <View style={styles.container}>
      <Text style={styles.h1}>Notes</Text>
      <View style={styles.row}>
        <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="New note" />
        <TouchableOpacity style={styles.btn} onPress={add}>
          <Text style={styles.btnText}>Add</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={notes}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => (
          <View style={styles.note}>
            <Text style={styles.noteTitle}>{item.title}</Text>
            {item.body ? <Text>{item.body}</Text> : null}
          </View>
        )}
      />
      <StatusBar style="auto" />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 64, gap: 12 },
  h1: { fontSize: 24, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
  btn: { backgroundColor: "#111", borderRadius: 8, paddingHorizontal: 16, justifyContent: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  note: { borderWidth: 1, borderColor: "#eee", borderRadius: 8, padding: 12, marginVertical: 4 },
  noteTitle: { fontWeight: "600", marginBottom: 2 },
})
`
