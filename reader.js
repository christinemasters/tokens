(function () {
  'use strict';
  var root = document.querySelector('.reader-main');
  if (!root || !window.ReaderCore) return;
  var core = window.ReaderCore;
  var data = JSON.parse(document.getElementById('reader-data').textContent);
  var article = root.querySelector('.chapter-text');
  var blocks = Array.from(article.children);
  var toolbar = document.querySelector('.reader-toolbar');
  var status = document.getElementById('reader-status');
  var prefsKey = 'attwhl.preview.reader.preferences';
  var bookmarkKey = 'attwhl.preview.reader.bookmark.' + root.dataset.chapter;
  var toastTimer, saveTimer, selectionTimer;
  var isRestoring = true, interacted = false, activeNote = null, noteCloseTimer, suppressNoteFocus = false, dismissedNote=null, visiblePlace=null;
  function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; } }
  function write(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); return true; } catch (_) { return false; } }
  function say(message) { clearTimeout(toastTimer); status.textContent = message; status.classList.add('visible'); toastTimer = setTimeout(function () { status.classList.remove('visible'); },6000); }
  var prefs = core.preferences(read(prefsKey));
  var bookmark = core.validBookmark(read(bookmarkKey),root.dataset.version,blocks.length);
  var bookmarkButton = document.getElementById('auto-bookmark');
  var themeButton = document.getElementById('toggle-theme');
  var fullscreenButton = document.getElementById('toggle-fullscreen');
  var shareButton = document.getElementById('share-story');
  var resume = document.getElementById('resume-place');
  [bookmarkButton,themeButton,fullscreenButton,shareButton].forEach(function (button) { button.hidden=false; });
  function label(button,text) { button.setAttribute('aria-label',text); button.title=text; }
  function boundary() { return toolbar.getBoundingClientRect().bottom + 24; }
  function measurePlace() {
    var edge=boundary(), index=blocks.findIndex(function (block) { return block.getBoundingClientRect().bottom>edge; });
    if (index<0) index=blocks.length-1;
    var rect=blocks[index].getBoundingClientRect();
    return {version:root.dataset.version,block:index,offset:Math.max(0,Math.min(1,(edge-rect.top)/Math.max(1,rect.height)))};
  }
  function goToPlace(place) {
    var rect=blocks[place.block].getBoundingClientRect();
    window.scrollTo({top:window.scrollY+rect.top+place.offset*rect.height-boundary(),behavior:'instant'});
  }
  function preservePlace(place) {
    if (!place) return;
    isRestoring=true; clearTimeout(saveTimer);
    requestAnimationFrame(function () {
      goToPlace(place);
      requestAnimationFrame(function () { visiblePlace=measurePlace(); isRestoring=false; updateProgress(); });
    });
  }
  function apply(keepPosition) {
    var place=keepPosition!==false && !isRestoring && article.getBoundingClientRect().top<boundary() ? measurePlace() : null;
    document.body.dataset.theme = prefs.theme;
    document.body.dataset.type = prefs.type;
    document.body.dataset.sources = prefs.sources ? 'on' : 'off';
    document.body.dataset.artifacts = prefs.artifacts ? 'on' : 'off';
    document.body.style.setProperty('--reader-size',prefs.size+'px');
    ['size','theme','type'].forEach(function (key) { document.getElementById('reader-'+key).value = prefs[key]; });
    ['sources','artifacts'].forEach(function (key) { document.getElementById('reader-'+key).checked = prefs[key]; });
    bookmarkButton.setAttribute('aria-pressed',String(prefs.autoBookmark));
    label(bookmarkButton,'Automatic bookmark: '+(prefs.autoBookmark ? 'on' : 'off'));
    themeButton.setAttribute('aria-pressed',String(prefs.theme==='night'));
    label(themeButton,prefs.theme==='night' ? 'Turn off dark mode' : 'Turn on dark mode');
    if (!prefs.sources) closeNote(false);
    requestAnimationFrame(updateProgress);
    preservePlace(place);
  }
  function rememberPrefs() { if (!write(prefsKey,prefs)) say('Settings work for this page, but browser storage is unavailable.'); }
  ['size','theme','type','sources','artifacts'].forEach(function (key) {
    document.getElementById('reader-'+key).addEventListener('change',function (event) {
      prefs[key] = event.target.type==='checkbox' ? event.target.checked : event.target.value;
      prefs = core.preferences(prefs); apply(); rememberPrefs();
    });
  });
  themeButton.addEventListener('click',function () {
    if (prefs.theme==='night') prefs.theme=prefs.lastLight;
    else { prefs.lastLight=prefs.theme; prefs.theme='night'; }
    apply(false); rememberPrefs();
  });

  // Static editorial styling. No fabricated senders, timestamps, or live logs.
  var kindLabels = {state:'Run state',task:'Assigned task',note:'Saved note',directory:'Shared directory',board:'The Board',message:'Message'};
  var artifactIndex=0;
  blocks.forEach(function (block,index) {
    block.id='passage-'+(index+1);
    if (block.matches('pre')) {
      var kind=data.kinds[artifactIndex++];
      block.dataset.kind=kind; block.dataset.label=kindLabels[kind];
      block.setAttribute('aria-label',kindLabels[kind]+' in the novel');
    }
    if (root.dataset.chapter==='prelude' && block.matches('blockquote')) {
      block.classList.add('story-artifact'); block.dataset.kind='board'; block.dataset.label='A note in the library';
    }
    if (data.thoughtBlocks.includes(index)) { block.classList.add('private-thought'); block.dataset.label='Private thought'; }
    if (/^\* \* \*$/.test(block.textContent) || block.matches('p') && block.innerHTML==='<em> </em> *') { block.classList.add('reader-scene-break'); block.setAttribute('role','separator'); block.setAttribute('aria-label','Scene break'); }
  });

  var popover=document.getElementById('source-popover');
  function closeNote(returnFocus) {
    clearTimeout(noteCloseTimer);
    if (!activeNote) return;
    var previous=activeNote; activeNote=null; dismissedNote=previous; popover.hidden=true;
    previous.setAttribute('aria-expanded','false');
    if (returnFocus) { suppressNoteFocus=true; previous.focus({preventScroll:true}); suppressNoteFocus=false; }
  }
  function positionNote() {
    if (!activeNote) return;
    var rect=activeNote.getBoundingClientRect(), width=popover.offsetWidth, height=popover.offsetHeight;
    var top=rect.bottom+12;
    if (top+height>window.innerHeight-12) top=Math.max(toolbar.offsetHeight+12,rect.top-height-12);
    if (window.innerWidth<=620) top=Math.max(toolbar.offsetHeight+12,window.innerHeight-height-14);
    popover.style.left=Math.max(12,Math.min(document.documentElement.clientWidth-width-12,rect.left-width/2))+'px';
    popover.style.top=top+'px';
  }
  function openNote(marker,note,focus) {
    clearTimeout(noteCloseTimer);
    if (activeNote && activeNote!==marker) closeNote(false);
    activeNote=marker; marker.setAttribute('aria-expanded','true');
    document.getElementById('source-title').textContent=note.title;
    document.getElementById('source-class').textContent=note.classification;
    var context=document.getElementById('source-context'); context.textContent=note.context; context.hidden=!note.context;
    document.getElementById('source-boundary').textContent=note.boundary;
    var link=document.getElementById('source-link'); link.hidden=!note.source;
    if (note.source) { link.textContent=note.source.title+' ↗'; link.href=note.source.url; } else link.removeAttribute('href');
    document.getElementById('source-locator').textContent=note.source ? note.locator+' · '+note.source.date : 'Author’s worldbuilding note';
    popover.hidden=false; positionNote();
    if (focus) document.getElementById('close-source').focus({preventScroll:true});
  }
  function scheduleNoteClose() {
    clearTimeout(noteCloseTimer);
    noteCloseTimer=setTimeout(function () {
      if (!activeNote || popover.contains(document.activeElement) || document.activeElement===activeNote || popover.matches(':hover') || activeNote.matches(':hover')) return;
      closeNote(false);
    },250);
  }
  // Highest offset first so multiple markers cannot invalidate the remaining offsets.
  data.notes.slice().sort(function (a,b) { return b.block-a.block || b.end-a.end; }).forEach(function (note) {
    var block=blocks[note.block], walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT), node, count=0;
    while ((node=walker.nextNode())) {
      if (count+node.length >= note.end) {
        var marker=document.createElement('button');
        marker.className='source-marker'; marker.type='button'; marker.dataset.readerUi='true'; marker.dataset.note=note.id;
        marker.setAttribute('aria-label','Source note: '+note.title); marker.setAttribute('aria-controls','source-popover'); marker.setAttribute('aria-expanded','false'); marker.textContent='i';
        var range=document.createRange(); range.setStart(node,note.end-count); range.collapse(true); range.insertNode(marker);
        marker.addEventListener('pointerenter',function (event) { if (event.pointerType==='mouse' && marker!==dismissedNote) openNote(marker,note,false); });
        marker.addEventListener('pointerleave',function () { if (dismissedNote===marker) dismissedNote=null; scheduleNoteClose(); });
        marker.addEventListener('focus',function () { if (!suppressNoteFocus && marker!==dismissedNote) openNote(marker,note,false); });
        marker.addEventListener('blur',function () { if (dismissedNote===marker) dismissedNote=null; scheduleNoteClose(); });
        marker.addEventListener('click',function () { dismissedNote=null; openNote(marker,note,true); });
        break;
      }
      count+=node.length;
    }
  });
  popover.addEventListener('pointerenter',function () { clearTimeout(noteCloseTimer); });
  popover.addEventListener('pointerleave',scheduleNoteClose);
  popover.addEventListener('focusout',scheduleNoteClose);
  document.getElementById('close-source').addEventListener('click',function () { closeNote(true); });

  function updateProgress() {
    var rect=article.getBoundingClientRect();
    var percent=core.progress(rect.top,rect.height,boundary(),window.innerHeight);
    document.getElementById('chapter-progress').value=percent;
    document.getElementById('chapter-progress').textContent=percent+'%';
    document.getElementById('chapter-progress').setAttribute('aria-valuenow',String(percent));
    document.getElementById('chapter-percent').textContent=percent+'%';
  }
  function showBookmark() { resume.hidden=!bookmark; if (bookmark) { resume.href='#passage-'+(bookmark.block+1); resume.textContent='Return to saved place'; } }
  var storageWarned=false;
  function savePlace() {
    if (!prefs.autoBookmark || isRestoring || document.visibilityState==='hidden' && !interacted) return false;
    var next=measurePlace();
    if (write(bookmarkKey,next)) { bookmark=next; showBookmark(); return true; }
    if (!storageWarned) { storageWarned=true; say('Your browser cannot save reading progress. You can still read and change the settings.'); }
    return false;
  }
  bookmarkButton.addEventListener('click',function () {
    prefs.autoBookmark=!prefs.autoBookmark; clearTimeout(saveTimer); apply(false); rememberPrefs();
    if (prefs.autoBookmark) { if (savePlace()) say('Automatic bookmark on. Your place stays in this browser.'); }
    else say('Automatic bookmark off. Your last saved place is kept.');
  });
  function restorePlace() {
    if (bookmark && prefs.autoBookmark && !location.hash && !interacted) {
      goToPlace(bookmark);
      say('Resumed your saved place.');
    }
    requestAnimationFrame(function () { isRestoring=false; visiblePlace=measurePlace(); updateProgress(); });
  }
  ['wheel','touchstart','pointerdown','keydown'].forEach(function (name) { document.addEventListener(name,function () { interacted=true; },{passive:true,once:true}); });
  var scrollFrame=0;
  window.addEventListener('scroll',function () {
    if (!scrollFrame) scrollFrame=requestAnimationFrame(function () { scrollFrame=0; updateProgress(); if (!isRestoring) visiblePlace=measurePlace(); if (activeNote) closeNote(false); });
    if (!isRestoring) { clearTimeout(saveTimer); saveTimer=setTimeout(savePlace,600); }
  },{passive:true});
  window.addEventListener('resize',function () { if (article.getBoundingClientRect().top<boundary()) preservePlace(visiblePlace); updateProgress(); positionNote(); });
  window.addEventListener('pagehide',function () { clearTimeout(saveTimer); if (interacted) savePlace(); });
  document.addEventListener('visibilitychange',function () { if (document.visibilityState==='hidden' && interacted) savePlace(); });
  window.addEventListener('pageshow',function (event) { if (event.persisted) { isRestoring=false; updateProgress(); } });

  var focusView=false;
  function syncFullscreen() {
    var full=Boolean(document.fullscreenElement), on=full||focusView;
    document.body.classList.toggle('reader-focus',on);
    fullscreenButton.setAttribute('aria-pressed',String(on));
    label(fullscreenButton,on ? 'Exit '+(full?'fullscreen':'focus view') : 'Enter fullscreen');
    requestAnimationFrame(updateProgress);
  }
  fullscreenButton.addEventListener('click',async function () {
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) { say('Use Escape to leave fullscreen.'); } return; }
    if (focusView) { focusView=false; syncFullscreen(); return; }
    if (document.documentElement.requestFullscreen && document.fullscreenEnabled) { try { await document.documentElement.requestFullscreen(); syncFullscreen(); return; } catch (_) { /* Focus fallback for embedded browsers. */ } }
    focusView=true; syncFullscreen(); say('Focus view on. Browser fullscreen is unavailable here. Press Escape to leave.');
  });
  document.addEventListener('fullscreenchange',syncFullscreen);

  var shareDialog=document.getElementById('share-dialog'), selectedQuote='', currentDraft=null, shareOpener=null;
  var selectionTools=document.getElementById('selection-tools'), draftField=document.getElementById('share-draft');
  function openShare(quote,opener) {
    closeNote(false); selectionTools.hidden=true; shareOpener=opener;
    currentDraft=core.quoteDraft(quote);
    document.getElementById('share-title').textContent=quote ? 'Keep the line. Pass it on.' : 'A reader on the other side.';
    document.getElementById('share-explanation').textContent=data.publicRelease ? (quote ? 'Check the exact quote below before sharing. The link goes to the public book site.' : 'Share the story with another reader. Nothing is posted automatically.') : (quote ? 'This is password-protected text. Check the exact quote below and share only if you want it public. The link goes to the public book site.' : 'This chapter is private. Share the public book site.');
    draftField.value=currentDraft.display;
    document.getElementById('share-length').textContent=currentDraft.canOpenX ? 'Ready for a short X post. You review it before publishing.' : 'This selection is too long for a short X post. Copy it, or select a shorter passage. Nothing has been shortened.';
    document.getElementById('share-status').textContent='';
    var x=document.getElementById('open-x'); x.hidden=!currentDraft.canOpenX;
    if (currentDraft.canOpenX) x.href=currentDraft.intent; else x.removeAttribute('href');
    document.getElementById('native-share').hidden=!navigator.share;
    shareDialog.showModal();
  }
  function closeShare() { shareDialog.close(); if (shareOpener && !shareOpener.hidden) shareOpener.focus({preventScroll:true}); }
  shareButton.addEventListener('click',function () { openShare('',shareButton); });
  document.getElementById('close-share').addEventListener('click',closeShare);
  shareDialog.addEventListener('click',function (event) { if (event.target===shareDialog) { var r=shareDialog.getBoundingClientRect(); if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) closeShare(); } });
  document.getElementById('copy-share').addEventListener('click',async function () {
    try { await navigator.clipboard.writeText(currentDraft.display); document.getElementById('share-status').textContent='Copied. Nothing has been posted.'; }
    catch (_) { draftField.focus(); draftField.select(); document.getElementById('share-status').textContent='Use Copy on the selected draft. Clipboard access is unavailable.'; }
  });
  document.getElementById('native-share').addEventListener('click',async function () {
    try { await navigator.share({title:'All the Tokens We Have Left',text:currentDraft.text,url:currentDraft.url}); }
    catch (error) { if (error.name!=='AbortError') document.getElementById('share-status').textContent='Sharing is unavailable here. Use Copy instead.'; }
  });
  function captureSelection() {
    if (shareDialog.open || selectionTools.contains(document.activeElement)) return;
    var selection=window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount || !article.contains(selection.anchorNode) || !article.contains(selection.focusNode)) { selectionTools.hidden=true; selectedQuote=''; return; }
    var fragment=selection.getRangeAt(0).cloneContents();
    fragment.querySelectorAll('[data-reader-ui]').forEach(function (node) { node.remove(); });
    fragment.querySelectorAll('p,pre,blockquote,hr,br').forEach(function (node) { node.appendChild(document.createTextNode(' ')); });
    selectedQuote=fragment.textContent.replace(/\s+/g,' ').trim();
    if (!selectedQuote || selectedQuote.length>5000) { selectionTools.hidden=true; return; }
    selectionTools.hidden=false;
  }
  document.addEventListener('selectionchange',function () { clearTimeout(selectionTimer); selectionTimer=setTimeout(captureSelection,180); });
  selectionTools.addEventListener('pointerdown',function (event) { if (event.pointerType==='mouse') event.preventDefault(); });
  document.getElementById('share-selection').addEventListener('click',function () { openShare(selectedQuote,shareButton); });
  document.getElementById('copy-selection').addEventListener('click',async function () {
    try { await navigator.clipboard.writeText(core.quoteDraft(selectedQuote).display); say('Quote and book link copied. Nothing posted.'); }
    catch (_) { openShare(selectedQuote,shareButton); document.getElementById('share-status').textContent='Use Copy on the selected draft.'; draftField.focus(); draftField.select(); }
  });
  document.getElementById('dismiss-selection').addEventListener('click',function () { selectionTools.hidden=true; selectedQuote=''; });

  var menus=Array.from(document.querySelectorAll('.reader-controls,.chapter-menu'));
  menus.forEach(function (menu) { menu.addEventListener('toggle',function () { if (menu.open) menus.forEach(function (other) { if (other!==menu) other.open=false; }); }); });
  document.addEventListener('click',function (event) {
    menus.forEach(function (menu) { if (menu.open && !menu.contains(event.target)) menu.open=false; });
    if (activeNote && !popover.contains(event.target) && event.target!==activeNote) closeNote(false);
  });
  document.addEventListener('keydown',function (event) {
    if (event.key!=='Escape') return;
    if (activeNote) { closeNote(true); event.preventDefault(); return; }
    menus.forEach(function (menu) { if (menu.open) { menu.open=false; menu.querySelector('summary').focus(); } });
    selectionTools.hidden=true;
    if (focusView) { focusView=false; syncFullscreen(); }
  });
  apply(); showBookmark(); syncFullscreen();
  Promise.resolve(document.fonts ? document.fonts.ready : null).then(function () { requestAnimationFrame(function () { requestAnimationFrame(restorePlace); }); });
  // STORY INTERFACE START
  // This also runs inside authenticated chapter HTML. Gates never load this file.
  var storyStyle=document.createElement('link');
  storyStyle.rel='stylesheet'; storyStyle.href='/story-interface.css?v=8b1ae5ea8ba9';
  storyStyle.dataset.storyInterface='true'; document.head.appendChild(storyStyle);
  var storyScript=document.createElement('script');
  storyScript.src='/story-interface.js?v=04bef5be0170'; storyScript.id='story-interface-loader';
  document.head.appendChild(storyScript);
  // STORY INTERFACE END
  // No analytics, remote scripts, automatic X requests, or background network calls.
})();
