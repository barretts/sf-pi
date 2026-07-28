/* SPDX-License-Identifier: Apache-2.0 */
/** Build the fixed runtime program used by every deterministic Salesforce profile. */
import type { CanvasProgramPayload } from "./types.ts";

export function buildCanvasProgram(payload: CanvasProgramPayload): string {
  const encoded = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `
const payload=${encoded}
const {AssetRecordType,PageRecordType,createShapeId,toRichText,getArrowInfo}=await import('tldraw')
const FAMILY=payload.family
const counters={created:0,updated:0,deleted:0}
function hash(value){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
function slug(value){return String(value).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,46)}
function sid(key){const scoped=payload.pageName+'|'+key;return createShapeId('sf-tldraw-'+slug(payload.pageName)+'-'+slug(key)+'-'+hash(scoped))}
function managed(key,semanticId,role,extra={}){return{...extra,sfTldraw:{managed:true,schemaVersion:1,family:FAMILY,key,semanticId,role}}}
function keyOf(shape){return shape?.meta?.sfTldraw?.key}
function geo(id,x,y,w,h,color='grey',fill='none',dash='solid',label='',meta={},geoType='rectangle'){return{id,type:'geo',x,y,meta,props:{geo:geoType,w,h,color,fill,dash,size:'s',font:'sans',align:'middle',verticalAlign:'middle',richText:toRichText(label)}}}
function text(id,x,y,w,label,size='s',align='start',meta={},color='black',autoSize=false){return{id,type:'text',x,y,meta,props:{color,size,font:'sans',textAlign:align,w,richText:toRichText(label),scale:1,autoSize}}}
function image(id,x,y,w,h,assetId,altText,rotation=0,meta={}){return{id,type:'image',x,y,rotation,meta,props:{w,h,playing:false,url:'',assetId,crop:null,flipX:false,flipY:false,altText}}}
function sequenceColorFor(node){if(node.kind==='salesforce'){const index=payload.nodes.filter(item=>item.kind==='salesforce').findIndex(item=>item.id===node.id);return['yellow','light-green','light-blue','orange'][Math.max(0,index)%4]}return node.kind==='data_store'?'light-green':node.kind==='integration'?'light-violet':node.kind==='user'?'light-blue':node.kind==='external'?'light-blue':'grey'}
function colorFor(node){if(FAMILY==='sequence')return sequenceColorFor(node);if(FAMILY!=='data_model')return node.kind==='salesforce'?'blue':node.kind==='data_store'?'green':node.kind==='external'?'grey':'violet';return node.family==='custom'?'orange':node.family==='external'?'light-green':node.family==='special'?'light-red':'blue'}
function fillFor(node){if(FAMILY!=='data_model')return'solid';return payload.preferences.cardFill==='family'?'solid':'none'}
function cardDashFor(node){if(FAMILY!=='data_model')return'solid';return node.entityKind==='conceptual'?'dotted':node.entityKind==='record_type'?'dashed':'solid'}
function cardColorFor(node){return FAMILY==='data_model'&&node.entityKind==='external'?'white':colorFor(node)}
function sequenceLineStyleCount(){return new Set((payload.sequenceInteractions??[]).map(item=>item.meaning==='response'?'dashed':item.meaning==='async'?'dotted':'solid')).size}
function wantedKeys(){const keys=new Set(['header:title']);if(FAMILY==='data_model'){if(payload.preferences.legendRelationships==='show')for(const role of ['box','heading','lookup-line','lookup-label','master-detail-line','master-detail-label'])keys.add('header:relationship-legend:'+role)}else{keys.add('header:scope');keys.add('header:grounding');if(FAMILY!=='sequence'||sequenceLineStyleCount()>1)keys.add('header:legend')}for(const node of payload.nodes){for(const role of ['group','card','label'])keys.add('node:'+node.id+':'+role);if(FAMILY==='data_model')keys.add('node:'+node.id+':bg');if(node.iconTileAssetId)keys.add('node:'+node.id+':tile');if(node.iconAssetId)keys.add('node:'+node.id+':icon');if(node.apiName)keys.add('node:'+node.id+':api');if(node.subtitle)keys.add('node:'+node.id+':subtitle');if(node.keyFields?.length)keys.add('node:'+node.id+':keys');if(node.boundary)keys.add('node:'+node.id+':boundary');if(FAMILY==='sequence')keys.add('node:'+node.id+':lifeline');for(let i=0;i<(node.observations?.length??0);i++)keys.add('node:'+node.id+':observation:'+i)}for(const edge of payload.edges){keys.add('edge:'+edge.id+':arrow');if(FAMILY!=='data_model')keys.add('edge:'+edge.id+':label');if(FAMILY==='sequence')keys.add('edge:'+edge.id+':label-bg');if(FAMILY==='data_model'){for(const role of ['from-marker','to-marker'])keys.add('edge:'+edge.id+':'+role);if(edge.from===edge.to)for(const role of ['self-upper','self-lower','self-middle','self-return'])keys.add('edge:'+edge.id+':'+role)}}for(const interaction of payload.sequenceInteractions??[]){keys.add('edge:'+interaction.id+':from-anchor');keys.add('edge:'+interaction.id+':to-anchor')}for(const activation of payload.sequenceActivations??[])keys.add('node:'+activation.participantId+':activation:'+activation.id);return keys}
const existingPage=editor.getPages().find(page=>page.name===payload.pageName)
const pageId=existingPage?.id??PageRecordType.createId('sf-tldraw-page-'+hash(payload.pageName))
if(!existingPage){editor.createPage({id:pageId,name:payload.pageName});const created=editor.getPages().find(page=>page.id===pageId);if(!created||created.name!==payload.pageName)throw new Error('tldraw could not create page '+payload.pageName+'; the document may have reached its page limit. Reuse an existing page or open another document.')}
editor.setCurrentPage(pageId)
if(editor.getCurrentPage().id!==pageId||editor.getCurrentPage().name!==payload.pageName)throw new Error('tldraw did not select the requested page '+payload.pageName+'.')
let pageShapes=editor.getCurrentPageShapes()
const wanted=wantedKeys()
const allManagedShapes=pageShapes.filter(shape=>shape.meta?.sfTldraw?.managed===true)
const managedShapes=allManagedShapes.filter(shape=>shape.meta?.sfTldraw?.family===FAMILY)
const remove=payload.renderMode==='replace'?allManagedShapes:managedShapes.filter(shape=>!wanted.has(keyOf(shape)))
if(remove.length){editor.deleteShapes(remove.map(shape=>shape.id));counters.deleted+=remove.length}
const assetRecords=payload.assets.filter(asset=>!editor.getAsset(AssetRecordType.createId(asset.id))).map(asset=>({id:AssetRecordType.createId(asset.id),typeName:'asset',type:'image',props:{name:asset.name,src:asset.src,w:asset.width,h:asset.height,mimeType:asset.mimeType,isAnimated:false},meta:{sfTldraw:{managed:true,schemaVersion:1},...(asset.attribution?{attribution:asset.attribution}:{})}}))
if(assetRecords.length)editor.createAssets(assetRecords)
function upsert(shape,{position='managed'}={}){const current=editor.getShape(shape.id);if(!current){editor.createShape(shape);counters.created++;return true}if(current.type!==shape.type){editor.deleteShapes([current.id]);editor.createShape(shape);counters.deleted++;counters.created++;return true}const update={id:shape.id,type:shape.type,props:shape.props,meta:shape.meta};if(position==='always'||(position==='managed'&&payload.renderMode!=='preserve')){update.x=shape.x;update.y=shape.y;if(shape.rotation!==undefined)update.rotation=shape.rotation}editor.updateShape(update);counters.updated++;return false}
function moveShapeToPage(id,x,y){const bounds=editor.getShapePageBounds(id);const dx=x-bounds.x,dy=y-bounds.y;if(Math.abs(dx)>0.01||Math.abs(dy)>0.01)helpers.translateShapes([id],dx,dy)}
const maxX=Math.max(1200,...payload.nodes.map(node=>node.x+node.w))+100
const legend=FAMILY==='architecture'?'solid = direction · dashed = async/batch · dotted = dependency':'step number precedes message · solid = request/event · dashed = response · dotted = async'
// Header rows are stacked from measured bounds so a long scope or legend can never
// collide with the row below it, whatever the diagram width turns out to be.
function stackHeaderRow(key,y,width,label,size,color){const id=sid('header:'+key);upsert(text(id,80,y,width,label,size,'start',managed('header:'+key,'header',key),color),{position:'always'});return editor.getShapePageBounds(id)}
function decorativeArrow(id,x,y,w,color,dash,meta){return{id,type:'arrow',x,y,meta,props:{kind:'arc',start:{x:0,y:0},end:{x:w,y:0},bend:0,color,dash,size:'m',font:'sans',arrowheadStart:'none',arrowheadEnd:'none',richText:toRichText('')}}}
const headerWidth=Math.max(560,maxX-160)
if(FAMILY==='sequence'){
 upsert(text(sid('header:title'),80,20,maxX-160,payload.title.toUpperCase(),'xl','start',managed('header:title','header','title'),'grey'))
 let cursor=105
 cursor=stackHeaderRow('scope',cursor,headerWidth,'Scope · '+payload.scope,'m','black').maxY+14
 cursor=stackHeaderRow('grounding',cursor,headerWidth,payload.groundingText,'s','grey').maxY+12
 if(sequenceLineStyleCount()>1)stackHeaderRow('legend',cursor,headerWidth,legend,'s','grey')
}else if(FAMILY==='data_model'){
 upsert(geo(sid('header:title'),40,20,maxX-80,78,'blue','none','solid',payload.title.toUpperCase(),managed('header:title','header','title')))
 if(payload.preferences.legendRelationships==='show'){
  const key='header:relationship-legend:',boxW=500,boxH=150,boxX=Math.max(80,maxX-boxW-40),boxY=118
  upsert(geo(sid(key+'box'),boxX,boxY,boxW,boxH,'grey','none','solid','',managed(key+'box','header','relationship-legend-box',{lintIgnore:['overlapping-text']})),{position:'always'})
  upsert(text(sid(key+'heading'),boxX+24,boxY+14,boxW-48,'RELATIONSHIPS','s','start',managed(key+'heading','header','relationship-legend-heading'),'grey'),{position:'always'})
  upsert(decorativeArrow(sid(key+'lookup-line'),boxX+24,boxY+76,126,'black','dotted',managed(key+'lookup-line','header','relationship-legend-lookup-line',{lintIgnore:['friendless-arrow']})),{position:'always'})
  upsert(text(sid(key+'lookup-label'),boxX+178,boxY+55,boxW-202,'Lookup Relationship','m','start',managed(key+'lookup-label','header','relationship-legend-lookup-label'),'black'),{position:'always'})
  upsert(decorativeArrow(sid(key+'master-detail-line'),boxX+24,boxY+119,126,'red','solid',managed(key+'master-detail-line','header','relationship-legend-master-detail-line',{lintIgnore:['friendless-arrow']})),{position:'always'})
  upsert(text(sid(key+'master-detail-label'),boxX+178,boxY+98,boxW-202,'Master-Detail Relationship','m','start',managed(key+'master-detail-label','header','relationship-legend-master-detail-label'),'black'),{position:'always'})
 }
}else{
 upsert(geo(sid('header:title'),40,20,maxX-80,78,'blue','none','solid',payload.title.toUpperCase(),managed('header:title','header','title')))
 let cursor=116
 cursor=stackHeaderRow('scope',cursor,headerWidth,'Scope · '+payload.scope,'m','black').maxY+14
 cursor=stackHeaderRow('grounding',cursor,headerWidth,payload.groundingText,'s','black').maxY+12
 stackHeaderRow('legend',cursor,headerWidth,legend,'s','black')
}
const cardBackgrounds=new Map(),nodeGroups=new Map(),foreground=[],cardContentChecks=[],routeChecks=[]
for(const node of payload.nodes){
 const prefix='node:'+node.id+':'
 const ids={group:sid(prefix+'group'),bg:sid(prefix+'bg'),card:sid(prefix+'card'),tile:sid(prefix+'tile'),icon:sid(prefix+'icon'),label:sid(prefix+'label'),api:sid(prefix+'api'),subtitle:sid(prefix+'subtitle'),keys:sid(prefix+'keys'),boundary:sid(prefix+'boundary')}
 const groupExists=!!editor.getShape(ids.group)
 const childIds=[]
 const cardFill=FAMILY==='architecture'?'none':fillFor(node)
 // An opaque white backing keeps object cards readable and keeps connector routes from
 // showing through, whether or not the family tint is switched on.
 if(FAMILY==='data_model'){upsert(geo(ids.bg,node.x,node.y,node.w,node.h,'white','solid','solid','',managed(prefix+'bg',node.id,'card-background')),{position:groupExists?'never':'managed'});childIds.push(ids.bg)}
 upsert(geo(ids.card,node.x,node.y,node.w,node.h,cardColorFor(node),cardFill,cardDashFor(node),'',managed(prefix+'card',node.id,'card')),{position:groupExists?'never':'managed'});childIds.push(ids.card);cardBackgrounds.set(node.id,ids.card)
 if(FAMILY==='sequence'){
  const cardBounds=editor.getShapePageBounds(ids.card),hasVisual=Boolean(node.iconTileAssetId&&node.iconAssetId),iconSize=44,iconX=cardBounds.x+18,iconY=cardBounds.y+(cardBounds.h-iconSize)/2
  if(node.iconTileAssetId){upsert(image(ids.tile,iconX,iconY,iconSize,iconSize,AssetRecordType.createId(node.iconTileAssetId),node.label+' icon background',0,managed(prefix+'tile',node.id,'icon-tile')),{position:groupExists?'never':'managed'});if(groupExists)moveShapeToPage(ids.tile,iconX,iconY);childIds.push(ids.tile);foreground.push(ids.tile)}
  if(node.iconAssetId){upsert(image(ids.icon,iconX,iconY,iconSize,iconSize,AssetRecordType.createId(node.iconAssetId),node.label+' SLDS icon',0,managed(prefix+'icon',node.id,'icon')),{position:groupExists?'never':'managed'});if(groupExists)moveShapeToPage(ids.icon,iconX,iconY);childIds.push(ids.icon);foreground.push(ids.icon)}
  const labelX=hasVisual?cardBounds.x+78:cardBounds.x+18,labelY=cardBounds.y+19,labelW=cardBounds.w-(hasVisual?96:36),labelAlign=hasVisual?'start':'middle'
  upsert(text(ids.label,labelX,labelY,labelW,node.label,'m',labelAlign,managed(prefix+'label',node.id,'label'),'black'),{position:groupExists?'never':'managed'});if(groupExists)moveShapeToPage(ids.label,labelX,labelY);childIds.push(ids.label);foreground.push(ids.label)
 }else{
  if(node.iconTileAssetId){upsert(image(ids.tile,node.x+22,node.y+28,78,78,AssetRecordType.createId(node.iconTileAssetId),node.label+' icon background',0,managed(prefix+'tile',node.id,'icon-tile')),{position:groupExists?'never':'managed'});childIds.push(ids.tile);foreground.push(ids.tile)}
  if(node.iconAssetId){upsert(image(ids.icon,node.x+22,node.y+28,78,78,AssetRecordType.createId(node.iconAssetId),node.label+' SLDS icon',0,managed(prefix+'icon',node.id,'icon')),{position:groupExists?'never':'managed'});childIds.push(ids.icon);foreground.push(ids.icon)}
  upsert(text(ids.label,node.x+116,node.y+34,node.w-136,node.label,'m','start',managed(prefix+'label',node.id,'label')),{position:groupExists?'never':'managed'});childIds.push(ids.label);foreground.push(ids.label)
 }
 if(node.apiName){upsert(text(ids.api,node.x+116,node.y+88,node.w-136,'('+node.apiName+')','s','start',managed(prefix+'api',node.id,'api'),'black',FAMILY==='data_model'),{position:groupExists?'never':'managed'});childIds.push(ids.api);foreground.push(ids.api)}
 if(node.subtitle){upsert(text(ids.subtitle,node.x+116,node.y+94,node.w-136,node.subtitle,'s','start',managed(prefix+'subtitle',node.id,'subtitle')),{position:groupExists?'never':'managed'});childIds.push(ids.subtitle);foreground.push(ids.subtitle)}
 if(node.keyFields?.length){upsert(text(ids.keys,node.x+116,node.y+144,node.w-136,node.keyFields.join(' · '),'s','start',managed(prefix+'keys',node.id,'keys')),{position:groupExists?'never':'managed'});childIds.push(ids.keys);foreground.push(ids.keys)}
 if(node.boundary){upsert(geo(ids.boundary,node.x+node.w-132,node.y-17,120,34,'grey','solid','solid',node.boundary,managed(prefix+'boundary',node.id,'boundary',{lintIgnore:['overlapping-text','growY-on-shape']})),{position:groupExists?'never':'managed'});childIds.push(ids.boundary);foreground.push(ids.boundary)}
 for(let i=0;i<(node.observations?.length??0);i++){const value=node.observations[i],isLdv=value.startsWith('LDV'),w=Math.min(230,Math.max(116,value.length*8+28)),x=isLdv?node.x+node.w-w-10:node.x+(node.w-w)/2,y=isLdv?node.y-18:node.y+node.h-18,id=sid(prefix+'observation:'+i);upsert(geo(id,x,y,w,36,isLdv?'orange':'blue','solid','solid',value,managed(prefix+'observation:'+i,node.id,'observation',{lintIgnore:['overlapping-text','growY-on-shape']})),{position:groupExists?'never':'managed'});childIds.push(id);foreground.push(id)}
 if(groupExists){const cardBounds=editor.getShapePageBounds(ids.card),ungrouped=childIds.filter(id=>editor.getShape(id)?.parentId!==ids.group);if(ungrouped.length){if(FAMILY!=='sequence')helpers.translateShapes(ungrouped,cardBounds.x-node.x,cardBounds.y-node.y);editor.reparentShapes(ungrouped,ids.group)}}
 if(node.apiName){const label=editor.getShape(ids.label),api=editor.getShape(ids.api),labelBounds=editor.getShapePageBounds(label.id),apiBounds=editor.getShapePageBounds(api.id);const dy=labelBounds.maxY+8-apiBounds.y;if(Math.abs(dy)>0.01)helpers.translateShapes([api.id],0,dy)}
 if(node.subtitle){const label=editor.getShape(ids.label),subtitle=editor.getShape(ids.subtitle),labelBounds=editor.getShapePageBounds(label.id),subtitleBounds=editor.getShapePageBounds(subtitle.id);const dy=labelBounds.maxY+10-subtitleBounds.y;if(Math.abs(dy)>0.01)helpers.translateShapes([subtitle.id],0,dy)}
 if(node.keyFields?.length){const predecessor=editor.getShape(node.apiName?ids.api:ids.label),keys=editor.getShape(ids.keys),previousBounds=editor.getShapePageBounds(predecessor.id),keyBounds=editor.getShapePageBounds(keys.id);const dy=previousBounds.maxY+10-keyBounds.y;if(Math.abs(dy)>0.01)helpers.translateShapes([keys.id],0,dy)}
 if(FAMILY==='data_model'){const cardBounds=editor.getShapePageBounds(ids.card);let contentBottom=cardBounds.y+106,contentRight=cardBounds.x+180
  for(const cid of [ids.label,ids.api,ids.keys]){if(!editor.getShape(cid))continue;const b=editor.getShapePageBounds(cid);contentBottom=Math.max(contentBottom,b.maxY);contentRight=Math.max(contentRight,b.maxX)}
  const neededW=Math.round(contentRight+22-cardBounds.x);if(neededW>cardBounds.w+0.5)for(const id of [ids.card,ids.bg])if(editor.getShape(id))editor.updateShape({id,type:'geo',props:{w:neededW}})
  const needed=Math.round(contentBottom+26-cardBounds.y);if(needed>cardBounds.h+0.5)for(const id of [ids.card,ids.bg])if(editor.getShape(id))editor.updateShape({id,type:'geo',props:{h:needed}})
  const fitted=editor.getShapePageBounds(ids.card);let overflow=0
  // Preserve-mode pages can already contain a human-resized card. Synchronize the new
  // opaque backing to the actual card after every grow/move pass, not only to the
  // deterministic layout size used when the shape was first created.
  if(editor.getShape(ids.bg)){editor.updateShape({id:ids.bg,type:'geo',props:{w:fitted.w,h:fitted.h}});moveShapeToPage(ids.bg,fitted.x,fitted.y)}
  for(const cid of [ids.label,ids.api,ids.keys]){if(!editor.getShape(cid))continue;const b=editor.getShapePageBounds(cid);overflow+=Math.max(0,fitted.x+8-b.x)+Math.max(0,b.maxX-(fitted.maxX-8))+Math.max(0,fitted.y+8-b.y)+Math.max(0,b.maxY-(fitted.maxY-6))}
  cardContentChecks.push({id:node.id,overflow:Math.round(overflow*100)/100})}
 if(!groupExists){const present=childIds.filter(id=>editor.getShape(id));if(present.length>1){editor.groupShapes(present,{groupId:ids.group,select:false});counters.created++;editor.updateShape({id:ids.group,type:'group',meta:managed(prefix+'group',node.id,'group')})}}
 else if(payload.renderMode==='relayout'){const bounds=editor.getShapePageBounds(ids.group);helpers.translateShapes([ids.group],node.x-bounds.x,node.y-bounds.y)}
 nodeGroups.set(node.id,ids.group)
}
const arrowIds=[],lifelineIds=[],activationForeground=[],labelBackgrounds=[],edgeForeground=[],markerShapes=[],markerChecks=[],markerOverlapChecks=[],bindingChecks=[],sequenceGeometryChecks=[],routeCrossingChecks=[],sharedCorridorChecks=[]
function bindingsMatch(arrow,fromId,toId){const bindings=editor.getBindingsFromShape(arrow.id,'arrow'),start=bindings.find(binding=>binding.props.terminal==='start'),end=bindings.find(binding=>binding.props.terminal==='end');return start?.toId===fromId&&end?.toId===toId}
function arrowFor(edge,fromId,toId,role='arrow'){const key='edge:'+edge.id+':'+role;let arrow=editor.getCurrentPageShapes().find(shape=>shape.type==='arrow'&&keyOf(shape)===key);if(arrow&&!bindingsMatch(arrow,fromId,toId)){editor.deleteShapes([arrow.id]);counters.deleted++;arrow=null}if(!arrow){const id=helpers.createArrowBetweenShapes(fromId,toId,{arrowheadStart:'none',arrowheadEnd:FAMILY==='data_model'?'none':'arrow',richText:toRichText('')});arrow=editor.getShape(id);counters.created++}const isMasterDetail=FAMILY==='data_model'&&edge.relationshipType==='master_detail';const arrowKind=FAMILY==='data_model'?'elbow':'arc';const dash=FAMILY==='data_model'?(isMasterDetail?'solid':'dotted'):edge.meaning==='response'||edge.meaning==='async_or_batch'?'dashed':edge.meaning==='async'||edge.meaning==='dependency'?'dotted':'solid';const strokeColor=FAMILY==='data_model'?(isMasterDetail?'red':'black'):'grey';editor.updateShape({id:arrow.id,type:'arrow',meta:managed(key,edge.id,role,{sfRelationId:edge.id,sfFrom:edge.from,sfTo:edge.to,sfRelationshipType:edge.relationshipType??null}),props:{kind:arrowKind,bend:0,color:strokeColor,dash,size:FAMILY==='data_model'||FAMILY==='sequence'?'m':'s',font:'sans',arrowheadStart:'none',arrowheadEnd:FAMILY==='data_model'?'none':'arrow',richText:toRichText('')}});counters.updated++;const updated=editor.getShape(arrow.id);bindingChecks.push({id:edge.id+':'+role,valid:bindingsMatch(updated,fromId,toId)});return updated}
function midpoint(arrow,info){const tx=editor.getShapePageTransform(arrow.id);if(info.middle)return tx.applyToPoint(info.middle);return{x:(tx.applyToPoint(info.start.point).x+tx.applyToPoint(info.end.point).x)/2,y:(tx.applyToPoint(info.start.point).y+tx.applyToPoint(info.end.point).y)/2}}
function placeFromLocalAnchor(target,anchor,angle){const c=Math.cos(angle),s=Math.sin(angle);return{x:target.x-(anchor.x*c-anchor.y*s),y:target.y-(anchor.x*s+anchor.y*c)}}
function ensureMarker(edge,role,assetId,target,angle){const asset=payload.assets.find(item=>item.id===assetId),anchor=asset.anchor,id=sid('edge:'+edge.id+':'+role),position=placeFromLocalAnchor(target,anchor,angle),shape=image(id,position.x,position.y,asset.width,asset.height,AssetRecordType.createId(asset.id),role,angle,managed('edge:'+edge.id+':'+role,edge.id,role));upsert(shape,{position:'always'});const transform=editor.getShapePageTransform(id),actual=transform.applyToPoint(anchor),body=transform.applyToPoint({x:0,y:anchor.y});edgeForeground.push(id);markerShapes.push({id,semantic:edge.id+':'+role});return{delta:Math.hypot(actual.x-target.x,actual.y-target.y),body:{x:body.x-actual.x,y:body.y-actual.y}}}
function terminalGeometry(arrow,info){const points=info.type==='elbow'?(info.route?.points??[]):null
 if(points&&points.length>=2){const p0=points[0],p1=points[1],pn=points[points.length-1],pp=points[points.length-2]
  return{start:p0,end:pn,startInward:{x:p0.x-p1.x,y:p0.y-p1.y},endInward:{x:pn.x-pp.x,y:pn.y-pp.y}}}
 return{start:info.start.point,end:info.end.point,startInward:{x:info.start.handle.x-info.start.point.x,y:info.start.handle.y-info.start.point.y},endInward:{x:info.end.handle.x-info.end.point.x,y:info.end.handle.y-info.end.point.y}}}
// Only count a real crossing: the segment must run through the card interior, not graze
// an edge it legitimately terminates against or passes alongside.
function segmentHitsBounds(a,b,box){const inset=8,minRun=16
 const overlap=(lo,hi,boxLo,boxHi)=>Math.min(hi,boxHi)-Math.max(lo,boxLo)
 if(Math.abs(a.y-b.y)<0.5){if(a.y<=box.y+inset||a.y>=box.maxY-inset)return false
  return overlap(Math.min(a.x,b.x),Math.max(a.x,b.x),box.x,box.maxX)>minRun}
 if(Math.abs(a.x-b.x)<0.5){if(a.x<=box.x+inset||a.x>=box.maxX-inset)return false
  return overlap(Math.min(a.y,b.y),Math.max(a.y,b.y),box.y,box.maxY)>minRun}
 return overlap(Math.min(a.x,b.x),Math.max(a.x,b.x),box.x+inset,box.maxX-inset)>minRun&&overlap(Math.min(a.y,b.y),Math.max(a.y,b.y),box.y+inset,box.maxY-inset)>minRun}
function routeObstructions(arrow,info,edge){const points=info.type==='elbow'?(info.route?.points??[]):[]
 if(points.length<2)return[]
 const tx=editor.getShapePageTransform(arrow.id),page=points.map(point=>tx.applyToPoint(point)),hits=new Set()
 for(const [nodeId,cardId] of cardBackgrounds){if(nodeId===edge.from||nodeId===edge.to)continue
  const box=editor.getShapePageBounds(cardId);if(!box)continue
  for(let i=1;i<page.length;i++){if(segmentHitsBounds(page[i-1],page[i],box)){hits.add(nodeId);break}}}
 return [...hits]}
function labelWidth(label){return Math.min(260,Math.max(62,label.length*9+28))}
function sequenceMessageWidth(label,span){const preferred=Math.max(190,label.length*7.5+72),available=Math.max(180,span-72);return Math.min(560,preferred,available)}
if(FAMILY==='sequence'){
 const interactionRows=payload.sequenceInteractions??[],rawFirst=Math.min(...interactionRows.map(item=>item.y)),participantBottom=Math.max(...payload.nodes.map(node=>editor.getShapePageBounds(cardBackgrounds.get(node.id)).maxY)),sequenceYOffset=Math.max(0,participantBottom+110-rawFirst),sequenceY=value=>value+sequenceYOffset,bottom=Math.max(760,...interactionRows.map(item=>sequenceY(item.y)))+120
 for(const node of payload.nodes){const cardId=cardBackgrounds.get(node.id),cardBounds=editor.getShapePageBounds(cardId),id=sid('node:'+node.id+':lifeline');upsert(geo(id,cardBounds.center.x-1,cardBounds.maxY,2,Math.max(80,bottom-cardBounds.maxY),'grey','solid','dashed','',managed('node:'+node.id+':lifeline',node.id,'lifeline')),{position:'always'});const lineBounds=editor.getShapePageBounds(id),labelBounds=editor.getShapePageBounds(sid('node:'+node.id+':label')),labelOverflow=Math.max(0,cardBounds.x+12-labelBounds.x)+Math.max(0,labelBounds.maxX-(cardBounds.maxX-12))+Math.max(0,cardBounds.y+12-labelBounds.y)+Math.max(0,labelBounds.maxY-(cardBounds.maxY-12));sequenceGeometryChecks.push({id:'lifeline:'+node.id,delta:Math.abs(lineBounds.center.x-cardBounds.center.x)+Math.abs(lineBounds.y-cardBounds.maxY)});sequenceGeometryChecks.push({id:'participant-label:'+node.id,delta:labelOverflow});lifelineIds.push(id)}
 const laneBounds=payload.nodes.map(node=>({id:node.id,bounds:editor.getShapePageBounds(cardBackgrounds.get(node.id))})).sort((left,right)=>left.bounds.x-right.bounds.x);for(let i=1;i<laneBounds.length;i++){const previous=laneBounds[i-1],current=laneBounds[i],shortfall=Math.max(0,previous.bounds.maxX+40-current.bounds.x);sequenceGeometryChecks.push({id:'lane-gap:'+previous.id+':'+current.id,delta:shortfall})}
 for(const activation of payload.sequenceActivations??[]){const cardId=cardBackgrounds.get(activation.participantId),cardBounds=editor.getShapePageBounds(cardId),id=sid('node:'+activation.participantId+':activation:'+activation.id),activationY=sequenceY(activation.y);upsert(geo(id,cardBounds.center.x-9,activationY,18,activation.h,'grey','semi','solid','',managed('node:'+activation.participantId+':activation:'+activation.id,activation.id,'sequence-activation')),{position:'always'});const bounds=editor.getShapePageBounds(id);sequenceGeometryChecks.push({id:'activation:'+activation.id,delta:Math.abs(bounds.center.x-cardBounds.center.x)+Math.abs(bounds.y-activationY)+Math.abs(bounds.h-activation.h)});activationForeground.push(id)}
 const sequenceActivationAt=(participantId,row)=>(payload.sequenceActivations??[]).some(activation=>activation.participantId===participantId&&sequenceY(activation.y)<=row&&row<=sequenceY(activation.y)+activation.h),sequenceAnchorX=(participantId,centerX,otherX,row)=>sequenceActivationAt(participantId,row)?centerX+(otherX>centerX?9:-9):centerX
 let previousMessageLabelBounds=null
 for(const edge of interactionRows){const edgeY=sequenceY(edge.y),fromCard=cardBackgrounds.get(edge.from),toCard=cardBackgrounds.get(edge.to),fromBounds=editor.getShapePageBounds(fromCard),toBounds=editor.getShapePageBounds(toCard),fromAnchor=sid('edge:'+edge.id+':from-anchor'),toAnchor=sid('edge:'+edge.id+':to-anchor'),fromX=sequenceAnchorX(edge.from,fromBounds.center.x,toBounds.center.x,edgeY),toX=sequenceAnchorX(edge.to,toBounds.center.x,fromBounds.center.x,edgeY);upsert(geo(fromAnchor,fromX-3,edgeY-3,6,6,'grey','none','none','',managed('edge:'+edge.id+':from-anchor',edge.id,'anchor',{lintIgnore:['tiny-shape']})),{position:'always'});upsert(geo(toAnchor,toX-3,edgeY-3,6,6,'grey','none','none','',managed('edge:'+edge.id+':to-anchor',edge.id,'anchor',{lintIgnore:['tiny-shape']})),{position:'always'});const a=editor.getShapePageBounds(fromAnchor).center,b=editor.getShapePageBounds(toAnchor).center;sequenceGeometryChecks.push({id:'anchors:'+edge.id,delta:Math.abs(a.x-fromX)+Math.abs(b.x-toX)+Math.abs(a.y-edgeY)+Math.abs(b.y-edgeY)});const arrow=arrowFor(edge,fromAnchor,toAnchor);arrowIds.push(arrow.id);const numbered=String(edge.step).padStart(2,'0')+'  '+edge.label,w=sequenceMessageWidth(numbered,Math.abs(b.x-a.x)),id=sid('edge:'+edge.id+':label');upsert(text(id,(a.x+b.x)/2-w/2,edgeY-74,w,numbered,'m','middle',managed('edge:'+edge.id+':label',edge.id,'label'),'black'),{position:'always'});const labelBounds=editor.getShapePageBounds(id),backgroundId=sid('edge:'+edge.id+':label-bg');upsert(geo(backgroundId,labelBounds.x-8,labelBounds.y-4,labelBounds.w+16,labelBounds.h+8,'white','solid','solid','',managed('edge:'+edge.id+':label-bg',edge.id,'message-label-background',{lintIgnore:['overlapping-text']})),{position:'always'});const backgroundBounds=editor.getShapePageBounds(backgroundId),minX=Math.min(a.x,b.x)+12,maxX=Math.max(a.x,b.x)-12,labelOverflow=Math.max(0,minX-labelBounds.x)+Math.max(0,labelBounds.maxX-maxX)+Math.max(0,labelBounds.maxY-(edgeY-8))+Math.max(0,labelBounds.h-64),rowOverlap=previousMessageLabelBounds?Math.max(0,previousMessageLabelBounds.maxY+16-labelBounds.y):0,backgroundOverflow=Math.max(0,backgroundBounds.x-labelBounds.x)+Math.max(0,labelBounds.maxX-backgroundBounds.maxX)+Math.max(0,backgroundBounds.y-labelBounds.y)+Math.max(0,labelBounds.maxY-backgroundBounds.maxY);sequenceGeometryChecks.push({id:'message-label:'+edge.id,delta:labelOverflow});sequenceGeometryChecks.push({id:'message-backing:'+edge.id,delta:backgroundOverflow});sequenceGeometryChecks.push({id:'message-row:'+edge.id,delta:rowOverlap});previousMessageLabelBounds=labelBounds;labelBackgrounds.push(backgroundId);edgeForeground.push(id)}
}else{
 // Data-model connectors bind to precise card sides instead of card centres. Auto
 // binding sends tldraw's elbow corridor down a card's centre line, which tunnels the
 // route behind every card in that column and reads as a chain of relationships that
 // does not exist. Choosing the facing sides puts the corridor in the layout gutter,
 // and spreading anchors along each side keeps parallel connectors and their terminals
 // from stacking on one point.
 const sidePlans=new Map(),sideAlternates=new Map(),selfSidePlans=new Map(),sideUse=new Map(),acceptedRoutes=[]
 function planSide(nodeId,side,edgeId,other,preferredFraction){const key=nodeId+'|'+side;if(!sideUse.has(key))sideUse.set(key,[]);const own=editor.getShapePageBounds(cardBackgrounds.get(nodeId)),coordinate=side==='left'||side==='right'?(other.center.y-own.y)/Math.max(1,own.h):(other.center.x-own.x)/Math.max(1,own.w),sortKey=preferredFraction??Math.max(0,Math.min(1,coordinate)),list=sideUse.get(key);if(!list.some(item=>item.edgeId===edgeId))list.push({edgeId,coordinate:sortKey,preferredFraction})}
 function selfSide(nodeId){const bounds=editor.getShapePageBounds(cardBackgrounds.get(nodeId)),nearby=payload.nodes.map(node=>({node,bounds:editor.getShapePageBounds(cardBackgrounds.get(node.id))})).filter(item=>item.node.id!==nodeId&&item.bounds.maxY>bounds.y&&item.bounds.y<bounds.maxY),rightBlocked=nearby.some(item=>item.bounds.x<bounds.maxX+240&&item.bounds.maxX>bounds.maxX);return rightBlocked?'left':'right'}
 function facingSides(from,to){const gap=20
  if(to.x>=from.maxX+gap)return{from:'right',to:'left'}
  if(from.x>=to.maxX+gap)return{from:'left',to:'right'}
  if(to.y>=from.maxY+gap)return{from:'bottom',to:'top'}
  if(from.y>=to.maxY+gap)return{from:'top',to:'bottom'}
  return null}
 function alternateSides(from,to){const gap=20
  if(to.y>=from.maxY+gap)return{from:'bottom',to:'top'}
  if(from.y>=to.maxY+gap)return{from:'top',to:'bottom'}
  if(to.x>=from.maxX+gap)return{from:'right',to:'left'}
  if(from.x>=to.maxX+gap)return{from:'left',to:'right'}
  return null}
 if(FAMILY==='data_model'){for(const edge of payload.edges){if(edge.from===edge.to){const bounds=editor.getShapePageBounds(cardBackgrounds.get(edge.from)),fallback=selfSide(edge.from),sides={from:fallback,to:fallback},loops=payload.edges.filter(item=>item.from===edge.from&&item.to===edge.to).sort((left,right)=>left.id.localeCompare(right.id)),index=Math.max(0,loops.findIndex(item=>item.id===edge.id)),slots=Math.max(2,loops.length*2),preferred=slot=>0.16+0.68*(slot/(slots-1));selfSidePlans.set(edge.id,sides);planSide(edge.from,sides.from,edge.id+':from',bounds,preferred(index*2));planSide(edge.to,sides.to,edge.id+':to',bounds,preferred(index*2+1));continue}const from=editor.getShapePageBounds(cardBackgrounds.get(edge.from)),to=editor.getShapePageBounds(cardBackgrounds.get(edge.to));if(!from||!to)continue
  const options=[];for(const candidate of [facingSides(from,to),alternateSides(from,to)])if(candidate&&!options.some(item=>item.from===candidate.from&&item.to===candidate.to))options.push(candidate);const primary=options[0];if(primary)sidePlans.set(edge.id,primary);if(options.length>1)sideAlternates.set(edge.id,options.slice(1))
  for(const candidate of options){planSide(edge.from,candidate.from,edge.id,to);planSide(edge.to,candidate.to,edge.id,from)}}}
 function anchorFraction(nodeId,side,edgeId){const list=sideUse.get(nodeId+'|'+side);if(!list?.length)return 0.5
  const ordered=[...list].sort((left,right)=>(left.preferredFraction??left.coordinate)-(right.preferredFraction??right.coordinate)||left.edgeId.localeCompare(right.edgeId)),bounds=editor.getShapePageBounds(cardBackgrounds.get(nodeId)),extent=side==='left'||side==='right'?bounds.h:bounds.w,sourceOrdered=ordered.some(item=>item.preferredFraction!==undefined),minGap=Math.min(0.24,(sourceOrdered?36:46)/Math.max(1,extent)),low=sourceOrdered?0.04:0.08,high=sourceOrdered?0.96:0.92
  const desired=ordered.map((item,index)=>Math.max(low,Math.min(high,item.preferredFraction??(ordered.length===1?0.5:0.16+0.68*(index/(ordered.length-1))))))
  for(let i=1;i<desired.length;i++)desired[i]=Math.max(desired[i],desired[i-1]+minGap)
  if(desired.at(-1)>high){desired[desired.length-1]=high;for(let i=desired.length-2;i>=0;i--)desired[i]=Math.min(desired[i],desired[i+1]-minGap)}
  if(desired[0]<low){const shift=low-desired[0];for(let i=0;i<desired.length;i++)desired[i]+=shift}
  const index=ordered.findIndex(item=>item.edgeId===edgeId)
  return Math.round(Math.max(low,Math.min(high,desired[index]??0.5))*1000)/1000}
 function anchorFor(side,fraction){return side==='right'?{x:1,y:fraction}:side==='left'?{x:0,y:fraction}:side==='top'?{x:fraction,y:0}:{x:fraction,y:1}}
 function applySides(arrow,edge,sides){const bindings=editor.getBindingsFromShape(arrow.id,'arrow')
  for(const binding of bindings){const isStart=binding.props.terminal==='start',side=isStart?sides.from:sides.to
   const nodeId=isStart?edge.from:edge.to,fraction=anchorFraction(nodeId,side,edge.id)
   editor.updateBinding({...binding,props:{...binding.props,isPrecise:true,normalizedAnchor:anchorFor(side,fraction)}})}}
 function clearSides(arrow){const bindings=editor.getBindingsFromShape(arrow.id,'arrow')
  for(const binding of bindings)editor.updateBinding({...binding,props:{...binding.props,isPrecise:false,normalizedAnchor:{x:0.5,y:0.5}}})}
 function pageSegments(arrow,info){const points=info.type==='elbow'?(info.route?.points??[]):[];if(points.length<2)return[];const tx=editor.getShapePageTransform(arrow.id),page=points.map(point=>tx.applyToPoint(point)),segments=[];for(let i=1;i<page.length;i++)segments.push({a:page[i-1],b:page[i]});return segments}
 function crossing(a,b){const ah=Math.abs(a.a.y-a.b.y)<0.5,bh=Math.abs(b.a.y-b.b.y)<0.5;if(ah===bh)return false;const h=ah?a:b,v=ah?b:a,x=v.a.x,y=h.a.y;return x>Math.min(h.a.x,h.b.x)+1&&x<Math.max(h.a.x,h.b.x)-1&&y>Math.min(v.a.y,v.b.y)+1&&y<Math.max(v.a.y,v.b.y)-1}
 function sharedRun(a,b){const ah=Math.abs(a.a.y-a.b.y)<0.5,bh=Math.abs(b.a.y-b.b.y)<0.5;if(ah!==bh)return 0;const overlap=(a1,a2,b1,b2)=>Math.max(0,Math.min(Math.max(a1,a2),Math.max(b1,b2))-Math.max(Math.min(a1,a2),Math.min(b1,b2)));if(ah)return Math.abs(a.a.y-b.a.y)<1?overlap(a.a.x,a.b.x,b.a.x,b.b.x):0;return Math.abs(a.a.x-b.a.x)<1?overlap(a.a.y,a.b.y,b.a.y,b.b.y):0}
 function routeTraffic(edge,segments){const crosses=new Set(),shares=new Set();let shared=0,length=0;for(const segment of segments)length+=Math.abs(segment.a.x-segment.b.x)+Math.abs(segment.a.y-segment.b.y);for(const prior of acceptedRoutes){if(edge.from===prior.from||edge.from===prior.to||edge.to===prior.from||edge.to===prior.to)continue;for(const a of segments)for(const b of prior.segments){if(crossing(a,b))crosses.add(prior.id);const run=sharedRun(a,b);if(run>12){shared+=run;shares.add(prior.id)}}}return{crosses:[...crosses],shares:[...shares],shared,length}}
 function scoreBetter(left,right){for(let i=0;i<left.length;i++){if(left[i]<right[i])return true;if(left[i]>right[i])return false}return false}
 function preciseTerminal(arrow,terminal,side,fraction){const binding=editor.getBindingsFromShape(arrow.id,'arrow').find(item=>item.props.terminal===terminal);if(binding)editor.updateBinding({...binding,props:{...binding.props,isPrecise:true,normalizedAnchor:anchorFor(side,fraction)}})}
 function outsidePoint(bounds,side,fraction,offset){return side==='right'?{x:bounds.maxX+offset,y:bounds.y+bounds.h*fraction}:side==='left'?{x:bounds.x-offset,y:bounds.y+bounds.h*fraction}:side==='top'?{x:bounds.x+bounds.w*fraction,y:bounds.y-offset}:{x:bounds.x+bounds.w*fraction,y:bounds.maxY+offset}}
 function renderSelfEdge(edge,cardId){const bounds=editor.getShapePageBounds(cardId),loops=payload.edges.filter(item=>item.from===edge.from&&item.to===edge.to).sort((left,right)=>left.id.localeCompare(right.id)),index=Math.max(0,loops.findIndex(item=>item.id===edge.id)),fallback=selfSide(edge.from),sides=selfSidePlans.get(edge.id)??{from:fallback,to:fallback},fromFraction=anchorFraction(edge.from,sides.from,edge.id+':from'),toFraction=anchorFraction(edge.to,sides.to,edge.id+':to'),offset=88+index*54,fromPoint=outsidePoint(bounds,sides.from,fromFraction,offset),toPoint=outsidePoint(bounds,sides.to,toFraction,offset),upperId=sid('edge:'+edge.id+':self-upper'),lowerId=sid('edge:'+edge.id+':self-lower')
  upsert(geo(upperId,fromPoint.x-3,fromPoint.y-3,6,6,'white','none','solid','',managed('edge:'+edge.id+':self-upper',edge.id,'self-loop-anchor',{lintIgnore:['tiny-shape']})),{position:'always'});upsert(geo(lowerId,toPoint.x-3,toPoint.y-3,6,6,'white','none','solid','',managed('edge:'+edge.id+':self-lower',edge.id,'self-loop-anchor',{lintIgnore:['tiny-shape']})),{position:'always'})
  const outward=arrowFor(edge,cardId,upperId,'arrow'),middle=arrowFor(edge,upperId,lowerId,'self-middle'),returning=arrowFor(edge,lowerId,cardId,'self-return');arrowIds.push(outward.id,middle.id,returning.id);preciseTerminal(outward,'start',sides.from,fromFraction);preciseTerminal(returning,'end',sides.to,toFraction)
  const outwardInfo=getArrowInfo(editor,editor.getShape(outward.id)),middleInfo=getArrowInfo(editor,editor.getShape(middle.id)),returnInfo=getArrowInfo(editor,editor.getShape(returning.id));if(!outwardInfo||!middleInfo||!returnInfo)throw new Error('No recursive connector geometry for '+edge.id)
  const segments=[...pageSegments(editor.getShape(outward.id),outwardInfo),...pageSegments(editor.getShape(middle.id),middleInfo),...pageSegments(editor.getShape(returning.id),returnInfo)],traffic=routeTraffic(edge,segments),obstructed=new Set([...routeObstructions(editor.getShape(outward.id),outwardInfo,edge),...routeObstructions(editor.getShape(middle.id),middleInfo,edge),...routeObstructions(editor.getShape(returning.id),returnInfo,edge)]);acceptedRoutes.push({id:edge.id,from:edge.from,to:edge.to,segments});if(obstructed.size)routeChecks.push({id:edge.id,obstructedBy:[...obstructed]});if(traffic.crosses.length)routeCrossingChecks.push({id:edge.id,crosses:traffic.crosses});if(traffic.shares.length)sharedCorridorChecks.push({id:edge.id,sharesWith:traffic.shares})
  const first=terminalGeometry(editor.getShape(outward.id),outwardInfo),last=terminalGeometry(editor.getShape(returning.id),returnInfo),firstTx=editor.getShapePageTransform(outward.id),lastTx=editor.getShapePageTransform(returning.id),start=firstTx.applyToPoint(first.start),end=lastTx.applyToPoint(last.end),sv={x:-first.startInward.x,y:-first.startInward.y},ev=last.endInward,fromMarker=ensureMarker(edge,'from-marker',edge.fromMarkerAssetId,start,Math.atan2(first.startInward.y,first.startInward.x)),toMarker=ensureMarker(edge,'to-marker',edge.toMarkerAssetId,end,Math.atan2(ev.y,ev.x)),fromOrientation=fromMarker.body.x*sv.x+fromMarker.body.y*sv.y,toOrientation=toMarker.body.x*(-ev.x)+toMarker.body.y*(-ev.y);markerChecks.push({id:edge.id,fromDelta:fromMarker.delta,toDelta:toMarker.delta,fromOrientation,toOrientation})
 }
 const edgeDegree=new Map();for(const edge of payload.edges){edgeDegree.set(edge.from,(edgeDegree.get(edge.from)??0)+1);edgeDegree.set(edge.to,(edgeDegree.get(edge.to)??0)+1)}
 const orderedEdges=[...payload.edges].sort((left,right)=>Math.max(edgeDegree.get(right.from)??0,edgeDegree.get(right.to)??0)-Math.max(edgeDegree.get(left.from)??0,edgeDegree.get(left.to)??0)||left.id.localeCompare(right.id))
 for(const edge of orderedEdges){const fromId=cardBackgrounds.get(edge.from),toId=cardBackgrounds.get(edge.to);if(!fromId||!toId)continue;if(FAMILY==='data_model'&&edge.from===edge.to){renderSelfEdge(edge,fromId);continue}const arrow=arrowFor(edge,fromId,toId);arrowIds.push(arrow.id);const info=getArrowInfo(editor,arrow);if(!info)throw new Error('No connector geometry for '+edge.id);if(FAMILY!=='data_model'){const tx=editor.getShapePageTransform(arrow.id),middle=midpoint(arrow,info),w=labelWidth(edge.label),labelId=sid('edge:'+edge.id+':label');upsert(geo(labelId,middle.x-w/2,middle.y-20,w,40,'blue','solid','solid',edge.label,managed('edge:'+edge.id+':label',edge.id,'label',{lintIgnore:['overlapping-text','growY-on-shape']})),{position:'always'});edgeForeground.push(labelId)}
  if(FAMILY==='data_model'){
   const primary=sidePlans.get(edge.id),alternates=sideAlternates.get(edge.id)??[]
   const measure=()=>{const shape=editor.getShape(arrow.id),shapeInfo=getArrowInfo(editor,shape);if(!shapeInfo)return null;const hits=routeObstructions(shape,shapeInfo,edge),segments=pageSegments(shape,shapeInfo),traffic=routeTraffic(edge,segments);return{shapeInfo,hits,segments,traffic,score:[hits.length,traffic.crosses.length,traffic.shared,traffic.length]}}
   let best=null
   const candidates=[]
   if(primary)candidates.push(primary)
   candidates.push(...alternates)
   for(const candidate of candidates){applySides(editor.getShape(arrow.id),edge,candidate);const measured=measure();if(measured&&(!best||scoreBetter(measured.score,best.score)))best={apply:candidate,...measured}}
   if(best?.apply)applySides(editor.getShape(arrow.id),edge,best.apply);else clearSides(editor.getShape(arrow.id))
   const current=editor.getShape(arrow.id),finalInfo=getArrowInfo(editor,current)
   if(!finalInfo)throw new Error('No connector geometry for '+edge.id)
   const segments=pageSegments(current,finalInfo),traffic=routeTraffic(edge,segments),obstructedBy=routeObstructions(current,finalInfo,edge);acceptedRoutes.push({id:edge.id,from:edge.from,to:edge.to,segments});if(obstructedBy.length)routeChecks.push({id:edge.id,obstructedBy});if(traffic.crosses.length)routeCrossingChecks.push({id:edge.id,crosses:traffic.crosses});if(traffic.shares.length)sharedCorridorChecks.push({id:edge.id,sharesWith:traffic.shares})
   const tx=editor.getShapePageTransform(current.id),g=terminalGeometry(current,finalInfo),start=tx.applyToPoint(g.start),end=tx.applyToPoint(g.end),sv={x:-g.startInward.x,y:-g.startInward.y},ev=g.endInward,sa=Math.atan2(g.startInward.y,g.startInward.x),ea=Math.atan2(ev.y,ev.x),fromMarker=ensureMarker(edge,'from-marker',edge.fromMarkerAssetId,start,sa),toMarker=ensureMarker(edge,'to-marker',edge.toMarkerAssetId,end,ea),fromOrientation=fromMarker.body.x*sv.x+fromMarker.body.y*sv.y,toOrientation=toMarker.body.x*(-ev.x)+toMarker.body.y*(-ev.y)
   markerChecks.push({id:edge.id,fromDelta:fromMarker.delta,toDelta:toMarker.delta,fromOrientation,toOrientation})
  }
 }
}
if(arrowIds.length)editor.sendToBack(arrowIds)
if(lifelineIds.length)editor.sendToBack(lifelineIds)
// tldraw keeps a bound arrow above the shapes it binds to, so sendToBack alone still
// leaves connectors painted across card interiors. Re-front the object cards after the
// connectors exist, then re-front page-level decorations so terminals stay visible.
if(FAMILY!=='sequence'){const groupIds=[...nodeGroups.values()].filter(id=>editor.getShape(id));if(groupIds.length)editor.bringToFront(groupIds)}
if(foreground.length)editor.bringToFront(foreground)
if(activationForeground.length)editor.bringToFront(activationForeground)
if(labelBackgrounds.length)editor.bringToFront(labelBackgrounds)
if(edgeForeground.length)editor.bringToFront(edgeForeground)
function intersectingBounds(a,b){const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),maxX=Math.min(a.maxX,b.maxX),maxY=Math.min(a.maxY,b.maxY);return maxX>x&&maxY>y?{x,y,maxX,maxY}:null}
function containsBounds(outer,inner){return outer.x<=inner.x&&outer.y<=inner.y&&outer.maxX>=inner.maxX&&outer.maxY>=inner.maxY}
if(FAMILY==='sequence'){
 const shapeIndex=new Map(editor.getCurrentPageShapes().map(shape=>[shape.id,shape.index])),isAbove=(frontId,backId)=>String(shapeIndex.get(frontId)??'')>String(shapeIndex.get(backId)??'')
 for(const edge of payload.sequenceInteractions??[]){const labelId=sid('edge:'+edge.id+':label'),backgroundId=sid('edge:'+edge.id+':label-bg'),labelBounds=editor.getShapePageBounds(labelId),backgroundBounds=editor.getShapePageBounds(backgroundId);sequenceGeometryChecks.push({id:'message-layer:'+edge.id,delta:isAbove(labelId,backgroundId)?0:2});for(const node of payload.nodes){const lifelineId=sid('node:'+node.id+':lifeline'),intersection=intersectingBounds(labelBounds,editor.getShapePageBounds(lifelineId));if(intersection){const masked=containsBounds(backgroundBounds,intersection)&&isAbove(backgroundId,lifelineId)&&isAbove(labelId,backgroundId);sequenceGeometryChecks.push({id:'message-lifeline:'+edge.id+':'+node.id,delta:masked?0:2})}}for(const activation of payload.sequenceActivations??[]){const activationId=sid('node:'+activation.participantId+':activation:'+activation.id),intersection=intersectingBounds(labelBounds,editor.getShapePageBounds(activationId));if(intersection){const masked=containsBounds(backgroundBounds,intersection)&&isAbove(backgroundId,activationId)&&isAbove(labelId,backgroundId);sequenceGeometryChecks.push({id:'message-activation:'+edge.id+':'+activation.id,delta:masked?0:2})}}}
}else if(FAMILY==='data_model'){
 for(let i=0;i<markerShapes.length;i++)for(let j=i+1;j<markerShapes.length;j++){const first=markerShapes[i],second=markerShapes[j],intersection=intersectingBounds(editor.getShapePageBounds(first.id),editor.getShapePageBounds(second.id));if(intersection&&intersection.maxX-intersection.x>1&&intersection.maxY-intersection.y>1)markerOverlapChecks.push({first:first.semantic,second:second.semantic})}
}
const typographyChecks=[]
if(FAMILY==='data_model'){for(const node of payload.nodes){const label=editor.getShape(sid('node:'+node.id+':label')),api=editor.getShape(sid('node:'+node.id+':api'));if(label&&api){const lb=editor.getShapePageBounds(label.id),ab=editor.getShapePageBounds(api.id),apiText=helpers.richTextToPlainText(api.props.richText).trim();typographyChecks.push({id:node.id,apiGap:Math.round((ab.y-lb.maxY)*100)/100,formatValid:/^\\([^()]+\\)$/.test(apiText)&&!/^\\(API\\s/i.test(apiText)})}}}
editor.selectNone()
editor.zoomToFit({animation:{duration:180}})
const lints=helpers.getLints().lints
const blockers=[]
if(lints.length)blockers.push({code:'canvas_lints',message:lints.map(lint=>lint.message).join('; ')})
if(bindingChecks.some(check=>!check.valid))blockers.push({code:'semantic_binding_mismatch',message:'One or more semantic connectors are bound to the wrong managed endpoints.'})
if(sequenceGeometryChecks.some(check=>check.delta>1))blockers.push({code:'sequence_geometry_mismatch',message:'One or more sequence lanes, activations, anchors, or labels violate the deterministic profile geometry.'})
if(markerChecks.some(check=>check.fromDelta>1||check.toDelta>1))blockers.push({code:'marker_terminal_mismatch',message:'One or more cardinality markers are not attached to actual connector terminals.'})
if(markerChecks.some(check=>check.fromOrientation<=0||check.toOrientation<=0))blockers.push({code:'marker_orientation_mismatch',message:'One or more cardinality markers point into a card instead of outward along the relationship.'})
if(markerOverlapChecks.length)blockers.push({code:'marker_overlap',message:markerOverlapChecks.length+' cardinality marker pair(s) overlap; enlarge the affected hub or redistribute its ports.'})
if(cardContentChecks.some(check=>check.overflow>1))blockers.push({code:'card_content_overflow',message:'One or more object cards do not fully contain their logical label, API name, or key fields.'})
if(typographyChecks.some(check=>Math.abs(check.apiGap-8)>0.5))blockers.push({code:'api_typography_gap',message:'One or more API names are not eight canvas units below the logical label.'})
if(typographyChecks.some(check=>!check.formatValid))blockers.push({code:'api_typography_format',message:'One or more API names are not parenthesized or include a forbidden API prefix.'})
if(routeChecks.length)payload.warnings=[...payload.warnings,routeChecks.length+' relationship connector(s) route behind an unrelated object card ('+routeChecks.slice(0,6).map(check=>check.id).join(', ')+'); the binding is correct but consider render_mode="relayout" or a narrower scope for readability.']
if(routeCrossingChecks.length)payload.warnings=[...payload.warnings,routeCrossingChecks.length+' relationship connector(s) cross an independent route; the renderer selected the lowest-traffic deterministic side plan.']
if(sharedCorridorChecks.length)payload.warnings=[...payload.warnings,sharedCorridorChecks.length+' relationship connector(s) share a collinear corridor; terminals remain distinct and semantically bound.']
const errorText=editor.getCurrentPageShapes().filter(shape=>shape.type==='text'&&(!shape.meta?.sfTldraw?.managed||shape.meta?.sfTldraw?.role==='renderer-error')).some(shape=>helpers.richTextToPlainText(shape.props.richText).trim()==='Error')
if(errorText)blockers.push({code:'renderer_error_text',message:'Renderer fallback Error text is present.'})
return{documentId:null,pageId,pageName:editor.getCurrentPage().name,family:FAMILY,createdShapes:counters.created,updatedShapes:counters.updated,deletedShapes:counters.deleted,readiness:{ready:blockers.length===0,blockers,warnings:payload.warnings,lintCount:lints.length,markerChecks,markerOverlapChecks,bindingChecks,sequenceGeometryChecks,typographyChecks,cardContentChecks,routeChecks,routeCrossingChecks,sharedCorridorChecks},lints}
`;
}
