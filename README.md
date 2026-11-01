# StackCarve

StackCarve is a browser app that turns a 3D model or a photo into CNC cut files for a layered sheet sculpture. Everything runs client side. It is set up around a Sienci AltMill MK2 (48 × 48 in bed), Fusion 360 for CAM, and 4 × 8 ft sheet stock, with decimal inches throughout.

Live app: https://creekdawg12.github.io/stackcarve/

## Three ways to build

| Mode | What it makes | Alignment | Where the numbers go |
|---|---|---|---|
| **Statue** | Free-standing stack, slices across the axis you pick | Two dowels at every layer interface | Anywhere the next layer covers |
| **Wall art: terraced** | Layers parallel to the wall, topo-map look. Layer 1 sits on the wall; an optional base plate makes it the full silhouette | Short pins between neighbours, only where the layer two steps up hides the hole | Under the next layer toward the viewer |
| **Wall art: slabs** | Horizontal slabs stacked bottom to top with a flat back against the wall | Two rods through a hidden strip along the back edge, shared by every slab | In the back strip, under the slab above |

Photo input builds terraced or slab wall art from a depth map of the photo (see below).

Wall art needs the model oriented face toward you with the top up. The Model tab shows that view, with the grid as the wall and an orange arrow for up. The rotation rings, the typed angles, and the quick buttons (Z-up → Y-up, Turn 180°) all work.

### Wall art settings

- **Finished height on wall** sets the scale.
- **Relief depth kept from the front** is how much of the model stays in front of the wall plane. The panel shows the model's depth at the chosen height; a face usually wants the front 40 to 60% of the head. 0 keeps the whole model.
- **Depth compression** squashes depth toward the front (0.5 = half as deep) for a shallower piece.
- Slices with nothing in front of the wall plane (the crown and chin on a head) are dropped from the ends and the finished size is reported.
- **Hidden back zone depth** (slabs) is the strip along the flat back edge reserved for rod holes and numbers. Hollowing never eats it.
- **Rod hole diameter** (slabs) is what gets routed; 13/32 in suits 3/8 in rod.
- **Backer plate** (slabs) adds a silhouette plate for hanging hardware; the slabs' flat backs glue to it.

### From a photo

Wall art only shows the front surface, so a depth map of the photo is all the 3D the slicer needs. The **Photo** input offers two depth sources and a cutout mask, all computed in the browser:

1. **Estimate depth (AI)** runs Depth Anything V2 Small (Apache-2.0) through Transformers.js, on the GPU via WebGPU when the browser has it, otherwise on the CPU. It predicts relative depth from a single photo: the nose comes forward, the ears fall back toward the wall.
2. **Cut out subject (AI)** runs RMBG-1.4 to separate the subject from the background. The resulting mask is the silhouette of the piece. RMBG-1.4 is licensed for non-commercial use; swap the model id in `src/defaults.ts` if that matters to you.
3. The **Photo tab** shows the photo with the mask painted over it and the depth that will be cut. Paint with the Remove or Keep brush to fix edges or drop the body below a face.
4. **Depth curve** controls: wall plane (depth floor), black and white points, gamma (below 1 pushes the nose out), blur, and the brightness fallback that needs no download.

Models download from the Hugging Face Hub once (roughly 50 to 150 MB in total) and are cached by the browser; the ONNX runtime comes from jsDelivr. Nothing is uploaded anywhere. Shoot the subject head-on, filling the frame, against a plain background.

Photo depth is relative, so **Relief depth** sets how far the closest point stands off the wall and **Base depth** sets the minimum depth inside the silhouette, which gives every slab a flat back to glue and drill. Saved projects embed the depth and mask so reopening one does not rerun the models.

### Slab direction and spacing

Slabs can stack bottom to top (horizontal) or from the viewer's left to right (vertical, the classic profile-stand look). **Gap between slabs** spaces them apart: the piece reads as line art and uses about half the wood. The gap is held by spacer sleeves on the rods (3D print them, or use nuts on threaded rod); the Sheets tab and `assembly.txt` list the count and length per rod. Hollowing is usually turned off for gapped slabs, since the voids show through the gaps.

### Keeping only what shows

Hollowing removes the inside of each layer wherever both neighbours also cover it, less a glue margin and a wall. Steps that show on the finished piece stay solid. Voids narrower than the minimum feature are left solid. Small parts are nested inside the voids of bigger parts.

### Rods (slabs)

The app picks up to two rod columns that fit the most slabs. A rod hole is only placed where the slab above covers it, so no hole shows on a visible step. A slab that takes one rod is still fully located by the rod plus its flat back edge against a straight board. Slabs that fit no rod (the few at the very top and bottom) are listed for glue-up by eye. The Sheets tab and `assembly.txt` in the ZIP give each rod's position, span and cut length.

