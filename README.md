# StackCarve

StackCarve is a client-side browser application that converts a triangle mesh or photograph into nested CNC cut files for a stacked plywood sculpture. It is configured around a Sienci AltMill MK2 with a default 48 × 48 inch sheet/work area and uses decimal inches throughout.

## Included in this build

- **Mesh input:** STL, OBJ, and GLB through Three.js loaders.
- **Mesh cleanup:** vertex welding, degenerate triangle removal, signed-volume winding correction, recomputed normals, and boundary/non-manifold edge diagnostics.
- **Photo relief:** luminance heightmap with invert, black/white levels, gamma, blur, background threshold, terrace quantization, marching-squares contours, simplification tied to minimum feature, and minimum island area.
- **AI statue:** pluggable `ImageTo3DProvider` interface with a Meshy implementation. The API key is stored only in browser `localStorage` and is omitted from project JSON.
- **Slicing:** selectable X/Y/Z axis, interactive rotation gizmo, uniform scaling to the achieved layer height, mid-plane triangle sections, segment stitching, and nested contour classification.
- **Hollowing:** wall inset, solid cap counts, relief mounting-face cap, and adjacent-layer overlap clamping.
- **Dowel registration:** two-hole interface checks, reuse of continuing columns, maximum-spread placement, edge clearance, hollow-void boss insertion, and failure warnings.
- **Etching:** single-stroke vector layer fractions and +Y front arrows. No DXF TEXT entities are emitted.
- **Nesting:** descending bounding-area shelf packing, optional 90-degree rotation, and a cutout-nesting pass for smaller parts.
- **Export:** one AC1015 DXF and one inch-scaled SVG per sheet, ZIP bundle, CSV sheet map, and `.stackcarve.json` project file.
- **DXF layers:** `OUTER_CUT`, `INNER_CUT`, `DOWEL`, `ETCH`, and `SHEET`, each with a distinct AutoCAD color.

## Run locally

```bash
npm install
npm run dev
```

Production validation:

```bash
npm test
npm run build
npm run preview
```

The static output is written to `dist/`.

## GitHub Pages

The project includes `.github/workflows/deploy.yml`. Push the repository to GitHub, enable **Settings → Pages → Source: GitHub Actions**, and push to `main`. Vite uses `base: './'`, so the build works under a repository subpath.

## Meshy image-to-3D

StackCarve submits a base64 data URI to Meshy's image-to-3D endpoint, polls the task, downloads the GLB, and then passes that GLB through the same local mesh pipeline. The completed GLB is embedded in project JSON so reopening the project does not require regenerating the model.

If direct browser requests are blocked by CORS, deploy this minimal Cloudflare Worker and paste its URL into **AI settings → Proxy URL**. Use a Worker you control; the authorization header necessarily passes through it.

```js
export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const target = incoming.searchParams.get('url');
    if (!target) return new Response('Missing url query parameter', { status: 400 });

    const destination = new URL(target);
    const allowed = destination.hostname === 'api.meshy.ai' ||
      destination.hostname.endsWith('.meshy.ai');
    if (!allowed) return new Response('Target host not allowed', { status: 403 });

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('origin');
    headers.delete('referer');

    const upstream = await fetch(destination, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow'
    });

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders
    });
  }
};
```

For a production proxy, add an `OPTIONS` response, restrict `Access-Control-Allow-Origin` to the deployed app, and apply rate limits.

## Geometry implementation notes

The browser build uses a deterministic triangle-plane sectioner and an integer-scaled Clipper compatibility adapter (`clipper-lib`) for polygon offsets and booleans. The adapter boundary is isolated in `src/geometry/clipper.ts`, so Clipper2-WASM can replace it without changing the hollowing, dowel, nesting, or export code.

The app blocks invalid contours with fewer than three vertices from closed-profile export. DXF curves, including dowel circles, are emitted as closed LWPOLYLINE approximations using the configured chord tolerance. Etch strokes are intentionally open LWPOLYLINE entities.

## Current production-hardening items

- The optional Depth Anything Small / transformers.js source is represented in settings but is not loaded in this build. Luminance relief is fully operational.
- Mesh repair is conservative and does not perform full watertight remeshing. Non-manifold files proceed with visible warnings and best-effort sections.
- Dowel placement is geometric and deterministic, but unusually fragmented models should be reviewed in the Slices and Sheets tabs before cutting.
- Cutout nesting uses conservative corner-in-polygon clearance; a no-fit-polygon optimizer would improve yield on irregular parts.
- For shop use, validate generated DXF/SVG in the selected CAM package and run a scrap-material test before committing a full sheet.

## Project structure

```text
src/
  components/   UI, Three.js model/slice views, sheet view
  engine/       hollowing, dowels, etching, nesting, shared pipeline
  export/       DXF, SVG, ZIP, project JSON
  geometry/     polygon utilities and clipping adapter
  mesh/         loaders, repair, and sectioning
  providers/    image-to-3D adapter and Meshy provider
  relief/       heightmap processing and marching squares
```
