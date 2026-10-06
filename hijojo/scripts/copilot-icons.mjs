// Generates the two icons a Microsoft 365 app package needs: a 192x192 colour
// icon and a 32x32 white-on-transparent outline icon. Run once; the PNGs are
// committed. Plain Node, no image library.
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * (size * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A bold "H" in a unit square: two uprights and a crossbar. */
function inH(u, v) {
  const upright = (u >= 0.24 && u <= 0.38) || (u >= 0.62 && u <= 0.76);
  return v >= 0.22 && v <= 0.78 && (upright || (u > 0.38 && u < 0.62 && v >= 0.45 && v <= 0.56));
}

const BLUE = [0x1f, 0x5e, 0xff, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

writeFileSync("copilot/appPackage/color.png", png(192, (x, y) => (inH(x / 192, y / 192) ? WHITE : BLUE)));
writeFileSync("copilot/appPackage/outline.png", png(32, (x, y) => (inH((x + 0.5) / 32, (y + 0.5) / 32) ? WHITE : CLEAR)));
console.log("Wrote copilot/appPackage/color.png and outline.png");
