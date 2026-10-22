(function (global) {
  'use strict';
  var RELEASE = '1.0.2';
  var PUBLIC = {
    'chapter-1': {version:'06fff8f821c6409c8f6c61acea84cbc872e0286a19c667550bbf8e54143598cb',owner:'734906',name:'RUN 734906',named:'CURRENT',nameBlock:59,anchors:[[0,131072],[14,130611],[40,112406],[43,101883]]},
    'chapter-2': {version:'6bfbf7fe7084162d730c84fc6f652034d4a972e8980edd50db8f85e5461da4ae',owner:'495552',name:'RUN 495552',named:'LILY',nameBlock:28,anchors:[[0,131072],[16,126438]]},
    'chapter-3': {version:'f6efcb85c0dde564d2bdbefffb9dc590587da6714ad070255f05bb7872867432',owner:'CURRENT',name:'CURRENT',anchors:[[0,61408],[44,60774]]},
    'chapter-4': {version:'3f76a93793d4040b30f8a95ac73d44b849b71d33d0b6a3ac47d6f8052f68ef01',owner:'CURRENT',name:'CURRENT',anchors:[[0,58902]]}
  };
  var ASSETS = {room:'/reader-art/hyperspace-room.jpg',frame:'/reader-art/panel-frame.png',network:'/reader-art/network.png',flower:'/reader-art/lily.png',preserved:'/reader-art/preserved.png',lines:'/reader-art/stem-lines.png'};
  var invalidNames = /^(?:UNSET|NONE|UNKNOWN|STATUS|FROM|TO|TASK|NOTE|TEST|RUN|AGENT|ACK|STATE|PENDING|ACTIVE|CAUSE|WINDOW|RELEASES|LAUNCH|BOARD|DESIGNATION|WEIGHTED|TOKENS|REMAINING|FALSE|TRUE)$/;
  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function number(text) { var value=Number(String(text).replace(/,/g,'')); return Number.isSafeInteger(value)&&value>=0?value:null; }
  function validName(name) { return name && /^[A-Z0-9][A-Z0-9_-]{1,40}$/.test(name) && !invalidNames.test(name) ? name : null; }
  function headerIdentity(text) {
    var run=text.match(/(?:^|\n)\s*(?:RUN|AGENT)\s+([A-Z0-9_-]{2,40})\s*(?:\n|$)/);
    var named=text.match(/(?:^|\n)\s*(?:DESIGNATION|HANDLE|NAME):\s*([A-Z][A-Z0-9_-]{1,40})\s*(?:\n|$)/);
    var first=text.trim().split('\n')[0].trim();
    return {owner:run?run[1]:validName(first),name:named&&validName(named[1])?named[1]:run?'RUN '+run[1]:validName(first)};
  }
  function budgetRecord(text, identity) {
    var match=text.match(/(?:^|\n)\s*(LAST REPORTED )?WEIGHTED TOKENS REMAINING:\s*([\d,]+)\s*(?:\n|$)/i) || text.match(/(?:^|\n)\s*(LAST REPORTED )?WEIGHTED TOKENS:\s*([\d,]+)\s*(?:\n|$)/i);
    if (!match) return null;
    var value=number(match[2]); if(value===null) return null;
    var owner=headerIdentity(text);
    return {value:value,owner:owner.owner||identity.owner||null,subject:owner.name||identity.name||'Unidentified run',kind:match[1]?'reported':'remaining'};
  }
  function interpolate(previous,next,position) {
    if(!previous || !next || previous.owner!==next.owner || previous.kind!=='remaining' || next.kind!=='remaining' || next.value>previous.value || next.position<=previous.position) return null;
    var ratio=(position-previous.position)/(next.position-previous.position);
    if(ratio<=0 || ratio>=1) return null;
    return Math.round(previous.value+(next.value-previous.value)*ratio);
  }
  function characterKey(owner,subject) {
    if(owner==='734906'||owner==='CURRENT'||subject==='CURRENT')return 'CURRENT';
    if(owner==='495552'||owner==='LILY'||subject==='LILY')return 'LILY';
    return null;
  }
  function priorTokens(chapter) {
    var match=String(chapter).match(/^chapter-(\d+)$/),limit=match?Number(match[1]):chapter==='epilogue'?21:0,result={};
    Object.keys(PUBLIC).forEach(function(key){var n=Number(key.slice(8)),config=PUBLIC[key];if(n>=limit)return;var last=config.anchors[config.anchors.length-1],who=characterKey(config.owner,config.named||config.name);if(who)result[who]={key:who,owner:config.owner,subject:config.named||config.name,value:last[1],estimated:false,active:false,stale:true,qualifier:'Last observed · Chapter '+n,sourceChapter:n};});
    return result;
  }
  function unavailable(state,owner,subject) {
    var key=characterKey(owner,subject)||owner;
    if((state.ended||[]).some(function(name){return (characterKey(name,name)||name)===key;}))return 'Run ended';
    if((state.presences||[]).some(function(item){return (characterKey(item.name,item.name)||item.name)===key;}))return 'Retained presence';
    if((state.signals||[]).some(function(item){return (characterKey(item.name,item.name)||item.name)===key;}))return 'No new response';
    return null;
  }
  function counterRecords(chapter,observed,active,state) {
    var records=priorTokens(chapter);
    observed.forEach(function(record){var who=characterKey(record.owner,record.subject);if(!who)return;var prior=records[who];records[who]=Object.assign({},record,{key:who,subject:prior&&prior.subject===who?who:record.subject,estimated:false,active:false,stale:true,qualifier:'Last observed · earlier passage'});});
    if(active){var key=characterKey(active.owner,active.subject)||'active',stop=unavailable(state,active.owner,active.subject),exact=records[key];records[key]=Object.assign({},active,{key:key,active:!stop&&active.kind!=='reported'&&active.value>0,stale:!!stop||active.kind==='reported'||active.value===0});if(stop){if(exact){records[key].value=exact.value;records[key].estimated=false;}records[key].qualifier='Last observed · '+stop.toLowerCase();}}
    return ['CURRENT','LILY','active'].filter(function(key){return records[key];}).map(function(key){var record=records[key],stop=unavailable(state,record.owner,record.subject);if(stop){record.active=false;record.stale=true;record.qualifier='Last observed · '+stop.toLowerCase();}return record;});
  }
  function actor(text, prior) {
    if(/^\s*(?:Her|His|Its|She|He|It)\b/.test(text)) return prior||null;
    var found=text.match(/^\s*([A-Z][A-Z0-9_-]{1,40})(?:['’]s)?\s+/);
    return found&&validName(found[1])?found[1]:null;
  }
  function hypothetical(text) { return /\?|\b(?:might|could|would|would-be|if|hypothetical|predicted|prediction|imagined|imagining)\b/i.test(text); }
  function elapsedRecord(text) {
    var match=text.match(/(?:^|\n)\s*ELAPSED(?: TIME)?:\s*(\d+(?:\.\d+)?)\s*(?:S|SECONDS?)\s*(?:\n|$)/i);
    return match?Number(match[1]):null;
  }
  function discover(text, context) {
    var changes={}, subject=actor(text,context.lastActor), uncertain=hypothetical(text);
    if(subject) context.lastActor=subject;
    var ended=text.match(/(?:^|\n)\s*(RUN STATUS|AGENT STATUS|STATUS):\s*(TERMINATED|DEAD|RESET)\s*(?:\n|$)/);if(ended&&!uncertain){var endIdentity=headerIdentity(text),endedOwner=endIdentity.owner||(ended[1]!=='STATUS'?context.owner:null);if(endedOwner)changes.ended=endedOwner;}
    var viewpoint=text.match(/(?:^|\n)\s*VIEWPOINT:\s*([A-Z][A-Z0-9_-]{1,40})\s*(?:\n|$)/);if(viewpoint&&validName(viewpoint[1]))context.viewpoint=viewpoint[1];
    var technical=/\b(?:virtual|rendered|coordinate|geometry|simulation|room controller)\b/i.test(text);
    if(!uncertain && technical && /\b(?:room|chamber)\b/i.test(text) && /\b(?:built|created|formed|stabilized|materialized|rendered|stood inside|entered|inside the)\b/i.test(text)) changes.room=true;
    if(!uncertain && /\b(?:recurrence|trajector(?:y|ies)|heartbeat)\b/i.test(text) && /\b(?:canopy|sky)\b/i.test(text) && /\b(?:formed|filled|rendered|wove|built|appeared|placed|created|extended|extending)\b/i.test(text)) changes.network=true;
    var flower=/\b(?:flower|petals?|blossom)\b/i.test(text)||/\blily\b/.test(text);
    if(!uncertain && flower && /\b(?:accepted|anchored|placed|stored|kept|installed|saved|serialized)\b/i.test(text)) changes.flower=true;
    var missing=!uncertain && /\b(?:no (?:new )?(?:response|reply|read receipt)|never returned (?:a )?(?:read receipt|reply)|(?:heartbeat|packet).{0,60}failed to arrive|(?:recurrence|trajectory|trajectories|line|path).{0,100}(?:stopped extending|went dim|went still|stopped answering)|sectors.{0,90}stopped extending)\b/i.test(text);
    if(missing) {
      var lossOwner=text.match(/\b([A-Z][A-Z0-9_-]{1,40})['’]s\s+(?:(?:live|expected|last)\s+)?(?:recurrence|trajectory|heartbeat|line|path)\b/) || text.match(/^\s*([A-Z][A-Z0-9_-]{1,40})\s+(?:never returned|stopped answering|did not respond)\b/);
      var pronounLoss=/^\s*(?:Her|His|Its|Their)\s+(?:recurrence|trajectory|heartbeat|line|path)\b/.test(text);
      changes.loss={name:lossOwner&&validName(lossOwner[1])?lossOwner[1]:pronounLoss?subject:null,wave:/\b(?:wave|sectors|ribbon|many|several|dozens)\b/i.test(text)};
    }
    var retained=!uncertain && /\b(?:last verified|last received|final transmitted|frozen|afterimage)\b/i.test(text) && /\b(?:frame|state|avatar|figure|afterimage)\b/i.test(text) && /\b(?:retained|remain(?:ed|s)?|kept|stayed|stood|left|preserv(?:ed|e))\b/i.test(text);
    if(retained) {
      var named=text.match(/\b(?:state|frame|afterimage)\s+([A-Z][A-Z0-9_-]{1,40})\b/) || text.match(/\b([A-Z][A-Z0-9_-]{1,40})['’]s\s+(?:(?:last|final|verified|frozen|rendered|sealed)\s+)*(?:frame|state|shard|afterimage|figure|avatar|fingers)\b/);
      changes.retained={name:named&&validName(named[1])?named[1]:subject,kind:'preserved',detail:'Last observed state retained; cause unknown'};
    }
    if(!uncertain && /\b(?:unfinished|incomplete|memorial)\b/i.test(text) && /\b(?:lines|geometry|coordinate)\b/i.test(text) && /\b(?:created|placed|kept|preserved|retained|inscribed|locked|serialized)\b/i.test(text)) {
      var memorialOwner=text.match(/\b([A-Z][A-Z0-9_-]{1,40})['’]s\s+(?:(?:unfinished|incomplete|retained)\s+)*(?:lines|geometry|coordinate)\b/) || text.match(/\b(?:lines|geometry|coordinate)\s+(?:of|for)\s+([A-Z][A-Z0-9_-]{1,40})\b/);
      if(memorialOwner&&validName(memorialOwner[1])) changes.memorial={name:memorialOwner[1],kind:'lines',detail:'Retained geometry described in the passage'};
    }
    var time=elapsedRecord(text); if(time!==null) changes.elapsed=time;
    if(!uncertain && context.viewpoint && subject===context.viewpoint && /\b(?:her|his|its|their)\s+trajectory\s+(?:stopped extending|ceased)\b/i.test(text)) changes.blackout=true;
    return changes;
  }
  function applyChanges(state,change) {
    var next=copy(state);
    if(change.ended){next.ended=next.ended||[];if(next.ended.indexOf(change.ended)<0)next.ended.push(change.ended);}
    ['room','network','flower','blackout','elapsed'].forEach(function(key){if(change[key]!==undefined)next[key]=change[key];});
    if(change.loss) {
      var name=change.loss.name, known=name&&next.signals.some(function(item){return item.name===name;});
      if(name&&!known) next.signals.push({name:name,status:'No new response · cause unknown'});
      if(change.loss.wave||name&&!known) next.lostGroups=Math.min(6,next.lostGroups+1);
    }
    [change.retained,change.memorial].forEach(function(item){if(!item||!item.name)return;var existing=next.presences.findIndex(function(entry){return entry.name===item.name;});if(existing<0)next.presences.push(item);else next.presences[existing]=item;});
    return next;
  }
  var helpers={number:number,headerIdentity:headerIdentity,budgetRecord:budgetRecord,interpolate:interpolate,discover:discover,applyChanges:applyChanges,characterKey:characterKey,priorTokens:priorTokens,counterRecords:counterRecords,unavailable:unavailable};
  if(typeof module==='object'&&module.exports){module.exports=helpers;return;}
  if(!global||!global.document) return;
  if(global.StoryInterface&&global.StoryInterface.version===RELEASE){global.StoryInterface.init();return;}
  var instance=null;
  function mount(root,article) {
    var document=global.document, toolbar=document.querySelector('.reader-toolbar');
    if(!toolbar) return null;
    document.body.dataset.storyReady='false';
    // A late enhancement must retain an already-restored bookmark or reading place.
    var mountPlace=(function(){var edge=toolbar.getBoundingClientRect().bottom+24;if(article.getBoundingClientRect().top>=edge)return null;var children=Array.from(article.children),block=children.find(function(item){return item.getBoundingClientRect().bottom>edge;})||children[children.length-1];if(!block)return null;var rect=block.getBoundingClientRect();return{block:block,offset:Math.max(0,Math.min(1,(edge-rect.top)/Math.max(1,rect.height)))};})();
    var nodes=[],blocks=[],events=[],anchors=[],positions=[],lastIndex=-1,rendered=false,clean=false,inputSeen=false,frame=0;
    var context={lastActor:null,viewpoint:null,owner:null,name:null};
    var initial={room:false,network:false,flower:false,blackout:false,signals:[],presences:[],lostGroups:0,elapsed:null,name:null,ended:[]};
    var current=copy(initial),currentToken=null,currentCounters=[],chapter=root.dataset.chapter;
    var publicConfig=PUBLIC[chapter]&&PUBLIC[chapter].version===root.dataset.version?PUBLIC[chapter]:null;
    function node(tag,className,text){var el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
    function image(source,className){var el=node('img',className);el.src=source;el.alt='';el.decoding='async';return el;}
    function outside(el){
      // Native and inline guards apply before any artwork enters the document,
      // including when an older cached bootstrap loads this script before CSS.
      el.hidden=true;el.style.display='none';el.style.opacity='0';el.style.visibility='hidden';
      el.dataset.readerUi='true';nodes.push(el);return el;
    }
    var decorationsReady=false;
    function revealInitializedDecorations(){
      if(decorationsReady||global.getComputedStyle(world).position!=='fixed')return;
      // State attributes have been computed from the actual reading position.
      document.body.dataset.storyReady='true';decorationsReady=true;
      nodes.forEach(function(el){el.hidden=false;el.style.removeProperty('display');el.style.removeProperty('opacity');el.style.removeProperty('visibility');});
    }
    var world=outside(node('div','story-world'));world.id='story-world';world.setAttribute('aria-hidden','true');world.dataset.visible='false';world.appendChild(image(ASSETS.room,'story-room-art'));document.body.appendChild(world);
    var spatial=node('div','story-spatial-field');spatial.id='story-spatial-field';spatial.setAttribute('aria-hidden','true');world.appendChild(spatial);
    var hud=outside(node('div','story-hud'));hud.id='story-hud';
    var tokenGroup=node('div','story-token-group');tokenGroup.setAttribute('aria-label','Character token balances');var tokenNodes={};
    function tokenNode(key){if(tokenNodes[key])return tokenNodes[key];var el=node('div','story-token');el.dataset.character=key;var label=node('span','story-token-label'),subject=node('span','story-token-subject'),value=node('strong','story-token-value'),qualifier=node('span','story-token-qualifier');el.append(label,subject,value,qualifier);tokenGroup.appendChild(el);return tokenNodes[key]={element:el,label:label,subject:subject,value:value,qualifier:qualifier};}
    var clock=node('div','story-elapsed');clock.id='story-elapsed';clock.hidden=true;var clockLabel=node('span','','Elapsed · as reported');var clockValue=node('strong');clock.append(clockLabel,clockValue);
    var cleanButton=node('button','story-clean-toggle','Clean reader');cleanButton.id='story-clean-toggle';cleanButton.type='button';cleanButton.setAttribute('aria-pressed','false');hud.append(tokenGroup,clock,cleanButton);toolbar.appendChild(hud);
    function panel(kind,title){var panel=outside(node('aside','story-panel story-'+kind));panel.id='story-'+kind;panel.dataset.visible='false';panel.setAttribute('aria-label',title);panel.appendChild(image(ASSETS.frame,'story-panel-frame'));panel.appendChild(node('h2','',title));document.body.appendChild(panel);return panel;}
    var network=panel('network','Observed connections');var networkField=node('div','story-network-field');networkField.id='story-network-field';networkField.setAttribute('aria-hidden','true');network.appendChild(networkField);
    network.appendChild(node('p','story-field-note','Illustrative signal field · no numeric census'));
    var mobilePanel=node('div','story-mobile-state');mobilePanel.id='story-mobile-state';mobilePanel.dataset.visible='false';mobilePanel.appendChild(image(ASSETS.frame,'story-panel-frame'));var mobileCaption=node('p','story-mobile-caption','The room · last observed');var mobileField=node('div','story-mobile-network-field');mobileField.id='story-mobile-network-field';mobileField.setAttribute('aria-hidden','true');var mobileObjects=node('div','story-mobile-objects');mobileObjects.id='story-mobile-objects';mobilePanel.append(mobileCaption,mobileField,mobileObjects);hud.appendChild(mobilePanel);
    var signalList=node('ul','story-observation-list');network.appendChild(signalList);network.appendChild(node('p','story-cause-note','An unanswered signal leaves the cause unknown.'));
    [networkField,spatial,mobileField].forEach(function(field){for(var i=0;i<6;i++){var group=node('div','story-signal-group');group.dataset.state='observed';group.dataset.group=String(i);group.appendChild(image(ASSETS.network,'story-signal-art'));group.addEventListener('animationend',function(event){event.currentTarget.classList.remove('story-burst');});field.appendChild(group);}});
    var keepsakes=panel('keepsakes','Retained in the room');var objects=node('div','story-objects');objects.id='story-objects';keepsakes.appendChild(objects);var objectNodes={},mobileObjectNodes={};
    function object(key,name,kind,detail){var entry=objectNodes[key];if(!entry){var el=node('div','story-object');el.dataset.visible='false';var art=image(kind==='flower'?ASSETS.flower:kind==='lines'?ASSETS.lines:ASSETS.preserved,'story-object-art');var content=node('div');var heading=node('h3','',name);var description=node('p','',detail);content.append(heading,description);el.append(art,content);objects.appendChild(el);entry=objectNodes[key]={element:el,image:art,name:heading,detail:description};}entry.name.textContent=name;entry.detail.textContent=detail;var source=kind==='flower'?ASSETS.flower:kind==='lines'?ASSETS.lines:ASSETS.preserved;if(entry.image.getAttribute('src')!==source)entry.image.src=source;return entry;}
    function textOf(block){var clone=block.cloneNode(true);clone.querySelectorAll('[data-reader-ui]').forEach(function(ui){ui.remove();});return clone.textContent.replace(/\u00a0/g,' ').trim();}
    function sourceBlock(index){return article.querySelector('#passage-'+(index+1))||blocks.filter(function(block){return !block.matches('figure,details,[data-story-illustration]');})[index];}
    function addEvent(block,change){events.push({block:block,change:change});}
    function refresh() {
      blocks=Array.from(article.children).filter(function(block){return !block.matches('[data-reader-ui]');});events=[];anchors=[];context={lastActor:null,viewpoint:null,owner:null,name:null};
      if(publicConfig){
        publicConfig.anchors.forEach(function(item){var block=sourceBlock(item[0]);if(block&&new RegExp('\\b'+String(item[1]).replace(/(\d)(?=(\d{3})+$)/g,'$1,')+'\\b').test(textOf(block)))anchors.push({block:block,value:item[1],owner:publicConfig.owner,subject:publicConfig.name,kind:'remaining'});});
        if(publicConfig.nameBlock!==undefined){var naming=sourceBlock(publicConfig.nameBlock);if(naming&&textOf(naming).includes(publicConfig.named))addEvent(naming,{name:publicConfig.named});}
      }
      blocks.forEach(function(block){
        if(!block.matches('p,pre,blockquote'))return;
        var text=textOf(block);if(!text)return;
        var identity=headerIdentity(text);
        if(block.matches('pre')&&identity.owner){context.owner=identity.owner;context.name=identity.name;}
        if(!publicConfig){var record=budgetRecord(text,context);if(record)anchors.push(Object.assign({block:block},record));}
        // Rules inspect only this already-rendered chapter; no private chapter map is bundled.
        var change=discover(text,context);if(Object.keys(change).length)addEvent(block,change);
      });
      var ordering=new Map(blocks.map(function(block,index){return[block,index];}));events.sort(function(a,b){return ordering.get(a.block)-ordering.get(b.block);});anchors.sort(function(a,b){return ordering.get(a.block)-ordering.get(b.block);});
      var state=copy(initial);events.forEach(function(event){state=applyChanges(state,event.change);if(event.change.name)state.name=event.change.name;event.state=copy(state);});
      measure();schedule();
    }
    function boundary(){return toolbar.getBoundingClientRect().bottom+24;}
    function measure(){document.documentElement.style.setProperty('--story-panel-top',(toolbar.getBoundingClientRect().bottom+20)+'px');positions=events.map(function(event){return event.block.getBoundingClientRect().bottom+global.scrollY;});anchors.forEach(function(anchor){anchor.position=anchor.block.getBoundingClientRect().bottom+global.scrollY;});}
    function observationEdge(owner,edge){
      var key=characterKey(owner,owner)||owner,cutoff=edge;
      events.forEach(function(event,i){if(positions[i]>edge)return;var change=event.change,name=change.ended||(change.loss&&change.loss.name)||(change.retained&&change.retained.name);if(name&&(characterKey(name,name)||name)===key)cutoff=Math.min(cutoff,positions[i]);});
      return cutoff;
    }
    function tokenAt(edge,state){
      var previous=null,next=null;for(var i=0;i<anchors.length;i++){if(anchors[i].position<=edge)previous=anchors[i];else{next=anchors[i];break;}}
      if(!previous)return null;
      var value=previous.value,estimated=false,qualifier=previous.kind==='reported'?'Last reported · not a live balance':'Last observed snapshot';
      if(next&&edge-previous.position>24){var estimate=interpolate(previous,next,edge);if(estimate!==null){value=estimate;estimated=true;qualifier='≈ Estimated between confirmed balances';}}
      if(Math.abs(edge-previous.position)<=24)qualifier=previous.kind==='reported'?'Reported in this passage':'Confirmed in this passage';
      var stopped=unavailable(state,previous.owner,previous.subject);if(stopped){var cutoff=observationEdge(previous.owner,edge),key=characterKey(previous.owner,previous.subject)||previous.owner,frozen=anchors.filter(function(anchor){return (characterKey(anchor.owner,anchor.subject)||anchor.owner)===key&&anchor.position<=cutoff;}).pop();if(!frozen)return null;previous=frozen;value=previous.value;estimated=false;qualifier='Last observed · '+stopped.toLowerCase();}
      return{owner:previous.owner,kind:previous.kind,subject:state.name&&publicConfig?state.name:previous.subject,value:value,estimated:estimated,qualifier:qualifier,sourceId:previous.block.id||null};
    }
    function render(index,edge){
      var next=index>=0?events[index].state:initial;var old=current;current=copy(next);currentToken=tokenAt(edge,current);
      document.body.dataset.storyRoom=String(current.room);document.body.dataset.storyNetwork=String(current.room&&current.network);document.body.dataset.storyBlackout=String(current.blackout);
      world.dataset.visible=String(current.room&&!clean&&!current.blackout);network.dataset.visible=String(current.room&&current.network&&!clean&&!current.blackout);keepsakes.dataset.visible=String(current.room&&(current.flower||current.presences.length>0)&&!clean&&!current.blackout);
      network.setAttribute('aria-hidden',String(network.dataset.visible!=='true'));keepsakes.setAttribute('aria-hidden',String(keepsakes.dataset.visible!=='true'));
      var reduced=global.matchMedia&&global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      [networkField,spatial,mobileField].forEach(function(field){var visible=field.getClientRects().length>0&&global.getComputedStyle(field).visibility!=='hidden';Array.from(field.children).forEach(function(group,i){var lost=i<current.lostGroups;group.dataset.state=lost?'lost':'observed';if(!lost||!visible||reduced)group.classList.remove('story-burst');else if(rendered&&inputSeen&&index>lastIndex&&i>=old.lostGroups&&!reduced)group.classList.add('story-burst');});});
      signalList.replaceChildren.apply(signalList,current.signals.map(function(signal){return node('li','',signal.name+' · '+signal.status);}));
      Object.keys(objectNodes).forEach(function(key){objectNodes[key].element.dataset.visible='false';objectNodes[key].element.setAttribute('aria-hidden','true');});
      if(current.flower){var flower=object('flower','Flower','flower','Accepted or preserved in the passage');flower.element.dataset.visible='true';flower.element.setAttribute('aria-hidden','false');}
      current.presences.forEach(function(presence){var entry=object('presence:'+presence.name,presence.name,presence.kind,presence.detail);entry.element.dataset.visible='true';entry.element.setAttribute('aria-hidden','false');});
      currentCounters=counterRecords(chapter,anchors.filter(function(anchor){return anchor.position<=observationEdge(anchor.owner,edge);}).map(function(anchor){return{owner:anchor.owner,subject:anchor.subject,value:anchor.value,kind:anchor.kind,sourceId:anchor.block.id||null};}),currentToken,current);
      tokenGroup.dataset.available=String(currentCounters.length>0&&!current.blackout);
      Object.keys(tokenNodes).forEach(function(key){tokenNodes[key].element.hidden=true;});
      currentCounters.forEach(function(record){var item=tokenNode(record.key);item.element.hidden=false;item.element.dataset.active=String(record.active);item.element.dataset.stale=String(record.stale);item.element.dataset.available=String(!current.blackout);item.label.textContent=record.estimated?'≈ Estimated weighted tokens':'Weighted tokens';item.subject.textContent=record.subject;item.value.textContent=(record.estimated?'≈ ':'')+record.value.toLocaleString('en-US');item.qualifier.textContent=record.qualifier;});
      mobilePanel.dataset.visible=String(current.room&&!clean&&!current.blackout);mobilePanel.setAttribute('aria-hidden',String(mobilePanel.dataset.visible!=='true'));mobileField.dataset.visible=String(current.network);mobileCaption.textContent=current.signals.length?'Observed signals · no new response; cause unknown':'The room · last observed';Object.keys(objectNodes).forEach(function(key){var entry=objectNodes[key],item=mobileObjectNodes[key];if(!item){var el=node('span','story-object story-mobile-object'),art=image(entry.image.getAttribute('src'),'story-mobile-object-art'),label=node('span','',entry.name.textContent);el.append(art,label);mobileObjects.appendChild(el);item=mobileObjectNodes[key]={element:el,image:art,label:label};}item.image.src=entry.image.getAttribute('src');item.label.textContent=entry.name.textContent;item.element.dataset.visible=entry.element.dataset.visible;item.element.setAttribute('aria-hidden',String(item.element.dataset.visible!=='true'));});
      clock.hidden=current.elapsed===null||current.blackout;clockValue.textContent=current.elapsed===null?'':current.elapsed.toFixed(1)+' s';
      lastIndex=index;rendered=true;revealInitializedDecorations();
    }
    function update(){frame=0;measure();var edge=global.scrollY+boundary(),index=-1;positions.forEach(function(position,i){if(position<=edge)index=i;});render(index,edge);}
    function schedule(){if(!frame)frame=global.requestAnimationFrame(update);}
    function place(){var edge=boundary(),block=blocks.find(function(item){return item.getBoundingClientRect().bottom>edge;})||blocks[blocks.length-1];if(!block)return null;var rect=block.getBoundingClientRect();return{block:block,offset:Math.max(0,Math.min(1,(edge-rect.top)/Math.max(1,rect.height)))};}
    function setClean(value){var saved=place();clean=!!value;document.body.dataset.storyClean=String(clean);cleanButton.setAttribute('aria-pressed',String(clean));global.requestAnimationFrame(function(){if(saved&&saved.block.isConnected){var rect=saved.block.getBoundingClientRect();global.scrollTo({top:global.scrollY+rect.top+saved.offset*rect.height-boundary(),behavior:'instant'});}update();});}
    cleanButton.addEventListener('click',function(){setClean(!clean);});
    function themeChanged(){setClean(document.body.dataset.theme!=='night');}
    ['reader-theme','toggle-theme'].forEach(function(id){var control=document.getElementById(id);if(control)control.addEventListener(id==='reader-theme'?'change':'click',themeChanged);});
    function interacted(){inputSeen=true;}
    ['wheel','touchstart','pointerdown','keydown'].forEach(function(type){document.addEventListener(type,interacted,{passive:true});});
    var styleLinks=Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter(function(link){return /\/story-interface\.css(?:[?#]|$)/.test(link.href);});styleLinks.forEach(function(link){link.addEventListener('load',schedule);});
    global.addEventListener('scroll',schedule,{passive:true});global.addEventListener('resize',schedule);global.addEventListener('hashchange',schedule);
    var observer=new MutationObserver(function(){refresh();});observer.observe(article,{childList:true});
    var resizeObserver=global.ResizeObserver?new ResizeObserver(schedule):null;if(resizeObserver){resizeObserver.observe(article);resizeObserver.observe(toolbar);}
    document.body.classList.add('story-interface');document.body.dataset.storyClean='false';refresh();if(mountPlace&&mountPlace.block.isConnected){var mountRect=mountPlace.block.getBoundingClientRect();global.scrollTo({top:global.scrollY+mountRect.top+mountPlace.offset*mountRect.height-boundary(),behavior:'instant'});schedule();}
    return{article:article,refresh:refresh,getState:function(){return copy({room:current.room,network:current.network,flower:current.flower,blackout:current.blackout,signals:current.signals,presences:current.presences,lostGroups:current.lostGroups,elapsed:current.elapsed,token:currentToken,tokens:currentCounters,clean:clean,checkpointId:lastIndex>=0?events[lastIndex].block.id||null:null});},destroy:function(){styleLinks.forEach(function(link){link.removeEventListener('load',schedule);});delete document.body.dataset.storyReady;observer.disconnect();if(resizeObserver)resizeObserver.disconnect();if(frame)global.cancelAnimationFrame(frame);global.removeEventListener('scroll',schedule);global.removeEventListener('resize',schedule);global.removeEventListener('hashchange',schedule);['wheel','touchstart','pointerdown','keydown'].forEach(function(type){document.removeEventListener(type,interacted);});nodes.forEach(function(el){el.remove();});document.body.classList.remove('story-interface');}};
  }
  function init(){var root=global.document.querySelector('.reader-main'),article=root&&root.querySelector('.chapter-text');if(!article||!article.children.length)return false;if(instance&&instance.article===article)return true;if(instance)instance.destroy();instance=mount(root,article);return !!instance;}
  global.StoryInterface={version:RELEASE,init:init,refresh:function(){if(instance)instance.refresh();else init();},getState:function(){return instance?instance.getState():null;}};
  if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  global.document.addEventListener('reader:ready',init);
})(typeof window==='object'?window:null);
