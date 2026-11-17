(() => {
  const cfg = () => window.BULLDOGS || {};

  const publicMediaUrl = (pathOrUrl) => {
    const value = String(pathOrUrl || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || value.startsWith("assets/") || value.startsWith("data:")) return value;
    const base = String(cfg().supabaseUrl || "").replace(/\/$/, "");
    if (!base) return value;
    const path = value.replace(/^\/+/, "");
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    return `${base}/storage/v1/object/public/media/${encoded}`;
  };

  const compressImage = (file, maxEdge = 1600, quality = 0.82) =>
    new Promise((resolve, reject) => {
      if (!file?.type?.startsWith("image/")) {
        reject(new Error("Choose an image file"));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Couldn't process image"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Couldn't process image"));
              return;
            }
            const ext = type === "image/png" ? "png" : "jpg";
            resolve(new File([blob], `upload.${ext}`, { type }));
          },
          type,
          quality,
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Couldn't read image"));
      };
      img.src = url;
    });

  const uploadMedia = async (folder, file) => {
    const sb = window.BULLDOGS_SB;
    if (!sb) throw new Error("Sign in again to upload");
    const prepared = await compressImage(file);
    const ext = prepared.name.split(".").pop() || "jpg";
    const path = `${String(folder || "uploads").replace(/\/+$/, "")}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("media").upload(path, prepared, {
      upsert: true,
      contentType: prepared.type,
      cacheControl: "3600",
    });
    if (error) throw error;
    const { data } = sb.storage.from("media").getPublicUrl(path);
    return data.publicUrl;
  };

  const applySiteMedia = (map) => {
    document.querySelectorAll("[data-site-media]").forEach((el) => {
      const key = el.getAttribute("data-site-media");
      const url = map?.[key];
      if (!url) return;
      if (el.tagName === "IMG") el.src = url;
      else el.style.backgroundImage = `url("${url}")`;
    });
  };

  const loadSiteMedia = async () => {
    const api = window.BULLDOGS_API;
    if (!api) return {};
    try {
      const rows = await api.rpc("list_site_media");
      const map = Object.fromEntries((rows || []).filter((row) => row.url).map((row) => [row.key, row.url]));
      window.BULLDOGS_SITE_MEDIA = map;
      applySiteMedia(map);
      return map;
    } catch {
      window.BULLDOGS_SITE_MEDIA = window.BULLDOGS_SITE_MEDIA || {};
      return window.BULLDOGS_SITE_MEDIA;
    }
  };

  window.BULLDOGS_MEDIA = { publicMediaUrl, uploadMedia, compressImage, loadSiteMedia, applySiteMedia };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      loadSiteMedia();
    });
  } else {
    loadSiteMedia();
  }
})();
