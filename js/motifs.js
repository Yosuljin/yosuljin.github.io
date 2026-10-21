// Content-page motifs (direction RÉMANENCE): a divider's sweep plays once, the first time it enters the view.
// Without IntersectionObserver (or without this script) the line simply rests: nothing depends on it.
// Local QA only (loopback, as in world.js): ?qa=nowrite keeps the written titles at rest, ?qa=nofall the petal on
// its line (css/contenu.css, css/legal.css), so the bench can isolate each one's cost. Nothing in production.
try {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    for (const f of (new URLSearchParams(location.search).get("qa") || "").split(",")) {
      if (f.trim() === "nowrite" || f.trim() === "nofall") document.documentElement.classList.add("qa-" + f.trim());
    }
  }
} catch {}
const dividers = document.querySelectorAll(".divider:not(.plain)");
if (dividers.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-seen");
      io.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -15% 0px" });
  dividers.forEach(d => io.observe(d));
}
