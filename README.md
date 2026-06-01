# component-similarity

Detecta componentes React casi idénticos en tu codebase usando embeddings semánticos.

Escanea tus archivos `.tsx`/`.jsx`, extrae las props y la estructura JSX de cada componente, los embede con OpenAI y calcula similitud coseno entre todos los pares. Los componentes demasiado parecidos se agrupan en clusters con una sugerencia de consolidación. El resultado se publica como comentario sticky en el pull request.

---

## El problema que resuelve

Todo equipo termina con tres versiones del mismo card, dos loaders que hacen lo mismo y cuatro formas de mostrar un empty state. Nadie lo hizo con mala intención — simplemente nadie sabía que el otro existía.

Esta herramienta corre en CI y muestra esas superposiciones antes de que se acumulen.

---

## Instalación

```bash
npm install --save-dev component-similarity
```

Agregá un `components.config.js` en la raíz del proyecto (ver [Configuración](#configuración) más abajo).

---

## Uso

```bash
# Pipeline completo: scan → embed → compare → report
npx csa analyze

# Publicar el reporte como comentario sticky en el PR
npx csa comment

# O ejecutar cada paso por separado
npx csa scan      # → out/components-manifest.json
npx csa embed     # → out/components-embeddings.json
npx csa compare   # → out/components-similarity.json
npx csa report    # → out/report.md
```

---

## Configuración

Copiá `components.config.example.js` a `components.config.js` y ajustá:

```js
export default {
  srcDir: 'src/components',
  threshold: 0.85,
  model: 'text-embedding-3-small',
  concurrency: 8,
  outDir: 'out',
};
```

### `srcDir` (requerido)

Ruta al directorio que contiene tus componentes, relativa a la raíz del proyecto. El escaneo es recursivo — recorre todos los subdirectorios.

```js
srcDir: 'src/components'  // Create React App / Vite
srcDir: 'components'      // Next.js
srcDir: 'src/ui'          // estructura personalizada
```

Se procesan tanto `.tsx` como `.jsx`. Los archivos que no exportan un nombre en PascalCase son ignorados (utilidades, hooks, barrels de re-exportación, etc.).

### `threshold`

Un número entre 0 y 1. Dos componentes se marcan como similares cuando su similitud coseno es **igual o mayor** a este valor.

- **0.90** — muy conservador. Solo atrapa componentes casi idénticos (mismas props, misma estructura DOM).
- **0.85** — valor por defecto recomendado. Atrapa duplicados reales y componentes que divergieron a partir del mismo origen.
- **0.80** — red más amplia. Puede marcar componentes que comparten un propósito general (por ejemplo, todos los campos de formulario) aunque sus props difieran bastante. Esperar más falsos positivos.
- **0.75** — principalmente ruido en una codebase típica.

Empezá en 0.85. Si el reporte sale vacío y sospechás que hay duplicados, bajá a 0.82 o 0.80.

### `model`

El modelo de embeddings de OpenAI a usar. `text-embedding-3-small` es la elección correcta para esta tarea: es rápido, barato y produce vectores semánticos de alta calidad para texto con estructura de código.

`text-embedding-3-large` cuesta 13× más y no mejora los resultados de forma significativa para similitud de componentes. No cambies esto a menos que tengas una razón específica.

### `concurrency`

Cuántas llamadas al API de embeddings se hacen en paralelo. El valor por defecto (8) satura el rate limit del tier gratuito sin superarlo. Si estás en un tier pago con límites más altos podés subirlo; si ves errores 429, bajalo.

### `outDir`

Dónde se escriben los archivos JSON intermedios y el `report.md` final. Por defecto es `out`. Si tu proyecto ya usa un directorio `out` para otra cosa, cambialo para evitar conflictos (por ejemplo, `out-similarity`).

---

## Cómo funciona

### 1. Scan (sin llamadas al API)

`csa scan` recorre el `srcDir` y parsea cada archivo con [ts-morph](https://ts-morph.com/). De cada componente extrae:

- **Props** — interfaces o type aliases de TypeScript, o parámetros desestructurados de la función para archivos JS
- **Estructura JSX** — los tags HTML (`div`, `button`, `img`, …) en orden depth-first, hasta 60 tags
- **Imports** — imports nombrados y por defecto de todos los `import` del archivo

Estas tres señales juntas forman una huella semántica compacta de qué hace el componente y cómo está construido.

### 2. Embed (llama al API de OpenAI)

`csa embed` serializa cada componente en un texto corto y llama al API de embeddings de OpenAI:

```
Component: MantineDateField
Props: name, label, format?, isRequired?, isDateType?, onChange?, minDate?
JSX structure: (none)
Imports: React, DatePicker, useField, useFormikContext
```

El vector resultante (1536 dimensiones) codifica el significado semántico del componente. Componentes que hacen cosas parecidas quedan cerca en ese espacio, independientemente de cómo se llamen.

**Caché de embeddings:** el hash SHA-256 de cada archivo fuente se guarda junto a su vector. En ejecuciones posteriores, solo se re-embeden los archivos que cambiaron. Los componentes sin cambios se leen de `out/components-embeddings.json` sin costo. En CI, combiná esto con `actions/cache` (ver [GitHub Actions](#github-actions)) para persistir el caché entre runs.

### 3. Compare (sin llamadas al API)

`csa compare` calcula similitud coseno para cada par de componentes y agrupa los similares en clusters usando union-find. Cada cluster recibe una sugerencia de consolidación heurística basada en props compartidas y estructura DOM.

### 4. Report

`csa report` escribe `out/report.md` — un archivo Markdown listo para publicarse como comentario de PR en GitHub. `csa comment` lo hace de forma sticky (actualiza el comentario en cada re-run, no spamea el PR).

---

## Costos

El único paso que llama al API de OpenAI es `csa embed`. `text-embedding-3-small` tiene un precio de **$0.020 por millón de tokens**.

La representación de texto de cada componente ocupa aproximadamente 100–300 tokens según cuántas props y tags JSX tenga.

| Tamaño de codebase | Tokens por run | Costo por run | 50 PRs/mes |
|--------------------|---------------|---------------|------------|
| 20 componentes | ~1.500 | $0.000030 | $0.002/mes |
| 100 componentes | ~10.000 | $0.000200 | $0.010/mes |
| 300 componentes | ~40.000 | $0.000800 | $0.040/mes |
| 600 componentes | ~100.000 | $0.002000 | $0.100/mes |

**Con el caché de hashes activo, el costo real por run es proporcional a cuántos componentes cambiaron en el PR**, no al total. Un PR que toca 5 componentes de un proyecto con 300 cuesta ~$0.000013.

Para ponerlo en perspectiva: una sola llamada de clasificación visual con GPT-4o (3 screenshots) cuesta ~$0.009. El run completo de embeddings para una codebase de 100 componentes cuesta menos que clasificar una única pantalla cambiada.

---

## GitHub Actions

Agregá este workflow para que corra en cada PR que toque tu directorio de componentes:

```yaml
# .github/workflows/component-similarity.yml
name: Component Similarity

on:
  pull_request:
    paths:
      - 'src/components/**'   # ajustar al srcDir de tu proyecto

permissions:
  pull-requests: write

jobs:
  component-similarity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci

      # Restaurar caché de embeddings. Hit exacto = 0 llamadas al API.
      # Hit por prefijo = restauración parcial; solo se re-embeden los archivos cambiados.
      - uses: actions/cache@v4
        with:
          path: out/components-embeddings.json
          key: csa-embed-${{ hashFiles('src/components/**/*.tsx', 'src/components/**/*.jsx') }}
          restore-keys: csa-embed-

      - name: Analizar similitud
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: npx csa analyze

      - name: Comentar en el PR
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx csa comment
```

Secrets necesarios: `OPENAI_API_KEY`. `GITHUB_TOKEN` lo provee GitHub Actions automáticamente.

---

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `OPENAI_API_KEY` | Requerida para `csa embed`. |
| `GITHUB_TOKEN` | Requerida para `csa comment`. |
| `CSA_CONFIG` | Sobreescribe la ruta del archivo de config (por defecto: `components.config.js`). |
| `CSA_PR_NUMBER` | Sobreescribe el número de PR para comentar (se detecta automáticamente en GitHub Actions). |
