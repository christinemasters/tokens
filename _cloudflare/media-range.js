// Partial downloads for video and audio.
//
// Cloudflare's file hosting answers a partial-download (Range) request with the
// whole file. Safari, and every browser on iPhone and iPad, will not play a
// video from a server that does that. This Worker gives the proper partial
// answer. It runs only for the paths listed under "run_worker_first" in
// wrangler.jsonc. Every other address on the site is served as a plain file.

const CACHE = "public, max-age=604800";

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    // Ask the file store for the whole file, without the range headers.
    const wanted = request.headers.get("Range");
    const ifRange = request.headers.get("If-Range");
    const forward = new Headers(request.headers);
    forward.delete("Range");
    forward.delete("If-Range");
    const asset = await env.ASSETS.fetch(new Request(request.url, { method: request.method, headers: forward }));

    const headers = new Headers(asset.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    if (new URL(request.url).hostname.startsWith("preview.")) headers.set("X-Robots-Tag", "noindex");

    // Not found, not modified, or anything else unusual: pass it through.
    if (asset.status !== 200) {
      return new Response(asset.body, { status: asset.status, headers });
    }

    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", CACHE);

    const whole = (body = asset.body) => new Response(body, { status: 200, headers });

    if (!wanted || request.method === "HEAD") return whole();
    if (ifRange && ifRange !== asset.headers.get("ETag")) return whole();

    // The file store does not say how large the file is, so read it to find out.
    // The largest media file on the site is about 7 MB.
    const bytes = await asset.arrayBuffer();
    const size = bytes.byteLength;

    const range = parseRange(wanted, size);
    if (range === null) return whole(bytes);
    if (range === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }

    const { start, end } = range;
    const length = end - start + 1;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    return new Response(new Uint8Array(bytes, start, length), { status: 206, headers });
  },
};

// Understands the three single-range forms: "bytes=A-B", "bytes=A-" and "bytes=-N".
// Returns null for anything else, which means "send the whole file".
export function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;

  if (match[1] === "") {
    const tail = Number(match[2]);
    if (tail === 0) return "unsatisfiable";
    return { start: Math.max(size - tail, 0), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (start > end) return null;
  return { start, end };
}
