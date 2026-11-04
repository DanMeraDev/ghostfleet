#!/usr/bin/env node
// test/helpers/avisos-check.mjs — a desk tab's avisos, driven as a table.
//
//     HOME=<scratch> node avisos-check.mjs      # one `name \x1f want \x1f got` row per check
//
// Two halves of one contract. bin/fleet-serve.mjs keeps the push's own events in a ring the
// tab reads (feedAppend/feedSince); web/avisos.js decides, from what the tab read, what the
// title says, whether this is news, and whether it rings. Every rule has a row on its other
// side: a title that never cleared, a mark that announced nothing, or a burst rule that rang
// for everything would each pass half of these and fail the rest.
const US = '\x1f';
const rows = [];
const is = (name, want, got) => rows.push(name + US + JSON.stringify(want) + US + JSON.stringify(got));

const { avisoLine, avisoTitle, avisoTake, avisoBurst, avisoNeeds } =
  await import(new URL('../../web/avisos.js', import.meta.url).href);
const { feedAppend, feedSince, FEED_KEEP } =
  await import(new URL('../../bin/fleet-serve.mjs', import.meta.url).href);

const done = { id: 1, kind: 'answer', project: 'acme-api', session: 'api-fix' };
const need = { id: 2, kind: 'needs-you', project: 'acme-api', session: 'docs-pass' };
const held = { id: 3, kind: 'waiting', project: 'acme-web', session: 'master' };

// ── the words ─────────────────────────────────────────────────────────────
is('a finished worker: "<session> terminó"', 'api-fix terminó', avisoLine(done));
is('a blocked worker: "<session> te necesita"', 'docs-pass te necesita', avisoLine(need));
is('a master is named by its project, not "master"', 'acme-web te necesita', avisoLine(held));
is('a master\'s held item is a need, like a need-you', true, avisoNeeds(held));
is('...and a finish is not', false, avisoNeeds(done));

// ── the title ─────────────────────────────────────────────────────────────
is('nothing unseen: the title is the plain one', 'ghostfleet', avisoTitle('ghostfleet', []));
is('one unseen: count and reason', '(1) api-fix terminó · ghostfleet', avisoTitle('ghostfleet', [done]));
is('two unseen: the count, and the LATEST reason', '(2) docs-pass te necesita · ghostfleet', avisoTitle('ghostfleet', [done, need]));
is('...not the first one', false, avisoTitle('ghostfleet', [done, need]).includes('api-fix'));

// ── already announced ─────────────────────────────────────────────────────
const feed = { boot: 'B1', last: 3, events: [done, need, held] };
let t = avisoTake(null, feed);
is('a tab with no mark takes the feed as a baseline: nothing rings', 0, t.fresh.length);
is('...and marks up to the newest id', { boot: 'B1', last: 3 }, t.mark);
t = avisoTake({ boot: 'B1', last: 1 }, feed);
is('a mark at 1 announces 2 and 3', [2, 3], t.fresh.map(e => e.id));
t = avisoTake({ boot: 'B1', last: 3 }, feed);
is('a mark at 3 (a reload after both) announces nothing again', 0, t.fresh.length);
t = avisoTake({ boot: 'B0', last: 40 }, feed);
is('another boot: the ids began again, so everything held is new', [1, 2, 3], t.fresh.map(e => e.id));
is('...and the mark moves to the new boot', { boot: 'B1', last: 3 }, t.mark);
t = avisoTake({ boot: 'B1', last: 1 }, null);
is('no feed (fixtures, old daemon): nothing, and the mark is kept', { fresh: [], mark: { boot: 'B1', last: 1 } }, t);

// ── one sound per burst ───────────────────────────────────────────────────
let b = avisoBurst(0, [done], 1000, 30);
is('the first event after quiet rings', 'done', b.ring);
is('...and stamps the burst', 1000, b.lastAt);
b = avisoBurst(1000, [need], 1010, 30);
is('a straggler 10s into the window does not ring', null, b.ring);
is('...and does not move the stamp', 1000, b.lastAt);
b = avisoBurst(1000, [need], 1030, 30);
is('at the window\'s edge the next event rings again', 'needs', b.ring);
b = avisoBurst(0, [done, need, done], 2000, 30);
is('one burst holding a need rings the louder sound, once', 'needs', b.ring);
b = avisoBurst(0, [done, done], 2000, 30);
is('...and a burst of finishes rings the soft one', 'done', b.ring);
b = avisoBurst(1000, [], 5000, 30);
is('nothing new: no ring, stamp kept', { ring: null, lastAt: 1000 }, b);

// ── the daemon's ring ─────────────────────────────────────────────────────
const f = { boot: 'B1', last: 0, ring: [] };
feedAppend(f, [
  { kind: 'answer', project: 'acme-api', session: 'api-fix', sock: 'cf-acme-api' },
  { kind: 'needs-you', project: 'acme-api', session: 'master', sock: 'cf-acme-api', undelivered: true },
  { kind: 'account', project: '', session: '', account: { event: 'switched' } },
  { kind: 'answer', project: 'acme-api', session: 'bad;name$(x)', sock: 'cf-acme-api' },
]);
is('a finish and a need-you (an undelivered wake too) enter the ring', ['answer', 'needs-you'], f.ring.map(e => e.kind));
is('...an account notice and a name that is not a name do not', 2, f.last);
is('each row carries only what a lock screen may: id, at, kind, two names',
   ['at', 'id', 'kind', 'project', 'session'], Object.keys(f.ring[1]).sort());
is('feedSince(after=1) gives only what came after', [2], feedSince(f, '1', 'B1').events.map(e => e.id));
is('feedSince(after=2) gives nothing', 0, feedSince(f, '2', 'B1').events.length);
is('a tab holding another boot\'s mark gets the whole ring', [1, 2], feedSince(f, '40', 'B0').events.map(e => e.id));
for (let i = 0; i < FEED_KEEP + 10; i++) feedAppend(f, [{ kind: 'answer', project: 'acme-api', session: 'api-fix', sock: 'x' }]);
is('the ring is bounded', FEED_KEEP, f.ring.length);
is('...dropping the oldest, never renumbering', f.last, f.ring[f.ring.length - 1].id);

console.log(rows.join('\n'));
