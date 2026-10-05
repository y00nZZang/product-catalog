export const $ = (id) => document.getElementById(id);

export const node = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text != null) e.textContent = String(text);
  if (cls) e.className = cls;
  return e;
};

export function links(container, urls) {
  container.replaceChildren();
  for (const [i, url] of [...new Set(urls || [])].entries()) {
    try {
      if (new URL(url).protocol !== "https:") continue;
    } catch {
      continue;
    }
    const a = node("a", `근거 ${i + 1} ↗`);
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    container.append(a);
  }
}
