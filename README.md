# StackCarve

StackCarve is a browser app that turns a photo, a 3D model or just an idea into CNC cut files for a layered sheet sculpture. Everything runs client side. It is set up around a Sienci AltMill MK2 (48 × 48 in bed), Fusion 360 for CAM, and 4 × 8 ft sheet stock, with decimal inches throughout.

Live app: https://creekdawg12.github.io/stackcarve/

## How a project runs

The app is four steps across the top. Any step can be opened at any time; the main button at the bottom of the left panel always names the next thing to do.

1. **Plan.** A short brief on the left: what you are making (line-art slabs, face plaque, solid slabs or statue), from a photo or a 3D model, how big on the wall, how far off the wall, stock thickness, sheet size, and optionally how many 4 × 8 sheets you have and what one costs. Beside it is the plan sheet, worked out before anything is loaded or cut:
   - **Front and side views** to scale, drawn the way the chosen style will cut the piece, plus the piece next to a 5 ft 8 in person.
   - **Quantities:** pieces, finished size, sheets to cut, 4 × 8 sheets to buy, rods and spacers or pins, weight, and cost if a price is set.
   - **Compare:** the same build at other thicknesses, gaps or styles, with pieces, sheets and weight. Tap a row to use it.
   - **Notes:** whether the largest part fits the sheet, whether the job fits the stock on hand (with one-tap fixes such as a size that fits), too many or too few pieces, and when the weight calls for a French cleat.

   The numbers start as a rough estimate for a typical portrait, tighten to an estimate measured off your photo or model once it is loaded, and are replaced by the generated figures (in ink, with the total cut length) after Generate. **Print this plan** gives a one-page sheet for the shop.
2. **Design** or **Model.** For a photo build, this is where the picture comes from: describe the piece and have ChatGPT draw it, or bring your own photo. Each picture is shown as it would be cut and scored, and one is chosen (see Design, below). For a model: turn it the right way up.
3. **Slices.** Generate, then check the piece in 3D. The panel lists what came out and anything to check before cutting. Hollowing, rods or pins, and part numbers are tucked into folds here.
4. **Sheets.** The nested sheets, the **Before you cut** checklist, and the cut files.

The last brief is remembered in the browser, so the app reopens on your stock and sizes. **New project** in the menu at the top right clears it.

## Design: from an idea to the picture you cut

Wall art only needs a picture, because StackCarve works the depth out on the device. So the Design step gets a good picture and checks it before any wood is planned around it. It uses your own ChatGPT plan through the ordinary ChatGPT site: no API, no key, nothing to set up.

1. **Say what it should be**, for example "English bulldog face, grumpy, big jowls". **Open ChatGPT with the prompt** opens ChatGPT in a new tab with the whole prompt already in the box, and copies it as well in case the box comes up empty. Send it.
2. **Copy the picture** ChatGPT makes (press and hold, or right-click, then Copy image), come back and **Paste**. Ctrl+V, dropping a file and **Choose photos** work too.
3. The prompt asks for **four takes on one sheet**: true to life, simplified, exaggerated and geometric. StackCarve takes the sheet apart into four pictures, each cropped and cut out from the white background. If the designs touch, or the sheet comes in whole, **cut it into quarters** splits it by position instead.
4. **Judge** runs the depth model on each picture and shows it the way your plan would cut it, with two scores from 0 to 100:
   - **Detail kept:** how much of the shape survives at your slab spacing or layer thickness.
   - **Sturdy:** how few pieces come out loose from the main body or sliver-thin.

   Each picture gets a verdict (Good to cut, Worth a tweak, Needs rework) and the main button offers the top pick. The scores follow the plan: thicker stock or a smaller piece keeps less detail, so one picture can pass on one brief and fail on another. The large view shows the piece at about the size it looks from 10, 20 or 40 ft, and slab builds can be seen at an angle or dead on.
5. **Ask ChatGPT for changes** writes the follow-up: it names the design by its place on the sheet, lists what the checks call for (simplify fine detail, thicken thin parts, push the depth, show the whole subject) plus anything you type, and asks for that one design on its own. Paste it into the same ChatGPT chat, then paste the new picture back.
6. **Use this one** makes a picture the one the slicer works from. **Fine-tune** opens the cutout brush and the depth controls for it (see From a photo).

**Ask Claude** copies a numbered sheet of the pictures as cut and opens Claude with a short question, for a second opinion on which one reads best from across a room. Paste the sheet into the message.

**The prompt** fold shows the text that is sent and lets you edit it; `{idea}` marks where your idea goes. The built-in prompt asks for what the depth model and a router both need: one matte gray material under soft, even light (so shading reads as shape, not as paint or shadow), a straight-on view, deep rounded forms with a strong outline, no thin or floating parts, and a plain white background with space around each design (so the designs can be told apart and cut out).

