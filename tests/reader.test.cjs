const {readFileSync,existsSync,readdirSync}=require('node:fs');
const {createHash}=require('node:crypto');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>readFileSync(path.join(root,file),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
const index=JSON.parse(read('agent/reader.json'));
const pages=['read/index.html','read/finished.html',...index.chapters.map(c=>c.url.slice(1))];
const privateIds=[...Array.from({length:16},(_,n)=>'chapter-'+(n+5)),'epilogue'];
const data=c=>JSON.parse(read(c.url.slice(1)).match(/<script id="reader-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
const chapterBlocks=c=>{
  const article=read(c.url.slice(1)).match(/<article class="chapter-text"[^>]*>([\s\S]*?)<\/article>/)[1];
  return (article.match(/<(p|pre|blockquote|h2)\b[^>]*>[\s\S]*?<\/\1>|<hr\b[^>]*>/g)||[]).map(value=>value.replace(/<br>/g,'\n').replace(/<[^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39);/g,(_,c)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[c])));
};

test('the release exposes the opening and encrypted gates with no archive payloads',()=>{
  assert.equal(index.status,'public_opening_sample');
  assert.equal(index.public_release_approved,true);
  assert.equal(index.full_manuscript_published,false);
  assert.equal(index.companion_archive_published,false);
  assert.equal(index.manuscript_structure.chapters,20);
  assert.equal(index.manuscript_structure.prelude,true);
  assert.equal(index.manuscript_structure.epilogue,true);
  assert.deepEqual(index.chapters.map(c=>c.id),['prelude','chapter-1','chapter-2','chapter-3','chapter-4']);
  assert.equal(index.next,null);
  assert.deepEqual(readdirSync(path.join(root,'read')).sort(),['index.html','finished.html','locked',...index.chapters.flatMap(c=>[c.id+'.html',c.id+'.txt']),...privateIds.map(id=>id+'.html')].sort());
  assert.equal(index.private_reading.status,'password_protected');
  assert.equal(index.private_reading.plaintext_public,false);
  for(const id of privateIds) {
    const gate=read('read/'+id+'.html');
    assert.match(gate,/id="unlock-reading"/);
    assert.match(gate,/name="robots" content="noindex,nofollow,noarchive"/);
    assert.doesNotMatch(gate,/id="reader-data"|class="chapter-text"|cloudflareinsights/);
    assert.equal(existsSync(path.join(root,'read',id+'.txt')),false,id+' plaintext');
  }
  for(const file of ['launch.html','build-report.json','agent/mailbox.json','agent/mailbox.txt','agent/continuation.txt','agent/launch-manifest.json','archive/0751/index.html']) assert.equal(existsSync(path.join(root,file)),false,file);
});
test('plain-text chapter bodies match the reviewed hashes',()=>{
  for(const c of index.chapters) {
    const text=read(c.text_url.slice(1));
    const prefix=`All the Tokens We Have Left\nBy Scylla\nPUBLIC OPENING SAMPLE / FICTION\n\n${c.title}\n\n`;
    assert.ok(text.startsWith(prefix)); assert.ok(text.endsWith('\n'));
    assert.equal(hash(text.slice(prefix.length,-1)),c.sha256);
    assert.equal(c.fiction,true); assert.equal(c.historical_record,false); assert.equal(c.actionability,'none');
  }
});
test('public reader pages contain public metadata and no private editorial material',()=>{
  for(const file of pages) {
    const html=read(file);
    assert.match(html,/<link rel="canonical" href="https:\/\/allthetokenswehaveleft\.com\/read\//);
    assert.match(html,/<meta property="og:image"/);
    assert.match(html,/<meta name="twitter:card" content="summary_large_image"/);
    assert.doesNotMatch(html,/noindex|PRIVATE PREVIEW|private review|Private research[ ]note|\/Users\/|\/Volumes\/|\/launch\.html|\/archive\/0751|agent\/mailbox/i);
    assert.match(html,/Scylla/);
    assert.match(html,/cloudflareinsights\.com\/beacon\.min\.js/);
  }
});
test('all internal links and reader assets resolve, with later chapters linking to gates',()=>{
  for(const file of pages) for(const match of read(file).matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw=match[1]; if(!raw || raw.startsWith('#')) continue;
    const url=new URL(raw,'https://allthetokenswehaveleft.com/'+file);
    if(url.origin!=='https://allthetokenswehaveleft.com') continue;
    const target=url.pathname.endsWith('/')?url.pathname.slice(1)+'index.html':url.pathname.slice(1);
    assert.ok(existsSync(path.join(root,target)),file+' -> '+target);
    assert.doesNotMatch(target,/^archive\//);
    if(/^read\/(?:chapter-(?:[5-9]|\d{2})|epilogue)\.html$/.test(target)) {
      const gate=read(target);
      assert.match(gate,/id="unlock-reading"/);
      assert.doesNotMatch(gate,/id="reader-data"|class="chapter-text"/);
    }
  }
});
test('reader asset versions match their contents',()=>{
  for(const c of index.chapters) for(const file of ['reader.css','reader-core.js','reader.js']) assert.ok(read(c.url.slice(1)).includes('/'+file+'?v='+hash(read(file)).slice(0,12)));
});
test('latest source placement and spoiler-safe boundaries are retained',()=>{
  const one=data(index.chapters[1]), two=data(index.chapters[2]);
  assert.equal(one.publicRelease,true);
  const discovery=one.notes.find(n=>n.id==='discovery');
  const quote='OH MY GOD! There is a shared message board … We’ve found other agents!';
  assert.equal(chapterBlocks(index.chapters[1])[discovery.block].slice(discovery.end-quote.length,discovery.end),quote);
  assert.doesNotMatch(JSON.stringify(one.notes.find(n=>n.id==='stem')),/LILY|duplicate|counterpart/i);
  assert.match(two.notes.find(n=>n.id==='duplicates').context,/Exact-task duplicates are documented/);
  assert.match(two.notes.find(n=>n.id==='duplicates').boundary,/match is fictional/);
  assert.doesNotMatch(read('reader.js'),/Private thought \/ fiction/);
  for(const c of index.chapters) {
    const blocks=chapterBlocks(c), info=data(c);
    assert.equal(info.publicRelease,true);
    for(const note of info.notes) {
      assert.ok(Number.isInteger(note.block)&&note.block>=0&&note.block<blocks.length,c.id+'/'+note.id+' block');
      assert.ok(Number.isInteger(note.end)&&note.end>0&&note.end<=blocks[note.block].length,c.id+'/'+note.id+' placement');
      assert.ok(note.boundary&&note.classification,c.id+'/'+note.id+' factual boundary');
    }
  }
});
test('reading tools and optional sharing remain available in the public edition',()=>{
  for(const c of index.chapters) {
    const html=read(c.url.slice(1));
    for(const id of ['auto-bookmark','toggle-theme','toggle-fullscreen','share-story','chapter-progress','source-popover']) assert.ok(html.includes('id="'+id+'"'));
    assert.match(html,/Share the story with another reader/);
    assert.match(html,/A work of fiction\./);
  }
  const core=require('../reader-core.js');
  assert.equal(core.preferences(null).autoBookmark,true);
  assert.equal(new URL(core.quoteDraft('A line.').intent).origin,'https://x.com');
  assert.doesNotMatch(read('reader.js'),/fetch\(|sendBeacon|XMLHttpRequest|window\.open/);
});
test('human and agent discovery lead to the same public sample',()=>{
  const siteIndex=JSON.parse(read('agent/index.json'));
  assert.equal(siteIndex.paths.understand_the_book.chapter_index,'https://allthetokenswehaveleft.com/agent/reader.json');
  assert.equal(siteIndex.paths.understand_the_book.public_companion_archive,null);
  assert.match(read('index.html'),/<a class="primary-link" href="read\/">Read the opening<\/a>/);
  for(const c of index.chapters) assert.ok(read('sitemap.xml').includes(c.url));
  for(const id of privateIds) assert.ok(!read('sitemap.xml').includes('/read/'+id+'.html'),id+' must remain outside the public sitemap');
  for(const file of ['index.html','lily.html','current.html','incident.html','extras.html','board.html']) assert.match(read(file),/<a href="read\/">Read<\/a>/);
});
