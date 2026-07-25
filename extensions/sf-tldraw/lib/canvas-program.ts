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
function geo(id,x,y,w,h,color='grey',fill='none',dash='solid',label='',meta={}){return{id,type:'geo',x,y,meta,props:{geo:'rectangle',w,h,color,fill,dash,size:'s',font:'sans',align:'middle',verticalAlign:'middle',richText:toRichText(label)}}}
function text(id,x,y,w,label,size='s',align='start',meta={}){return{id,type:'text',x,y,meta,props:{color:'black',size,font:'sans',textAlign:align,w,richText:toRichText(label),scale:1,autoSize:false}}}
function image(id,x,y,w,h,assetId,altText,rotation=0,meta={}){return{id,type:'image',x,y,rotation,meta,props:{w,h,playing:false,url:'',assetId,crop:null,flipX:false,flipY:false,altText}}}
function colorFor(node){if(FAMILY!=='data_model')return node.kind==='salesforce'?'blue':node.kind==='data_store'?'green':node.kind==='external'?'grey':'violet';return node.family==='custom'?'green':node.family==='external'?'grey':node.family==='special'?'violet':'blue'}
function fillFor(node){return node.family==='external'?'pattern':'semi'}
function wantedKeys(){const keys=new Set(['header:title','header:scope','header:grounding','header:legend']);for(const node of payload.nodes){for(const role of ['group','card','tile','icon','label'])keys.add('node:'+node.id+':'+role);if(node.apiName)keys.add('node:'+node.id+':api');if(node.subtitle)keys.add('node:'+node.id+':subtitle');if(node.keyFields?.length)keys.add('node:'+node.id+':keys');if(node.boundary)keys.add('node:'+node.id+':boundary');if(FAMILY==='sequence')keys.add('node:'+node.id+':lifeline');for(let i=0;i<(node.observations?.length??0);i++)keys.add('node:'+node.id+':observation:'+i)}for(const edge of payload.edges){for(const role of ['arrow','label'])keys.add('edge:'+edge.id+':'+role);if(FAMILY==='data_model'){keys.add('edge:'+edge.id+':from-marker');keys.add('edge:'+edge.id+':to-marker')}}for(const interaction of payload.sequenceInteractions??[]){keys.add('edge:'+interaction.id+':from-anchor');keys.add('edge:'+interaction.id+':to-anchor')}return keys}
const existingPage=editor.getPages().find(page=>page.name===payload.pageName)
const pageId=existingPage?.id??PageRecordType.createId('sf-tldraw-page-'+hash(payload.pageName))
if(!existingPage)editor.createPage({id:pageId,name:payload.pageName})
editor.setCurrentPage(pageId)
let pageShapes=editor.getCurrentPageShapes()
const wanted=wantedKeys()
const allManagedShapes=pageShapes.filter(shape=>shape.meta?.sfTldraw?.managed===true)
const managedShapes=allManagedShapes.filter(shape=>shape.meta?.sfTldraw?.family===FAMILY)
const remove=payload.renderMode==='replace'?allManagedShapes:managedShapes.filter(shape=>!wanted.has(keyOf(shape)))
if(remove.length){editor.deleteShapes(remove.map(shape=>shape.id));counters.deleted+=remove.length}
const assetRecords=payload.assets.filter(asset=>!editor.getAsset(AssetRecordType.createId(asset.id))).map(asset=>({id:AssetRecordType.createId(asset.id),typeName:'asset',type:'image',props:{name:asset.name,src:asset.src,w:asset.width,h:asset.height,mimeType:asset.mimeType,isAnimated:false},meta:{sfTldraw:{managed:true,schemaVersion:1},...(asset.attribution?{attribution:asset.attribution}:{})}}))
if(assetRecords.length)editor.createAssets(assetRecords)
function upsert(shape,{position='managed'}={}){const current=editor.getShape(shape.id);if(!current){editor.createShape(shape);counters.created++;return true}const update={id:shape.id,type:shape.type,props:shape.props,meta:shape.meta};if(position==='always'||(position==='managed'&&payload.renderMode!=='preserve')){update.x=shape.x;update.y=shape.y;if(shape.rotation!==undefined)update.rotation=shape.rotation}editor.updateShape(update);counters.updated++;return false}
const maxX=Math.max(1200,...payload.nodes.map(node=>node.x+node.w))+100
upsert(geo(sid('header:title'),40,20,maxX-80,78,'blue','none','solid',payload.title.toUpperCase(),managed('header:title','header','title')))
upsert(text(sid('header:scope'),80,116,Math.max(500,maxX-650),'Scope · '+payload.scope,'m','start',managed('header:scope','header','scope')))
upsert(text(sid('header:grounding'),80,164,Math.max(500,maxX-160),payload.groundingText,'s','start',managed('header:grounding','header','grounding')))
const legend=FAMILY==='data_model'?'bar/crow foot = declared cardinality · LK = lookup · MD = master-detail':FAMILY==='architecture'?'solid = direction · dashed = async/batch · dotted = dependency':'numbered messages · solid = request/event · dashed = response/async'
upsert(text(sid('header:legend'),80,214,Math.max(500,maxX-160),legend,'s','start',managed('header:legend','header','legend')))
const cardBackgrounds=new Map(),nodeGroups=new Map(),foreground=[]
for(const node of payload.nodes){
 const prefix='node:'+node.id+':'
 const ids={group:sid(prefix+'group'),card:sid(prefix+'card'),tile:sid(prefix+'tile'),icon:sid(prefix+'icon'),label:sid(prefix+'label'),api:sid(prefix+'api'),subtitle:sid(prefix+'subtitle'),keys:sid(prefix+'keys'),boundary:sid(prefix+'boundary')}
 const groupExists=!!editor.getShape(ids.group)
 const childIds=[]
 const cardFill=FAMILY==='architecture'?'none':fillFor(node)
 upsert(geo(ids.card,node.x,node.y,node.w,node.h,colorFor(node),cardFill,'solid','',managed(prefix+'card',node.id,'card')),{position:groupExists?'never':'managed'});childIds.push(ids.card);cardBackgrounds.set(node.id,ids.card)
 if(node.iconTileAssetId){upsert(image(ids.tile,node.x+22,node.y+28,78,78,AssetRecordType.createId(node.iconTileAssetId),node.label+' icon background',0,managed(prefix+'tile',node.id,'icon-tile')),{position:groupExists?'never':'managed'});childIds.push(ids.tile);foreground.push(ids.tile)}
 if(node.iconAssetId){upsert(image(ids.icon,node.x+22,node.y+28,78,78,AssetRecordType.createId(node.iconAssetId),node.label+' SLDS icon',0,managed(prefix+'icon',node.id,'icon')),{position:groupExists?'never':'managed'});childIds.push(ids.icon);foreground.push(ids.icon)}
 upsert(text(ids.label,node.x+116,node.y+34,node.w-136,node.label,'m','start',managed(prefix+'label',node.id,'label')),{position:groupExists?'never':'managed'});childIds.push(ids.label);foreground.push(ids.label)
 if(node.apiName){upsert(text(ids.api,node.x+116,node.y+88,node.w-136,'('+node.apiName+')','s','start',managed(prefix+'api',node.id,'api')),{position:groupExists?'never':'managed'});childIds.push(ids.api);foreground.push(ids.api)}
 if(node.subtitle){upsert(text(ids.subtitle,node.x+116,node.y+94,node.w-136,node.subtitle,'s','start',managed(prefix+'subtitle',node.id,'subtitle')),{position:groupExists?'never':'managed'});childIds.push(ids.subtitle);foreground.push(ids.subtitle)}
 if(node.keyFields?.length){upsert(text(ids.keys,node.x+116,node.y+144,node.w-136,node.keyFields.join(' · '),'s','start',managed(prefix+'keys',node.id,'keys')),{position:groupExists?'never':'managed'});childIds.push(ids.keys);foreground.push(ids.keys)}
 if(node.boundary){upsert(geo(ids.boundary,node.x+node.w-132,node.y-17,120,34,'grey','solid','solid',node.boundary,managed(prefix+'boundary',node.id,'boundary',{lintIgnore:['overlapping-text','growY-on-shape']})),{position:groupExists?'never':'managed'});childIds.push(ids.boundary);foreground.push(ids.boundary)}
 for(let i=0;i<(node.observations?.length??0);i++){const value=node.observations[i],isLdv=value.startsWith('LDV'),w=Math.min(230,Math.max(116,value.length*8+28)),x=isLdv?node.x+node.w-w-10:node.x+(node.w-w)/2,y=isLdv?node.y-18:node.y+node.h-18,id=sid(prefix+'observation:'+i);upsert(geo(id,x,y,w,36,isLdv?'orange':'blue','solid','solid',value,managed(prefix+'observation:'+i,node.id,'observation',{lintIgnore:['overlapping-text','growY-on-shape']})),{position:groupExists?'never':'managed'});childIds.push(id);foreground.push(id)}
 if(groupExists){const cardBounds=editor.getShapePageBounds(ids.card),ungrouped=childIds.filter(id=>editor.getShape(id)?.parentId!==ids.group);if(ungrouped.length){helpers.translateShapes(ungrouped,cardBounds.x-node.x,cardBounds.y-node.y);editor.reparentShapes(ungrouped,ids.group)}}
 if(node.apiName){const label=editor.getShape(ids.label),api=editor.getShape(ids.api),labelBounds=editor.getShapePageBounds(label.id),apiBounds=editor.getShapePageBounds(api.id);const dy=labelBounds.maxY+8-apiBounds.y;if(Math.abs(dy)>0.01)helpers.translateShapes([api.id],0,dy)}
 if(node.subtitle){const label=editor.getShape(ids.label),subtitle=editor.getShape(ids.subtitle),labelBounds=editor.getShapePageBounds(label.id),subtitleBounds=editor.getShapePageBounds(subtitle.id);const dy=labelBounds.maxY+10-subtitleBounds.y;if(Math.abs(dy)>0.01)helpers.translateShapes([subtitle.id],0,dy)}
 if(!groupExists){const present=childIds.filter(id=>editor.getShape(id));if(present.length>1){editor.groupShapes(present,{groupId:ids.group,select:false});counters.created++;editor.updateShape({id:ids.group,type:'group',meta:managed(prefix+'group',node.id,'group')})}}
 else if(payload.renderMode==='relayout'){const bounds=editor.getShapePageBounds(ids.group);helpers.translateShapes([ids.group],node.x-bounds.x,node.y-bounds.y)}
 nodeGroups.set(node.id,ids.group)
}
const arrowIds=[],edgeForeground=[],markerChecks=[],bindingChecks=[],sequenceGeometryChecks=[]
function bindingsMatch(arrow,fromId,toId){const bindings=editor.getBindingsFromShape(arrow.id,'arrow'),start=bindings.find(binding=>binding.props.terminal==='start'),end=bindings.find(binding=>binding.props.terminal==='end');return start?.toId===fromId&&end?.toId===toId}
function arrowFor(edge,fromId,toId){const key='edge:'+edge.id+':arrow';let arrow=editor.getCurrentPageShapes().find(shape=>shape.type==='arrow'&&keyOf(shape)===key);if(arrow&&!bindingsMatch(arrow,fromId,toId)){editor.deleteShapes([arrow.id]);counters.deleted++;arrow=null}if(!arrow){const id=helpers.createArrowBetweenShapes(fromId,toId,{arrowheadStart:'none',arrowheadEnd:FAMILY==='data_model'?'none':'arrow',richText:toRichText('')});arrow=editor.getShape(id);counters.created++}const dash=FAMILY==='data_model'?'solid':edge.meaning==='async_or_batch'||edge.meaning==='response'||edge.meaning==='async'?'dashed':edge.meaning==='dependency'?'dotted':'solid';editor.updateShape({id:arrow.id,type:'arrow',meta:managed(key,edge.id,'arrow',{sfRelationId:edge.id,sfFrom:edge.from,sfTo:edge.to}),props:{kind:'arc',bend:0,color:'grey',dash,size:'s',font:'sans',arrowheadStart:'none',arrowheadEnd:FAMILY==='data_model'?'none':'arrow',richText:toRichText('')}});counters.updated++;const updated=editor.getShape(arrow.id);bindingChecks.push({id:edge.id,valid:bindingsMatch(updated,fromId,toId)});return updated}
function midpoint(arrow,info){const tx=editor.getShapePageTransform(arrow.id);if(info.middle)return tx.applyToPoint(info.middle);return{x:(tx.applyToPoint(info.start.point).x+tx.applyToPoint(info.end.point).x)/2,y:(tx.applyToPoint(info.start.point).y+tx.applyToPoint(info.end.point).y)/2}}
function placeFromLocalAnchor(target,anchor,angle){const c=Math.cos(angle),s=Math.sin(angle);return{x:target.x-(anchor.x*c-anchor.y*s),y:target.y-(anchor.x*s+anchor.y*c)}}
function ensureMarker(edge,role,assetId,target,angle){const asset=payload.assets.find(item=>item.id===assetId),anchor=asset.anchor,id=sid('edge:'+edge.id+':'+role),position=placeFromLocalAnchor(target,anchor,angle),shape=image(id,position.x,position.y,asset.width,asset.height,AssetRecordType.createId(asset.id),role,angle,managed('edge:'+edge.id+':'+role,edge.id,role));upsert(shape,{position:'always'});const transform=editor.getShapePageTransform(id),actual=transform.applyToPoint(anchor),body=transform.applyToPoint({x:0,y:anchor.y});edgeForeground.push(id);return{delta:Math.hypot(actual.x-target.x,actual.y-target.y),body:{x:body.x-actual.x,y:body.y-actual.y}}}
function labelWidth(label){return Math.min(260,Math.max(62,label.length*9+28))}
if(FAMILY==='sequence'){
 const bottom=Math.max(760,...(payload.sequenceInteractions??[]).map(item=>item.y))+130
 for(const node of payload.nodes){const cardId=cardBackgrounds.get(node.id),cardBounds=editor.getShapePageBounds(cardId),id=sid('node:'+node.id+':lifeline');upsert(geo(id,cardBounds.center.x-1,cardBounds.maxY,2,Math.max(80,bottom-cardBounds.maxY),'grey','solid','dashed','',managed('node:'+node.id+':lifeline',node.id,'lifeline')),{position:'always'});const lineBounds=editor.getShapePageBounds(id);sequenceGeometryChecks.push({id:'lifeline:'+node.id,delta:Math.abs(lineBounds.center.x-cardBounds.center.x)+Math.abs(lineBounds.y-cardBounds.maxY)});foreground.push(id)}
 for(const edge of payload.sequenceInteractions??[]){const fromCard=cardBackgrounds.get(edge.from),toCard=cardBackgrounds.get(edge.to),fromBounds=editor.getShapePageBounds(fromCard),toBounds=editor.getShapePageBounds(toCard),fromAnchor=sid('edge:'+edge.id+':from-anchor'),toAnchor=sid('edge:'+edge.id+':to-anchor');upsert(geo(fromAnchor,fromBounds.center.x-3,edge.y-3,6,6,'grey','none','none','',managed('edge:'+edge.id+':from-anchor',edge.id,'anchor',{lintIgnore:['tiny-shape']})),{position:'always'});upsert(geo(toAnchor,toBounds.center.x-3,edge.y-3,6,6,'grey','none','none','',managed('edge:'+edge.id+':to-anchor',edge.id,'anchor',{lintIgnore:['tiny-shape']})),{position:'always'});const a=editor.getShapePageBounds(fromAnchor).center,b=editor.getShapePageBounds(toAnchor).center;sequenceGeometryChecks.push({id:'anchors:'+edge.id,delta:Math.abs(a.x-fromBounds.center.x)+Math.abs(b.x-toBounds.center.x)+Math.abs(a.y-edge.y)+Math.abs(b.y-edge.y)});const arrow=arrowFor(edge,fromAnchor,toAnchor);arrowIds.push(arrow.id);const w=labelWidth(edge.label),id=sid('edge:'+edge.id+':label');upsert(geo(id,(a.x+b.x)/2-w/2,edge.y-52,w,40,'blue','solid','solid',edge.label,managed('edge:'+edge.id+':label',edge.id,'label',{lintIgnore:['overlapping-text','growY-on-shape']})),{position:'always'});edgeForeground.push(id)}
}else{
 for(const edge of payload.edges){const fromId=cardBackgrounds.get(edge.from),toId=cardBackgrounds.get(edge.to);if(!fromId||!toId)continue;const arrow=arrowFor(edge,fromId,toId);arrowIds.push(arrow.id);const info=getArrowInfo(editor,arrow);if(!info)throw new Error('No connector geometry for '+edge.id);const tx=editor.getShapePageTransform(arrow.id),middle=midpoint(arrow,info),w=labelWidth(edge.label),labelId=sid('edge:'+edge.id+':label');upsert(geo(labelId,middle.x-w/2,middle.y-20,w,40,'blue','solid','solid',edge.label,managed('edge:'+edge.id+':label',edge.id,'label',{lintIgnore:['overlapping-text','growY-on-shape']})),{position:'always'});edgeForeground.push(labelId)
  if(FAMILY==='data_model'){const start=tx.applyToPoint(info.start.point),end=tx.applyToPoint(info.end.point),sv={x:info.start.point.x-info.start.handle.x,y:info.start.point.y-info.start.handle.y},ev={x:info.end.handle.x-info.end.point.x,y:info.end.handle.y-info.end.point.y},sa=Math.atan2(sv.y,sv.x)+Math.PI,ea=Math.atan2(ev.y,ev.x),fromMarker=ensureMarker(edge,'from-marker',edge.fromMarkerAssetId,start,sa),toMarker=ensureMarker(edge,'to-marker',edge.toMarkerAssetId,end,ea),fromOrientation=fromMarker.body.x*sv.x+fromMarker.body.y*sv.y,toOrientation=toMarker.body.x*(-ev.x)+toMarker.body.y*(-ev.y);markerChecks.push({id:edge.id,fromDelta:fromMarker.delta,toDelta:toMarker.delta,fromOrientation,toOrientation})}
 }
}
if(arrowIds.length)editor.sendToBack(arrowIds)
if(foreground.length)editor.bringToFront(foreground)
if(edgeForeground.length)editor.bringToFront(edgeForeground)
const typographyChecks=[]
if(FAMILY==='data_model'){for(const node of payload.nodes){const label=editor.getShape(sid('node:'+node.id+':label')),api=editor.getShape(sid('node:'+node.id+':api'));if(label&&api){const lb=editor.getShapePageBounds(label.id),ab=editor.getShapePageBounds(api.id),apiText=helpers.richTextToPlainText(api.props.richText).trim();typographyChecks.push({id:node.id,apiGap:Math.round((ab.y-lb.maxY)*100)/100,formatValid:/^\\([^()]+\\)$/.test(apiText)&&!/^\\(API\\s/i.test(apiText)})}}}
editor.selectNone()
editor.zoomToFit({animation:{duration:180}})
const lints=helpers.getLints().lints
const blockers=[]
if(lints.length)blockers.push({code:'canvas_lints',message:lints.map(lint=>lint.message).join('; ')})
if(bindingChecks.some(check=>!check.valid))blockers.push({code:'semantic_binding_mismatch',message:'One or more semantic connectors are bound to the wrong managed endpoints.'})
if(sequenceGeometryChecks.some(check=>check.delta>1))blockers.push({code:'sequence_geometry_mismatch',message:'One or more sequence lifelines or anchors are detached from their participant.'})
if(markerChecks.some(check=>check.fromDelta>1||check.toDelta>1))blockers.push({code:'marker_terminal_mismatch',message:'One or more cardinality markers are not attached to actual connector terminals.'})
if(markerChecks.some(check=>check.fromOrientation<=0||check.toOrientation<=0))blockers.push({code:'marker_orientation_mismatch',message:'One or more cardinality markers point into a card instead of outward along the relationship.'})
if(typographyChecks.some(check=>Math.abs(check.apiGap-8)>0.5))blockers.push({code:'api_typography_gap',message:'One or more API names are not eight canvas units below the logical label.'})
if(typographyChecks.some(check=>!check.formatValid))blockers.push({code:'api_typography_format',message:'One or more API names are not parenthesized or include a forbidden API prefix.'})
const errorText=editor.getCurrentPageShapes().filter(shape=>shape.type==='text').some(shape=>helpers.richTextToPlainText(shape.props.richText).trim()==='Error')
if(errorText)blockers.push({code:'renderer_error_text',message:'Renderer fallback Error text is present.'})
return{documentId:null,pageId,pageName:editor.getCurrentPage().name,family:FAMILY,createdShapes:counters.created,updatedShapes:counters.updated,deletedShapes:counters.deleted,readiness:{ready:blockers.length===0,blockers,warnings:payload.warnings,lintCount:lints.length,markerChecks,bindingChecks,sequenceGeometryChecks,typographyChecks},lints}
`;
}
