import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "..", "public");
const srcSvg = readFileSync(resolve(publicDir, "pwa-icon-source.svg"));

const targets = [
  { out: "icon-192.png", size: 192 },
  { out: "icon-512.png", size: 512 },
  { out: "icon-512-maskable.png", size: 512, pad: 0.12 },
  { out: "apple-touch-icon.png", size: 180 },
  { out: "favicon-32.png", size: 32 },
  { out: "favicon-16.png", size: 16 },
];

async function generate() {
  for (const t of targets) {
    const size = t.size;
    const pad = t.pad ?? 0;
    const inner = Math.round(size * (1 - pad * 2));
    const offset = Math.round((size - inner) / 2);

    const iconBuffer = await sharp(srcSvg, { density: 384 })
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: iconBuffer, top: offset, left: offset }])
      .png({ compressionLevel: 9 })
      .toFile(resolve(publicDir, t.out));

    console.log(`  ✓ ${t.out}  (${size}x${size}${pad ? `, ${Math.round(pad * 100)}% safe area` : ""})`);
  }
}

generate().catch((e) => {
  console.error("Icon generation failed:", e);
  process.exit(1);
});
