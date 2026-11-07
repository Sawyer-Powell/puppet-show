// Pixel diff for review: after a step is re-verified, say where it actually
// moved, and crop a marked-up image of just that region. Chrome does the
// decoding and compositing; there are no image dependencies.
export async function diffPngs(browser, { before, after, threshold = 8, pad = 16 }) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  try {
    return await page.evaluate(async ({ before, after, threshold, pad }) => {
      const load = (src) => new Promise((res, rej) => {
        const image = new Image();
        image.onload = () => res(image);
        image.onerror = () => rej(new Error("undecodable PNG"));
        image.src = `data:image/png;base64,${src}`;
      });
      const [a, b] = await Promise.all([load(before), load(after)]);
      if (a.width !== b.width || a.height !== b.height) return { resized: `${a.width}x${a.height} → ${b.width}x${b.height}` };
      const { width, height } = a;
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      // Copy out of the live canvas before reuse: getImageData returns a view.
      const read = (image) => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, width, height).data.slice();
      };
      const before_ = read(a), after_ = read(b);
      const changed = new Uint8Array(width * height);
      let count = 0, minX = width, minY = height, maxX = -1, maxY = -1;
      for (let i = 0, p = 0; i < changed.length; i++, p += 4) {
        const delta = Math.max(
          Math.abs(before_[p] - after_[p]), Math.abs(before_[p + 1] - after_[p + 1]),
          Math.abs(before_[p + 2] - after_[p + 2]), Math.abs(before_[p + 3] - after_[p + 3]));
        if (delta <= threshold) continue;
        changed[i] = 1; count++;
        const x = i % width, y = (i / width) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const bbox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      if (!count) return { pct: 0, bbox: null };
      // Moved pixels in red over a dimmed copy of the new state.
      const marked = ctx.createImageData(width, height);
      for (let i = 0, p = 0; i < changed.length; i++, p += 4) {
        if (changed[i]) {
          marked.data[p] = 255; marked.data[p + 1] = 96; marked.data[p + 2] = 48; marked.data[p + 3] = 240;
        } else {
          const grey = (after_[p] * 0.3 + after_[p + 1] * 0.59 + after_[p + 2] * 0.11) * 0.4;
          marked.data[p] = grey; marked.data[p + 1] = grey; marked.data[p + 2] = grey; marked.data[p + 3] = 255;
        }
      }
      const full = document.createElement("canvas");
      full.width = width; full.height = height;
      full.getContext("2d").putImageData(marked, 0, 0);
      const x = Math.max(0, bbox.x - pad), y = Math.max(0, bbox.y - pad);
      const cropWidth = Math.min(width - x, bbox.width + pad * 2);
      const cropHeight = Math.min(height - y, bbox.height + pad * 2);
      const crop = document.createElement("canvas");
      crop.width = cropWidth; crop.height = cropHeight;
      crop.getContext("2d").drawImage(full, x, y, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      return { pct: count / changed.length, bbox, png: crop.toDataURL("image/png") };
    }, { before, after, threshold, pad });
  } finally { await page.close(); }
}
