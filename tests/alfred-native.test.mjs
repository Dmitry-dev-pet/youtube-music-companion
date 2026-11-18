import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { inflateSync } from "node:zlib";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root=fileURLToPath(new URL("..",import.meta.url));
const fullContent=fs.readFileSync(root+"/content/content.js","utf8");
const marker="// Alfred adapter for Companion for YouTube Music (GPL-3.0).";
assert.ok(fullContent.includes(marker),"Alfred adapter missing from fork");
const contentJs=fullContent.slice(fullContent.indexOf(marker));
const nativeJs=fs.readFileSync(root+"/alfred-native.js","utf8");

function contentHarness(){
  let listener=null, currentPlaying=true;
  const calls=[],id="AbCdEfGhIj1";
  const commands={
    pause(){currentPlaying=false;calls.push("pause");return true;},
    next(){calls.push("next");return true;},
    previous(){calls.push("previous");return true;},
    shuffle(){calls.push("shuffle");return true;},
    toggleRepeat(){calls.push("repeat");return true;},
    seek({position}){calls.push(["seek",position]);return true;},
    setVolume({volume}){calls.push(["volume",volume]);return true;},
    playQueueItem({index}){calls.push(["queuePlay",index]);return true;},
    async playVideoById({videoId}){calls.push(["play",videoId]);return true;},
    async queueVideoNext({videoId}){calls.push(["nextQueue",videoId]);return true;},
    async queueVideoLast({videoId}){calls.push(["endQueue",videoId]);return true;}
  };
  const ext={runtime:{id:"alfred-extension",onMessage:{addListener(fn){listener=fn}}}};
  const ctx={ext,location:{origin:"https://music.youtube.com"},commands,Date,
    crypto:{randomUUID:()=>"12345678-1234-1234-1234-123456789012"},
    readState:()=>({available:true,title:"Жили-были",artist:"Юта",duration:184,position:10}),
    isPlaying:()=>currentPlaying,
    startPlayback:async()=>{currentPlaying=true;calls.push("resume");return true},
    queueWithThumbs:async()=>[{index:0,title:"Current",artist:"Singer",selected:true}],
    askBridgeAsync:async(name,params)=>{
      if(name!=="search")throw Error("unexpected bridge command");
      calls.push(["search",params.query]);
      return {songs:[{videoId:id,title:"Жили-были",artist:"Юта"}]};
    },
    setTimeout,clearTimeout
  };
  vm.runInNewContext(contentJs,ctx,{timeout:1500});
  const request=(command,args={})=>new Promise(resolve=>{
    const ok=listener({type:"alfred.native.command",command,args},{id:"alfred-extension"},resolve);
    assert.equal(ok,true);
  });
  return {request,calls};
}
test("content adapter reuses Companion's native queue and search without raw JS",async()=>{
 const h=contentHarness();
 const s=await h.request("search",{query:"Юта Жили были"});
 assert.equal(s.ok,true);
 assert.equal(s.data.results[0].artist,"Юта");
 assert.equal(s.data.results[0].index,0);
 assert.equal(JSON.stringify(s.data).includes("AbCdEfGhIj1"),false);
 const q=await h.request("select",{index:0,action:"next",search_id:s.data.search_id});
 assert.equal(q.ok,true);
 assert.equal(q.data.requested,true);
 assert.equal(q.data.verified_queue_change,false);
 assert.deepEqual(h.calls.filter(x=>Array.isArray(x)&&x[0]==="nextQueue"),
  [["nextQueue","AbCdEfGhIj1"]]);
 const r=await h.request("select",{index:0,action:"end",search_id:s.data.search_id});
 assert.equal(r.ok,true);
 assert.deepEqual(h.calls.filter(x=>Array.isArray(x)&&x[0]==="endQueue"),
  [["endQueue","AbCdEfGhIj1"]]);
});
test("content adapter validates stale selection and cannot execute arbitrary commands",async()=>{
 const h=contentHarness();
 const unknown=await h.request("javascript",{code:"alert(1)"});
 assert.equal(unknown.ok,false);
 assert.equal(unknown.error,"UNKNOWN_COMMAND");
 const stale=await h.request("select",{index:0,action:"play",search_id:"not-ours"});
 assert.equal(stale.ok,false);
 assert.equal(stale.error,"SEARCH_EXPIRED");
 const state=await h.request("status");
 assert.equal(state.ok,true);
 assert.equal(state.data.title,"Жили-были");
 await h.request("pause");
 const resumed=await h.request("resume");
 assert.equal(resumed.ok,true);
 assert.ok(h.calls.includes("pause"));
 assert.ok(h.calls.includes("resume"));
});
test("native worker refuses non-allowlisted inputs and restricts Chrome tab",async()=>{
 let nativeHandler=null;
 const sent=[],tabs=[];
 const nativePort={
  onMessage:{addListener(fn){nativeHandler=fn}},
  onDisconnect:{addListener(){}},
  postMessage(m){sent.push(m);}
 };
 const chrome={
  runtime:{connectNative(name){assert.equal(name,"org.alfred.music_companion");return nativePort;},
    onStartup:{addListener(){}}},
  alarms:{create(){},onAlarm:{addListener(){}}},
  tabs:{
    async query(){return tabs;},
    async sendMessage(id,msg){return {ok:true,data:{title:"Жили-были"}};}
  }
 };
 vm.runInNewContext(nativeJs,{chrome,URL,setTimeout,clearTimeout},{timeout:1500});
 assert.equal(typeof nativeHandler,"function");
 nativeHandler({type:"alfred.request",id:1,command:"javascript",args:{}});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(sent[0].ok,false);
 assert.equal(sent[0].error,"INVALID_ARGUMENTS");
 nativeHandler({type:"alfred.request",id:2,command:"status",args:{}});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(sent[1].error,"NO_MUSIC_TAB");
 tabs.push({id:7,url:"https://music.youtube.com/watch?v=AbCdEfGhIj1",discarded:false});
 nativeHandler({type:"alfred.request",id:3,command:"status",args:{}});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(sent[2].ok,true);
 assert.equal(sent[2].data.title,"Жили-были");
 tabs.push({id:8,url:"https://music.youtube.com/",discarded:false});
 nativeHandler({type:"alfred.request",id:4,command:"status",args:{}});
 await new Promise(r=>setTimeout(r,0));
 assert.equal(sent[3].error,"AMBIGUOUS_MUSIC_TAB");
});