### Hidden pins (terraced)

Pin holes go through two layers, so a hole only ends on a hidden face if the layer two steps up covers it. StackCarve only places pins where that holds; the last interface or two are glued without pins and listed in the warnings.

### Numbers

Each piece gets an etched label (`17/42`, with A/B suffixes for islands) plus an up arrow, drawn as single-stroke polylines for a V-bit. In wall art the label is only placed where the next piece hides it; a piece with no hidden spot is left blank and listed in the warnings. The sheet map CSV identifies every part either way.

## Included in this build

- **Mesh input:** STL, OBJ, and GLB through Three.js loaders, with welding, winding fix, and manifold diagnostics.
- **Photo input:** AI depth (Depth Anything V2 Small) or brightness heightmap, AI cutout (RMBG-1.4) or threshold mask with a brush editor, depth curve (floor, levels, gamma, blur), terrace quantization with marching-squares contours, or slab profiles per band.
- **AI statue:** pluggable `ImageTo3DProvider` interface with a Meshy implementation. The API key stays in browser `localStorage`.
- **Slicing:** statue slices along X, Y, or Z; terraced slices parallel to the wall with a back-plane cut and silhouette base; slab slices clipped to a flat back, horizontal or vertical, touching or gapped.
- **Hollowing:** wall inset, solid caps, neighbour overlap clamping, back-zone protection, minimum-feature filter.
- **Registration:** dowels with bosses (statue), hidden pins (terraced), shared rods with spacer counts (slabs).
- **Etching:** single-stroke labels and arrows placed in hidden zones.
- **Nesting:** skyline packer on real part outlines (0/90/180/270°) so triangular slabs interlock, first-fit across open sheets, small parts packed inside the voids of larger parts. Sheet presets for the 48 × 48 AltMill bed, a full 48 × 96 sheet, and a 24 × 48 half sheet, with the number of 4 × 8 stock sheets reported.
- **Export:** one AC1015 DXF and one inch-scaled SVG per sheet, ZIP bundle with sheet map CSV, assembly notes, and a `.stackcarve.json` project file.
- **DXF layers:** `OUTER_CUT`, `INNER_CUT`, `DOWEL`, `ETCH`, `SHEET`.

## Shop notes

- Measure the stock with calipers and type the real thickness. A few thousandths per slab adds up over a tall stack.
- Keep the DXF nominal: no kerf or tool compensation is baked in. Fusion handles that.
- Cut parts nested inside a void before the void itself, and hold thin stock down (tape and CA, or tabs).
- Validate the first sheet in CAM and cut a scrap test before committing a full sheet.

## Run locally

```bash
npm install
npm run dev
```

Validation:

```bash
npm test
npm run build
npm run preview
```

The static output is written to `dist/`.

## GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`. In the repository, **Settings → Pages → Source** must be **GitHub Actions**. Vite uses `base: './'`, so the build works under the repository subpath.

## Meshy image-to-3D

StackCarve submits a base64 data URI to Meshy's image-to-3D endpoint, polls the task, downloads the GLB, and passes it through the same local mesh pipeline. The completed GLB is embedded in project JSON.

If direct browser requests are blocked by CORS, deploy this minimal Cloudflare Worker and paste its URL into **AI settings → Proxy URL**. Use a Worker you control; the authorization header passes through it.

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

## Geometry notes

Sections are cut with a deterministic triangle-plane sectioner and stitched into closed loops. Booleans and offsets go through an integer-scaled Clipper adapter in `src/geometry/clipper.ts`. Slice drawings use proper rotations (never mirrors), so the etched face is always the one the next layer in stacking order covers. Every cut contour is exported as a closed LWPOLYLINE; etch strokes are open.

## Dependencies note

`@huggingface/transformers` lists the Node-only packages `onnxruntime-node` and `sharp` as dependencies. The browser build never loads them, so `package.json` overrides both with the empty stub in `stubs/empty`; that keeps `npm ci` free of native downloads.

## Project structure

```text
src/
  components/   UI, Three.js model/slice views, sheet view
  engine/       hollowing, dowels, rods and wall-art geometry, etching, nesting, pipeline
  export/       DXF, SVG, ZIP, project JSON
  geometry/     polygon utilities and clipping adapter
  mesh/         loaders, repair, sectioning, measurement
  providers/    image-to-3D adapter and Meshy provider
  relief/       heightmap, AI worker (depth and cutout), photo slab profiles, marching squares
  stubs/        empty package standing in for node-only deps
```
