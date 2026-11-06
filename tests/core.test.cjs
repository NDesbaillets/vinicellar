// Tests ciblés sans dépendance ni accès réseau : node --test tests/*.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('assets/js/core.js', 'utf8');

function setup({ role = 'owner', storedTheme = null } = {}) {
  let now = 0;
  const requests = [], handlers = {};
  const sb = {
    storage: { from: (bucket) => ({ createSignedUrls: async (paths) => {
      requests.push({ bucket, paths });
      return { data: paths.map(path => ({ path, signedUrl: `https://example.test/${bucket}/${path}?v=${requests.length}` })) };
    } }) },
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u' } } } }) },
    from: (table) => ({ select() { return this; }, eq() { return this; },
      single: async () => ({ data: { onboarded_at: '2026-01-01' } }),
      then(resolve) { return Promise.resolve({ data: table === 'collection_members' ? [{ collection_id: 'c', role }] : [], count: 0 }).then(resolve); }
    })
  };
  const document = {
    documentElement: { dataset: {}, classList: { add() {} } },
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (type, fn) => { handlers[type] = fn; }
  };
  const window = { VC_CONFIG: { supabaseUrl: 'https://example.test' }, supabase: { createClient: () => sb }, addEventListener() {}, matchMedia: () => ({ matches: false }) };
  const localStorage = { getItem: () => storedTheme, setItem() {} };
  const context = { window, document, navigator: { userAgent: '' }, location: { hash: '', pathname: '/app/', protocol: 'https:', hostname: 'example.test' }, localStorage, matchMedia: window.matchMedia, Date: class extends Date { static now() { return now; } }, URL, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto };
  vm.runInNewContext(source, context);
  return { VC: window.VC, document, handlers, requests, advance: ms => { now += ms; } };
}

test('images signées : déduplication, expiration et séparation des buckets', async () => {
  const { VC, requests, advance } = setup();
  let get = await VC.signed(['a.jpg', 'a.jpg', null]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].paths.length, 1);
  assert.equal(get('a.jpg'), 'https://example.test/labels/a.jpg?v=1');
  await VC.signed(['a.jpg']);
  assert.equal(requests.length, 1);
  const other = await VC.signed(['a.jpg'], 'another-private-bucket');
  assert.equal(requests.length, 2);
  assert.match(other('a.jpg'), /another-private-bucket/);
  advance(56 * 60 * 1000);
  assert.equal(get('a.jpg'), null);
  get = await VC.signed(['a.jpg']);
  assert.equal(requests.length, 3);
  assert.match(get('a.jpg'), /v=3$/);
});

test('le choix de couverture reste prioritaire et une étiquette reste identifiée comme telle', () => {
  const { VC } = setup();
  const item = { bottle_path: 'b.png', label_path: 'l.jpg', photo_paths: ['extra.jpg'] };
  assert.equal(VC.imageInfo(item).kind, 'bottle');
  assert.equal(VC.imageInfo({ ...item, cover_path: 'l.jpg' }).kind, 'label');
  assert.equal(VC.mainImagePath({ ...item, cover_path: 'extra.jpg' }), 'extra.jpg');
  assert.equal(VC.imageInfo({ photo_paths: ['extra.jpg'] }).kind, 'photo');
  assert.equal(VC.mainImagePath({}), null);
});

test('les données de fiche sont échappées dans le rendu et la source reste inchangée', () => {
  const { VC } = setup();
  const item = { label_path: 'source.jpg' }, before = JSON.stringify(item);
  const html = VC.itemVisual(item, () => 'https://example.test/" onerror="alert(1)');
  assert.ok(html.includes('&quot;'));
  assert.equal(JSON.stringify(item), before);
});

test('owner et member conservent l’édition ; viewer et collection inconnue restent en lecture seule', async () => {
  for (const role of ['owner', 'member', 'viewer']) {
    const { VC } = setup({ role });
    await VC.boot('cellar');
    assert.equal(VC.canEdit('c'), role !== 'viewer');
    assert.equal(VC.canEdit('other'), false);
  }
});

test('préférence de thème valide appliquée ; valeur inconnue ramenée au système', () => {
  assert.equal(setup({ storedTheme: 'dark' }).document.documentElement.dataset.theme, 'dark');
  assert.equal(setup({ storedTheme: 'light' }).document.documentElement.dataset.theme, 'light');
  assert.equal(setup({ storedTheme: 'invalid' }).document.documentElement.dataset.theme, undefined);
});

test('Studio : URL candidates et approuvées isolées, courtes et renouvelées',async()=>{
 const {VC,requests,advance}=setup();
 const refs=['studio-approved:a.png','studio-candidates:a.png','original.jpg'];
 const get=await VC.signed(refs);
 assert.equal(requests.length,3);assert.match(get(refs[0]),/studio-approved/);assert.match(get(refs[1]),/studio-candidates/);
 advance(271000);assert.equal(get(refs[0]),null);assert.equal(get(refs[1]),null);assert.ok(get(refs[2]));
 await VC.signed(refs);assert.equal(requests.length,5);
});
