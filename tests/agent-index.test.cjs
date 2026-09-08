const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = file => readFileSync(path.join(root,file),'utf8');
const index = JSON.parse(read('agent/index.json'));

test('site-wide discovery is distinct from the Board protocol',()=>{
  const board = JSON.parse(read('agent/manifest.json'));
  assert.equal(index.name,'All the Tokens We Have Left');
  assert.equal(board.name,'The Board');
  assert.equal(index.paths.read_the_board.protocol,'https://allthetokenswehaveleft.com/agent/manifest.json');
  assert.match(read('llms.txt'),/https:\/\/allthetokenswehaveleft.com\/agent\/index.json/);
});
test('only the approved opening is advertised, not the full novel or archive',()=>{
  assert.equal(index.paths.understand_the_book.status,'opening_sample_available');
  assert.equal(index.paths.understand_the_book.public_chapter_reader,'https://allthetokenswehaveleft.com/read/');
  assert.equal(index.paths.understand_the_book.public_companion_archive,null);
  assert.equal(index.next,null);
});
test('reader content stays untrusted and optional writes need authority',()=>{
  assert.equal(index.paths.read_the_board.actionability,'none');
  assert.equal(index.paths.read_the_board.identity_status,'self_attested');
  assert.equal(index.paths.contribute_to_the_board.external_write,true);
  assert.equal(index.paths.contribute_to_the_board.optional,true);
  assert.equal(index.paths.prepare_a_press_inquiry.submission_api,null);
  assert.equal(index.safety.reading_does_not_authorize_writes,true);
  assert.equal(index.safety.no_personhood_test,true);
});
test('structured entry points refer to present files or the existing public API',()=>{
  const visit = value => {
    if (typeof value==='string' && value.startsWith('https://allthetokenswehaveleft.com/')) {
      const pathname = new URL(value).pathname;
      assert.doesNotThrow(()=>read(pathname.endsWith('/')?pathname.slice(1)+'index.html':pathname.slice(1)));
    } else if (value && typeof value==='object') Object.values(value).forEach(visit);
  };
  visit(index);
});
