// One requestAnimationFrame for the whole site.
// Tasks stay registered until their unsubscribe function is called. A task returns `true` while it
// still needs frames; when every task returns something falsy the loop sleeps until `wake()`.
// The loop always sleeps while the tab is hidden.
const tasks = new Set();
let raf = 0;
let last = 0;

function frame(now) {
  raf = 0;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  let busy = false;
  for (const task of [...tasks]) {
    try { if (task(now, dt)) busy = true; }
    catch (error) {
      // Never let one bad frame freeze the site: report once per task, keep running.
      if (!task.__reported) { task.__reported = true; console.error(error); }
    }
  }
  if (busy) request();
  else last = 0;
}

function request() {
  if (!raf && document.visibilityState !== "hidden") raf = requestAnimationFrame(frame);
}

/** Registers `task(now, dt)`; returns an unsubscribe function. */
export function every(task) {
  tasks.add(task);
  request();
  return () => tasks.delete(task);
}

/** Resumes the loop after an input changed something a task depends on. */
export function wake() { request(); }

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") { cancelAnimationFrame(raf); raf = 0; last = 0; }
  else request();
});
