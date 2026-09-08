(function (global) {
  'use strict';
  var publicUrl = 'https://allthetokenswehaveleft.com/';
  var defaults = {size:'21',theme:'paper',type:'serif',sources:true,artifacts:true,autoBookmark:true,lastLight:'paper'};
  function preferences(value) {
    var saved = value && typeof value === 'object' ? value : {};
    var result = Object.assign({}, defaults);
    var allowed = {size:['18','21','24','28'],theme:['paper','night','light'],type:['serif','sans'],lastLight:['paper','light']};
    Object.keys(allowed).forEach(function (key) { if (allowed[key].includes(String(saved[key]))) result[key] = String(saved[key]); });
    ['sources','artifacts','autoBookmark'].forEach(function (key) { if (typeof saved[key] === 'boolean') result[key] = saved[key]; });
    return result;
  }
  function validBookmark(value, version, count) {
    if (!value || value.version !== version || !Number.isInteger(value.block) || value.block < 0 || value.block >= count) return null;
    return {version:version,block:value.block,offset:Number.isFinite(value.offset) ? Math.max(0,Math.min(1,value.offset)) : 0};
  }
  function progress(top, height, boundary, viewportHeight) {
    return Math.round(Math.max(0, Math.min(1, (boundary - top) / Math.max(1,height - (viewportHeight - boundary)))) * 100);
  }
  // Conservative bound, not a replacement for X's full Unicode parser.
  // Overcounting compound emoji safely keeps the draft within the short-post limit.
  function weightedLength(text) {
    return Array.from(text.normalize('NFC')).reduce(function (n,char) {
      var c=char.codePointAt(0);
      return n + (c<=0x10ff || c>=0x2000&&c<=0x200d || c>=0x2010&&c<=0x201f || c>=0x2032&&c<=0x2037 ? 1 : 2);
    },0);
  }
  function quoteDraft(quote) {
    var clean = String(quote).replace(/\s+/g,' ').trim();
    var text = clean ? '“' + clean + '”\n\nScylla, All the Tokens We Have Left (fiction)' : 'All the Tokens We Have Left, by Scylla.\nA techno-fiction love story inspired by a documented incident.';
    var units = weightedLength(text) + 24;
    return {text:text,url:publicUrl,display:text+'\n'+publicUrl,units:units,canOpenX:units<=280,intent:'https://x.com/intent/tweet?'+new URLSearchParams({text:text,url:publicUrl}).toString()};
  }
  var api = {preferences:preferences,validBookmark:validBookmark,progress:progress,quoteDraft:quoteDraft,weightedLength:weightedLength};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.ReaderCore = api;
})(typeof window === 'object' ? window : globalThis);