Pictures wait in a tray of up to 12. The tray, the idea and any prompt edits are kept in this browser only, so leaving for ChatGPT and coming back loses nothing, even if a tablet drops the tab in the meantime. A project file saves the picture in use, with its depth and cutout, and not the rest of the tray.

## Three ways to build

| Style | What it makes | Alignment | Where the numbers go |
|---|---|---|---|
| **Statue** | Free-standing stack, slices across the axis you pick | Two pins at every layer joint | Anywhere the next layer covers |
| **Face plaque** (terraced) | Layers parallel to the wall, contour-map look. Layer 1 sits on the wall | Short pins between neighbours, only where the layer two steps up hides the hole | Under the next layer toward the viewer |
| **Line-art slabs** and **Solid slabs** | Slabs on edge with a flat back against the wall, spaced apart or touching, running up and down or side to side | Two rods through a hidden strip along the back edge, shared by every slab | In the back strip, under the next slab |

A photo builds a plaque or slabs from a depth map (see below). A statue needs a 3D model.

Wall art from a model needs it oriented face toward you with the top up. The Model step shows that view, with the grid as the wall and an orange arrow for up. The rotation rings, the quick buttons (Stand it up, Turn it around) and the exact angles all work.

### Size

- **Width** (photo) is the width of the cut-out subject on the wall, not of the photo frame; the height follows. Projects saved before the planner keep their old meaning (frame width) and offer a one-tap switch.
- **Height of the model** sets the scale for wall art from a model; **Depth off the wall** is how much of the model stays in front of the wall plane (0 keeps it all). A face usually wants the front 40 to 60% of the head.
- **Flatten the depth** (Model step) squashes depth toward the front for a shallower piece.
- Slices with nothing in front of the wall plane are dropped from the ends, and the plan reports the finished size of what is left.

### Slabs

- **Slabs run** up and down (stacked left to right) or side to side (stacked bottom to top).
- **Gap between slabs** spaces them apart: the piece reads as line art and uses about half the wood. Spacer sleeves on the rods hold the gap (3D print them, or use nuts on threaded rod); the plan, the checklist and `assembly.txt` list the count and length.
- **Hidden strip at the back** (Slices step) is reserved for rod holes and numbers. Hollowing never eats it.
- **Rod hole** is what gets routed; 13/32 in suits 3/8 in rod.
- **Backer plate** adds a silhouette plate for hanging hardware; the slabs' flat backs glue to it.

### From a photo

Wall art only shows the front surface, so a depth map of the photo is all the 3D the slicer needs. The **Fine-tune** view of the Design step offers two depth sources and a cutout, all computed in the browser. A single photo added on its own opens straight into it; pictures judged in the tray arrive with their depth already estimated.

1. **Estimate depth** runs Depth Anything V2 Small (Apache-2.0) through Transformers.js, on the GPU via WebGPU when the browser has it, otherwise on the CPU. It predicts relative depth from a single photo: the nose comes forward, the ears fall back toward the wall.
2. **Cut out subject** runs RMBG-1.4 to separate the subject from the background. The resulting mask is the silhouette of the piece. RMBG-1.4 is licensed for non-commercial use; swap the model id in `src/defaults.ts` if that matters to you.
3. The stage shows the photo with the cutout painted over it and the depth that will be cut. Paint with the Remove or Keep brush to fix edges or drop the body below a face. **Keep largest** drops specks, **Fill holes** closes eyes and gaps, **Undo** steps back through strokes and cleanups. After the cutout the wall plane is fitted to the back of the subject automatically.
4. **Fine-tune the depth** holds the rest: wall plane, black and white points, gamma (below 1 pushes the nose out), smoothing, and the brightness fallback that needs no download.

The main button leads through depth and cutout, with **Generate without it** beside it if you would rather skip them.

Models download from the Hugging Face Hub once (roughly 50 to 150 MB in total) and are cached by the browser; the ONNX runtime comes from jsDelivr. Nothing is uploaded anywhere. Shoot the subject head-on, filling the frame, against a plain background.

Depth and mask are autosaved to the browser (IndexedDB) as you work, so a tab that crashes or reloads offers to restore the session; the project file is still the real save, and a banner reminds you. Each AI model is released from memory as soon as its job is done, and tablets run the cutout at a smaller size, both to stay inside mobile Safari's memory limits. Photo depth is relative, so **Depth off the wall** sets how far the closest point stands out and **Depth at the edges** (Slices step) sets the minimum depth inside the silhouette, which gives every slab a flat back to glue and drill. Saved projects embed the depth and mask so reopening one does not rerun the models.

### Previews

