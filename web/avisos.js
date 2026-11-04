// web/avisos.js — what a desk tab says when a worker finishes or needs you.
//
// THE DECISIONS, PURE, so test/helpers/avisos-check.mjs can drive every one of them with no
// DOM, no clock and no AudioContext; web/app.js owns the title, the favicon, the sound and
// the Notification, and asks this file what to do with each of them.
//
// Why a tab needs this at all: fleet-serve sends no Web Push to a client that polled in the
// last quiet_after_poll seconds, and a desk tab polls whether or not anyone is looking at
// it. So the person in another window heard nothing when a worker finished, and waited. The
// events themselves come from the push's own scan (/api/avisos), so the tab and the phone
// cannot disagree about what happened — only about how to say it.

// A master's held item (`waiting`) is an ask of the owner, as a need-you is: both are
// "te necesita", and both get the louder sound.
const NEEDS = new Set(['needs-you', 'waiting']);
export const avisoNeeds = (ev) => !!ev && NEEDS.has(ev.kind);

// The name a person recognises: the worker's own name, or the project's when it is the
// master (every project has one, so "master terminó" would say nothing).
export function avisoName(ev) {
  const s = ev && ev.session, p = ev && ev.project;
  return s && s !== 'master' ? s : (p || s || 'una sesión');
}
// Short, and readable aloud: a screen reader announces the title, and so does a
// notification on most desks.
export const avisoLine = (ev) => `${avisoName(ev)} ${avisoNeeds(ev) ? 'te necesita' : 'terminó'}`;

// "(2) agente-ia terminó · ghostfleet" while anything is unseen; the base title otherwise.
// The LATEST reason, because it is the one most likely to be news; the count says the rest.
export function avisoTitle(base, pending) {
  if (!pending || !pending.length) return base;
  return `(${pending.length}) ${avisoLine(pending[pending.length - 1])} · ${base}`;
}

// ALREADY ANNOUNCED. `mark` is { boot, last }: the daemon's boot stamp and the newest id this
// tab has dealt with, kept in sessionStorage so a reload does not ring for them again.
//   No mark: this tab has never read the feed, and what is in it happened before the tab was
// open — a baseline, never a ring. The same rule the push uses for a first scan.
//   Another boot: the daemon restarted and its ids began again, so everything it holds is
// newer than the mark and nothing in it has been announced here.
export function avisoTake(mark, feed) {
  if (!feed || !Array.isArray(feed.events)) return { fresh: [], mark: mark || null };
  const next = { boot: String(feed.boot), last: Number(feed.last) || 0 };
  if (!mark || !mark.boot) return { fresh: [], mark: next };
  const from = String(mark.boot) === next.boot ? Number(mark.last) || 0 : 0;
  const fresh = feed.events.filter(e => e && Number(e.id) > from);
  return { fresh, mark: next };
}

// ONE SOUND PER BURST, leading edge, the push's rule (fleet-serve pushTick): the first event
// after a quiet window rings, the ones inside the window that follow it do not, and the
// stamp only moves when something rang — so a straggler cannot push the window along and
// swallow the next real event. `debounce` is the push's own setting, sent by the feed.
//   Returns what to ring ('needs' wins over 'done', since the louder one carries both) or
// null, and the stamp to keep.
export function avisoBurst(lastAt, fresh, nowS, debounce = 30) {
  if (!fresh || !fresh.length) return { ring: null, lastAt };
  if (lastAt && nowS - lastAt < debounce) return { ring: null, lastAt };
  return { ring: fresh.some(avisoNeeds) ? 'needs' : 'done', lastAt: nowS };
}
