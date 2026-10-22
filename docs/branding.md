# JACK brand guidelines

**JACK — Just Connect.** The mark turns a 3.5 mm audio plug and cable into a
capital J: a familiar connection gesture expressed as a minimal geometric symbol.
It represents the name and connection intent, not audio functionality or a new
product feature. JACK remains a Tailscale + OpenSSH terminal-access CLI.

The Product Owner approved the written direction: graphite, white, vivid orange,
a J-shaped cable, an audio connector, and bold contemporary lettering. No concept
image was found in the checkout. These assets reconstruct that specification;
they do not claim pixel-perfect fidelity to an unavailable ChatGPT concept image.

## Palette

| Color | HEX | Use |
| --- | --- | --- |
| Graphite | `#181A1D` | Primary background; dark mark on light surfaces |
| White | `#FFFFFF` | Cable and lettering on graphite; light icon background |
| Orange | `#FF6B00` | Connector accent; never the only carrier of information |

Use flat fills without gradients, shadows, extra decoration or simulated materials.
Do not add platform logos, circuitry, padlocks or implied vendor endorsements.

## Assets and use

All paths below are relative to this document. SVGs are standalone and require no
fonts, linked images or network resources.

| Asset | Canvas | Intended use |
| --- | --- | --- |
| [Canonical mark](../assets/brand/mark.svg) | 256 × 256 | White cable/orange plug on a transparent background; place on graphite |
| [Logo](../assets/brand/logo.svg) | 760 × 256 | Symbol plus bold outlined JACK lettering on a graphite panel; README and headers |
| [Dark icon](../assets/brand/icon-dark.svg) | 256 × 256 | Primary app/project icon: graphite tile, white cable, orange plug |
| [Light icon](../assets/brand/icon-light.svg) | 256 × 256 | White tile, graphite cable, orange plug; light contexts |
| [Monochrome mark](../assets/brand/mark-monochrome.svg) | 256 × 256 | Graphite mark on white; connector bands use white negative-space cuts |
| [Social preview](../assets/brand/social-preview.svg) | 1280 × 640 | 2:1 graphite banner with logo and outlined “Just Connect.” |

PNG dark-icon exports: [16](../assets/brand/icon-16.png),
[32](../assets/brand/icon-32.png), [64](../assets/brand/icon-64.png),
[128](../assets/brand/icon-128.png), [256](../assets/brand/icon-256.png),
[512](../assets/brand/icon-512.png) pixels square. Outside the rounded tile is
transparent (the 16 px corner has a 1/255 alpha antialias fringe); the graphite
field itself is opaque. Use SVG for scalable artwork.

## Geometry and spacing

The master uses a 256-unit square, 20-unit round-ended cable, vertical connector
axis at x=170, and a 40-unit orange connector body. Two isolation bands and a
tapered tip suggest the audio plug. The hook is one continuous stroked path.
Each variant contains the same literal `g id="mark"` geometry, with color changes
only; social preview applies a uniform outer scale/translation. Keep these copies
synchronized when editing the canonical mark. Rounded tile/panel backgrounds
are separate from the mark.

JACK lettering is original filled path geometry, not a font conversion. The social
tagline is original monoline path lettering. Do not replace either with a font
without recording its license and reviewing consistency. No fonts are embedded.

Keep at least one cable width (20/256 of the mark canvas size) clear of adjacent
content outside the supplied asset bounds. Preserve the logo's internal spacing,
aspect ratio and social canvas margins; do not stretch, rotate or crop the plug.
Prefer the symbol/icon at small sizes, not the full wordmark.

## Size, background and accessibility

Use **32 px or larger** for the icon when space permits; **24 px** is the
recommended minimum for the full cable/connector silhouette. The supplied 16 px
export is a favicon-size compromise: the J remains visible, but connector bands
lose detail. Use the logo at least 240 px wide and the social preview at its
native size for sharing. These are recommendations from local rendered review,
not a guarantee on every display; Product Owner visual acceptance is separate.

White on graphite has about 17.4:1 contrast; orange on graphite about 6.1:1.
Orange on white is about 2.9:1 and is an accent, not small text or a standalone
semantic indicator. The light icon's graphite cable carries the recognizable J.
Use the monochrome variant when color is unavailable. Do not put the transparent
white mark on a light surface; choose a light icon or monochrome mark instead.
Provide meaningful alt text (as in README); avoid conveying state through color.
SVG titles/descriptions identify the artwork without implying SSH readiness.

## Export, validation and maintenance

SVG is the editable source of truth. Optional local `rsvg-convert` was used for
PNG exports; it is not a JACK runtime or contributor requirement. From the
repository root, with that tool already installed:

```bash
for size in 16 32 64 128 256 512; do
  rsvg-convert --width "$size" --height "$size" \
    --output "assets/brand/icon-$size.png" assets/brand/icon-dark.svg
done
rsvg-convert --output /tmp/jack-social-preview.png assets/brand/social-preview.svg
```

After edits, parse every SVG as XML and reject scripts, foreignObject, URLs,
embedded binaries, fonts and external references (the SVG namespace declaration
is required, not a fetched resource). Compare mark geometry across variants,
check viewBoxes, validate PNG dimensions/alpha, and render a contact sheet at
16/24/32/64 px plus full logo/social sizes. Inspect light and dark backgrounds.
Run `./scripts/dev-check.sh` and check documentation links before delivery.
Never hand-edit PNGs independently of their SVG source.

The repository owner may upload the locally exported social PNG through GitHub
repository **Settings → General → Social preview** after visual approval. This
slice does not set repository metadata, upload previews, publish releases or tags.

## Provenance and licensing

All geometry and lettering were authored for JACK during Slice 13 from the
Product Owner's written specification. No reference image was available or used;
no images, third-party logos, font outlines or other artwork were downloaded,
traced or embedded. Assets are provided under the repository's [MIT license](../LICENSE),
including its existing notice and warranty disclaimer. No additional third-party
asset license is required for these files.

This documents provenance, not trademark registration, uniqueness or legal
clearance. Before broader commercial use, the owner should arrange trademark/name
and visual-similarity review. Do not imply affiliation with Tailscale, OpenSSH,
Apple or other vendors. Asset identity does not establish security guarantees,
platform support, releases, or product functionality.