Slices: drag to turn, pinch or scroll to zoom, two fingers or right-drag to pan, tap a part to select it; + / − / Fit buttons top right. The camera holds while you pull the stack apart or select parts. Sheets: drag to pan, pinch or scroll to zoom, + / − / Fit over the drawing. Changing a setting keeps the last result on screen, marked out of date, until you regenerate.

### Keeping only what shows

Hollowing removes the inside of each layer wherever both neighbours also cover it, less a glue margin and a wall. Steps that show on the finished piece stay solid. Voids narrower than the minimum feature are left solid. Small parts are nested inside the voids of bigger parts.

### Rods (slabs)

The app picks up to two rod columns that fit the most slabs. A rod hole is only placed where the slab above covers it, so no hole shows on a visible step. A slab that takes one rod is still fully located by the rod plus its flat back edge against a straight board. Slabs that fit no rod (the few at the very top and bottom) are listed for glue-up by eye. The checklist on the Sheets step and `assembly.txt` in the ZIP give each rod's position, span and cut length.

### Hidden pins (terraced)

Pin holes go through two layers, so a hole only ends on a hidden face if the layer two steps up covers it. StackCarve only places pins where that holds; the last interface or two are glued without pins and listed in the warnings.

### Numbers

Each piece gets an etched label (`17/42`, with A/B suffixes for islands) plus an up arrow, drawn as single-stroke polylines for a V-bit. In wall art the label is only placed where the next piece hides it; a piece with no hidden spot is left blank and listed in the warnings. The sheet map CSV identifies every part either way.

## Included in this build

- **Mesh input:** STL, OBJ, and GLB through Three.js loaders, with welding, winding fix, and manifold diagnostics.
- **Photo input:** AI depth (Depth Anything V2 Small) or brightness heightmap, AI cutout (RMBG-1.4) or threshold mask with a brush editor, depth curve (floor, levels, gamma, blur), terrace quantization with marching-squares contours, or slab profiles per band.
- **Design:** a prompt handed to ChatGPT by link and clipboard, sheets taken apart by background and connected subjects with a quarter-cut fallback, each picture judged on the device as it would be cut (detail kept, sturdiness), follow-up prompts, and a contact sheet for a second opinion.
- **Planning:** estimates from a front view of the subject (photo depth, a rasterised model, or a built-in sample), checked against the real slicer and nester in the tests; sheet counts are given as a range when the estimate straddles a sheet.
- **Model from a photo:** pluggable `ImageTo3DProvider` interface with a Meshy implementation, under the Model step. The API key stays in browser `localStorage`.
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

## Cloudflare

The same app can run on Cloudflare alongside GitHub Pages. `wrangler.jsonc` tells Cloudflare to serve `dist` as a static site, and `npm run build:cloudflare` makes a build that fits its limit of 25 MiB per file: it leaves out a 26.9 MB copy of the AI runtime that the app never requests (`scripts/prune-oversize.mjs` has the details). Once connected, every push to `main` redeploys both sites.

One-time setup in the Cloudflare dashboard:

1. **Workers & Pages → Create application → GitHub.** If `stackcarve` is not in the list, follow the link there to give the Cloudflare GitHub app access to this repository.
2. Select `stackcarve`. Keep the project name `stackcarve` (it has to match `wrangler.jsonc`) and the branch `main`.
3. **Build command:** `npm run build:cloudflare`. **Deploy command:** leave it as offered (`npx wrangler deploy`). No variables are needed.
4. **Save and Deploy.** After a couple of minutes the project page shows the address, ending in `workers.dev`.

The two sites are separate as far as a browser is concerned: saved sessions, the picture tray, the remembered brief and the downloaded AI models do not carry from one address to the other, so pick one for everyday use. The Cloudflare site is public, like the GitHub Pages one. Photos never leave the device on either.

## Meshy image-to-3D

StackCarve submits a base64 data URI to Meshy's image-to-3D endpoint, polls the task, downloads the GLB, and passes it through the same local mesh pipeline. The completed GLB is embedded in project JSON.

If direct browser requests are blocked by CORS, deploy this minimal Cloudflare Worker and paste its URL into **Model → Make a model from a photo → Proxy address**. Use a Worker you control; the authorization header passes through it.

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
  components/   step panels, plan sheet, design stage, Three.js model/slice views, sheet view
  design/       ChatGPT prompt, sheet splitting, carve scores, picture tray and its storage
  plan/         front field, estimates, notes, compare rows, style and angled previews
  engine/       hollowing, dowels, rods and wall-art geometry, etching, nesting, pipeline
  export/       DXF, SVG, ZIP, project JSON
  geometry/     polygon utilities and clipping adapter
  mesh/         loaders, repair, sectioning, measurement
  providers/    image-to-3D adapter and Meshy provider
  relief/       heightmap, AI worker (depth and cutout), photo slab profiles, marching squares
  stubs/        empty package standing in for node-only deps
```
