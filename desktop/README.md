# JACK Desktop V0.1

GUI de escritorio para JACK construida con **Tauri 2 + React + TypeScript**, conectada al CLI existente (`bin/jack`) mediante comandos IPC tipados y validación estricta de entradas.

## Requisitos de compilación (Linux)

- Node.js 20+ y `npm`
- Rust (`rustc` y `cargo`)
- Dependencias de sistema de Tauri 2 (`webkit2gtk-4.1`, `gtk+-3.0`, `pkg-config`)

## Desarrollo y pruebas

```bash
cd desktop
npm install
npm run lint
npm run build
npm test
cd src-tauri && cargo test
```

## Compilación de binario Linux

```bash
cd desktop
npx tauri build --no-bundle
# Binario generado en: desktop/src-tauri/target/release/jack-desktop
```

## Seguridad y retención

- Toda ejecución del CLI usa listas explícitas de argumentos (`argv`), nunca interpolación de shell.
- Las credenciales SSH (contraseñas, llaves privadas, `known_hosts`) nunca son solicitadas ni modificadas por la interfaz.
- La desinstalación del enlace CLI preserva tu configuración, llaves y respaldos.