test("fork Manifest V3 scopes Native Messaging and uses its own icons",()=>{
 const manifest=JSON.parse(fs.readFileSync(root+"/manifest.json","utf8"));
 assert.equal(manifest.manifest_version,3);
 assert.equal(manifest.background.service_worker,"background.js");
 assert.equal(Object.hasOwn(manifest.background,"scripts"),false,
   "Chrome MV3 cannot declare the Firefox-only background.scripts field");
 assert.ok(manifest.web_accessible_resources.some(item=>
   item.resources?.includes("content/bridge.js") &&
   item.matches?.includes("https://music.youtube.com/*")),
   "page bridge must be web-accessible on music.youtube.com");
 assert.equal(manifest.name,"Alfred Music Companion");
 assert.ok(manifest.permissions.includes("nativeMessaging"));
 assert.ok(manifest.host_permissions.includes("https://music.youtube.com/*"));
 for(const forbidden of ["cookies","history","debugger","downloads","webRequest"]){
  assert.equal(manifest.permissions.includes(forbidden),false);
 }
 assert.ok(Object.values(manifest.icons).every(name=>name.startsWith("alfred-icons/")));
 assert.equal(manifest.background.service_worker,"background.js");
});

test("fork icons are actual decodable and correctly sized PNGs",()=>{
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 for(const size of [16,32,48,128]){
   const png=fs.readFileSync(root+"/alfred-icons/icon"+size+".png");
   assert.deepEqual(png.subarray(0,8),signature);
   assert.equal(png.readUInt32BE(16),size);
   assert.equal(png.readUInt32BE(20),size);
   const idats=[];
   for(let at=8;at<png.length;){
     const length=png.readUInt32BE(at);
     const type=png.toString("ascii",at+4,at+8);
     if(type==="IDAT")idats.push(png.subarray(at+8,at+8+length));
     at+=length+12;
     assert.ok(at<=png.length);
   }
   const raw=inflateSync(Buffer.concat(idats));
   assert.equal(raw.length,size*(1+4*size));
   for(let row=0;row<size;row++){
     assert.equal(raw[row*(1+4*size)],0);
   }
 }
});
