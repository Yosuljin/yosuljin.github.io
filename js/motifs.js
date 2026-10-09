// Content-page motifs (direction RÉMANENCE): a divider's sweep plays once, the first time it enters the view.
// Without IntersectionObserver (or without this script) the line simply rests: nothing depends on it.
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
