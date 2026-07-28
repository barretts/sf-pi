/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_MODEL_TOP } from "../lib/layout.ts";
import { renderSalesforceDiagram } from "../lib/renderer.ts";
import { TldrawRuntimeClient } from "../lib/runtime-client.ts";

const liveIt = process.env.SF_TLDRAW_LIVE_SMOKE === "1" ? it : it.skip;

describe("sf-tldraw live runtime", () => {
  for (const testCase of [
    { fixture: "data-model", family: "data_model", page: "SF tldraw Data Model Smoke" },
    { fixture: "architecture", family: "architecture", page: "SF tldraw Architecture Smoke" },
    { fixture: "sequence", family: "sequence", page: "SF tldraw Sequence Smoke" },
    {
      fixture: "oauth-sequence",
      family: "sequence",
      page: "SF tldraw OAuth Sequence Smoke",
    },
  ] as const) {
    liveIt(
      `renders the grounded ${testCase.fixture} fixture with visual evidence`,
      async () => {
        const spec = JSON.parse(
          readFileSync(
            path.join(import.meta.dirname, "fixtures", `${testCase.fixture}.json`),
            "utf8",
          ),
        );
        if (testCase.family === "data_model") {
          spec.relationships[0].field_api_name = "AccountId";
          spec.relationships[0].from_label = "submitted by";
          spec.relationships[0].to_label = "reviewed by";
        }
        const outcome = await renderSalesforceDiagram(
          {
            family: testCase.family,
            spec,
            pageName: testCase.page,
            mode: "replace",
            outputMode: "file_only",
            ...(testCase.family === "data_model"
              ? { preferences: { legendRelationships: "show" as const } }
              : {}),
          },
          { cwd: process.cwd() },
        );
        if (outcome.ok === false) {
          throw new Error(
            `${outcome.reason}: ${outcome.message}\n${JSON.stringify(outcome.result?.readiness ?? outcome.validation ?? {}, null, 2)}`,
          );
        }
        expect(outcome.ok).toBe(true);
        expect(outcome.result.readiness).toMatchObject({ ready: true, lintCount: 0 });
        expect(
          outcome.result.readiness.markerChecks.every(
            (check) => check.fromDelta <= 1 && check.toDelta <= 1,
          ),
        ).toBe(true);
        if (testCase.family === "sequence") {
          expect(
            outcome.result.readiness.sequenceGeometryChecks.every((check) => check.delta <= 1),
          ).toBe(true);
        }
        if (testCase.family === "data_model") {
          const client = new TldrawRuntimeClient();
          const document = await client.resolveDocument(undefined);
          const connectorState = await client.execute<{
            relationshipTextCount: number;
            lookupStyles: Array<{ color: string; dash: string; size: string }>;
            legacyHeaderCount: number;
            relationshipLegendCount: number;
            relationshipLegendLabels: string[];
            relationshipLegendLines: Array<{ color: string; dash: string; size: string }>;
            titleAndLegendAreSeparate: boolean;
          }>(
            document.id,
            `
const page=editor.getPages().find(page=>page.name==='${testCase.page}')
editor.setCurrentPage(page.id)
const shapes=editor.getCurrentPageShapes()
const relationshipLegend=shapes.filter(shape=>String(shape.meta?.sfTldraw?.role??'').startsWith('relationship-legend-'))
const title=shapes.find(shape=>shape.meta?.sfTldraw?.role==='title'),legendBox=shapes.find(shape=>shape.meta?.sfTldraw?.role==='relationship-legend-box')
return{
 relationshipTextCount:shapes.filter(shape=>['from-label','to-label','field-label'].includes(shape.meta?.sfTldraw?.role)).length,
 lookupStyles:shapes.filter(shape=>shape.type==='arrow'&&shape.meta?.sfRelationshipType==='lookup').map(shape=>({color:shape.props.color,dash:shape.props.dash,size:shape.props.size})),
 legacyHeaderCount:shapes.filter(shape=>['scope','grounding','legend'].includes(shape.meta?.sfTldraw?.role)).length,
 relationshipLegendCount:relationshipLegend.length,
 relationshipLegendLabels:relationshipLegend.filter(shape=>shape.type==='text').map(shape=>helpers.richTextToPlainText(shape.props.richText)),
 relationshipLegendLines:relationshipLegend.filter(shape=>shape.type==='arrow').map(shape=>({color:shape.props.color,dash:shape.props.dash,size:shape.props.size})),
 titleAndLegendAreSeparate:editor.getShapePageBounds(title.id).maxY<editor.getShapePageBounds(legendBox.id).y
}
`,
          );
          expect(connectorState.relationshipTextCount).toBe(0);
          expect(connectorState.legacyHeaderCount).toBe(0);
          expect(connectorState.relationshipLegendCount).toBe(6);
          expect(connectorState.relationshipLegendLabels).toEqual([
            "RELATIONSHIPS",
            "Lookup Relationship",
            "Master-Detail Relationship",
          ]);
          expect(connectorState.relationshipLegendLines).toEqual([
            { color: "black", dash: "dotted", size: "m" },
            { color: "red", dash: "solid", size: "m" },
          ]);
          expect(connectorState.titleAndLegendAreSeparate).toBe(true);
          expect(connectorState.lookupStyles.length).toBeGreaterThan(0);
          expect(
            connectorState.lookupStyles.every(
              (style) => style.color === "black" && style.dash === "dotted" && style.size === "m",
            ),
          ).toBe(true);
        }
        expect(outcome.artifact.screenshotPath).toBeTruthy();
        expect(outcome.artifact.thumbnailPath).toBeTruthy();
      },
      60_000,
    );
  }

  liveIt(
    "toggles the Data Model Relationships legend without moving preserved cards",
    async () => {
      const client = new TldrawRuntimeClient();
      const pageName = "SF tldraw Legend Toggle Smoke";
      const spec = JSON.parse(
        readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
      );
      const baseline = await renderSalesforceDiagram(
        {
          family: "data_model",
          spec,
          pageName,
          mode: "replace",
          outputMode: "file_only",
          preferences: { legendRelationships: "show" },
        },
        { cwd: process.cwd(), client },
      );
      if (baseline.ok === false) throw new Error(baseline.message);
      const document = await client.resolveDocument(undefined);
      const before = await client.execute<{ x: number; y: number }>(
        document.id,
        `
const page=editor.getPages().find(page=>page.name==='SF tldraw Legend Toggle Smoke')
editor.setCurrentPage(page.id)
const card=editor.getCurrentPageShapes().find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='account')
const bounds=editor.getShapePageBounds(card.id)
return{x:bounds.x,y:bounds.y}
`,
      );
      const hidden = await renderSalesforceDiagram(
        {
          family: "data_model",
          spec,
          pageName,
          mode: "preserve",
          outputMode: "file_only",
          preferences: { legendRelationships: "hide" },
        },
        { cwd: process.cwd(), client },
      );
      if (hidden.ok === false) throw new Error(hidden.message);
      const hiddenState = await client.execute<{
        x: number;
        y: number;
        titleCount: number;
        relationshipLegendCount: number;
        legacyHeaderCount: number;
      }>(
        document.id,
        `
const page=editor.getPages().find(page=>page.name==='SF tldraw Legend Toggle Smoke')
editor.setCurrentPage(page.id)
const shapes=editor.getCurrentPageShapes(),card=shapes.find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='account'),bounds=editor.getShapePageBounds(card.id)
return{x:bounds.x,y:bounds.y,titleCount:shapes.filter(shape=>shape.meta?.sfTldraw?.role==='title').length,relationshipLegendCount:shapes.filter(shape=>String(shape.meta?.sfTldraw?.role??'').startsWith('relationship-legend-')).length,legacyHeaderCount:shapes.filter(shape=>['scope','grounding','legend'].includes(shape.meta?.sfTldraw?.role)).length}
`,
      );
      expect(hiddenState).toEqual({
        ...before,
        titleCount: 1,
        relationshipLegendCount: 0,
        legacyHeaderCount: 0,
      });
      const restored = await renderSalesforceDiagram(
        {
          family: "data_model",
          spec,
          pageName,
          mode: "preserve",
          outputMode: "file_only",
          preferences: { legendRelationships: "show" },
        },
        { cwd: process.cwd(), client },
      );
      if (restored.ok === false) throw new Error(restored.message);
      expect(
        await client.execute<number>(
          document.id,
          `const page=editor.getPages().find(page=>page.name==='SF tldraw Legend Toggle Smoke');editor.setCurrentPage(page.id);return editor.getCurrentPageShapes().filter(shape=>String(shape.meta?.sfTldraw?.role??'').startsWith('relationship-legend-')).length`,
        ),
      ).toBe(6);

      const compactPageName = "SF tldraw Legend Hidden Layout Smoke";
      const compact = await renderSalesforceDiagram(
        {
          family: "data_model",
          spec,
          pageName: compactPageName,
          mode: "replace",
          outputMode: "file_only",
          preferences: { legendRelationships: "hide" },
        },
        { cwd: process.cwd(), client },
      );
      if (compact.ok === false) throw new Error(compact.message);
      expect(
        await client.execute<{ minCardY: number; relationshipLegendCount: number }>(
          document.id,
          `const page=editor.getPages().find(page=>page.name==='SF tldraw Legend Hidden Layout Smoke');editor.setCurrentPage(page.id);const shapes=editor.getCurrentPageShapes();return{minCardY:Math.min(...shapes.filter(shape=>shape.meta?.sfTldraw?.role==='card').map(shape=>editor.getShapePageBounds(shape.id).y)),relationshipLegendCount:shapes.filter(shape=>String(shape.meta?.sfTldraw?.role??'').startsWith('relationship-legend-')).length}`,
        ),
      ).toEqual({ minCardY: DATA_MODEL_TOP.titleOnly, relationshipLegendCount: 0 });
    },
    60_000,
  );

  liveIt(
    "keeps sequence lifelines and anchors attached to a moved participant",
    async () => {
      const client = new TldrawRuntimeClient();
      const spec = JSON.parse(
        readFileSync(path.join(import.meta.dirname, "fixtures", "sequence.json"), "utf8"),
      );
      const baseline = await renderSalesforceDiagram(
        {
          family: "sequence",
          spec,
          pageName: "SF tldraw Sequence Smoke",
          mode: "replace",
          outputMode: "file_only",
        },
        { cwd: process.cwd(), client },
      );
      if (baseline.ok === false) throw new Error(baseline.message);
      const document = await client.resolveDocument(undefined);
      const moved = await client.execute<{ x: number; y: number }>(
        document.id,
        `
const page=editor.getPages().find(page=>page.name==='SF tldraw Sequence Smoke')
editor.setCurrentPage(page.id)
const shapes=editor.getCurrentPageShapes()
const group=shapes.find(shape=>shape.meta?.sfTldraw?.role==='group'&&shape.meta?.sfTldraw?.semanticId==='user')
const card=shapes.find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='user')
helpers.translateShapes([group.id],83,0)
const bounds=editor.getShapePageBounds(card.id)
return{x:bounds.x,y:bounds.y}
`,
      );
      const outcome = await renderSalesforceDiagram(
        {
          family: "sequence",
          spec,
          pageName: "SF tldraw Sequence Smoke",
          mode: "preserve",
          outputMode: "file_only",
        },
        { cwd: process.cwd(), client },
      );
      if (outcome.ok === false) throw new Error(outcome.message);
      expect(outcome.result.readiness.sequenceGeometryChecks.length).toBeGreaterThan(0);
      expect(
        outcome.result.readiness.sequenceGeometryChecks.every((check) => check.delta <= 1),
      ).toBe(true);
      const preserved = await client.execute<{ x: number; y: number }>(
        document.id,
        `
const page=editor.getPages().find(page=>page.name==='SF tldraw Sequence Smoke')
editor.setCurrentPage(page.id)
const card=editor.getCurrentPageShapes().find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='user')
const bounds=editor.getShapePageBounds(card.id)
return{x:bounds.x,y:bounds.y}
`,
      );
      expect(preserved).toEqual(moved);
    },
    60_000,
  );

  liveIt(
    "preserves moved cards, reconciles optional children, and repairs changed bindings",
    async () => {
      const client = new TldrawRuntimeClient();
      const document = await client.resolveDocument(undefined);
      const moved = await client.execute<{
        x: number;
        y: number;
        annotationId: string;
      }>(
        document.id,
        `
const {createShapeId,toRichText}=await import('tldraw')
const page=editor.getPages().find(page=>page.name==='SF tldraw Data Model Smoke')
editor.setCurrentPage(page.id)
const shapes=editor.getCurrentPageShapes()
const group=shapes.find(shape=>shape.meta?.sfTldraw?.role==='group'&&shape.meta?.sfTldraw?.semanticId==='account')
const card=shapes.find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='account')
const caseCard=shapes.find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='case')
const commentGroup=shapes.find(shape=>shape.meta?.sfTldraw?.role==='group'&&shape.meta?.sfTldraw?.semanticId==='case-comment')
const commentCard=shapes.find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='case-comment')
helpers.translateShapes([group.id],73,41)
const caseBounds=editor.getShapePageBounds(caseCard.id),commentBounds=editor.getShapePageBounds(commentCard.id)
helpers.translateShapes([commentGroup.id],caseBounds.x-commentBounds.x,caseBounds.maxY+180-commentBounds.y)
const annotationId=createShapeId('sf-tldraw-live-user-annotation')
if(!editor.getShape(annotationId))editor.createShape({id:annotationId,type:'note',x:80,y:920,props:{richText:toRichText('User annotation — preserve me')}})
for(const role of ['from-label','to-label','field-label']){
 const id=createShapeId('sf-tldraw-live-legacy-'+role)
 if(!editor.getShape(id))editor.createShape({id,type:'text',x:120,y:1040,props:{richText:toRichText(role)},meta:{sfTldraw:{managed:true,schemaVersion:1,family:'data_model',key:'edge:account-contacts:'+role,semanticId:'account-contacts',role}}})
 const backgroundRole=role+'-background',backgroundId=createShapeId('sf-tldraw-live-legacy-'+role+'-bg')
 if(!editor.getShape(backgroundId))editor.createShape({id:backgroundId,type:'geo',x:110,y:1030,props:{geo:'rectangle',w:140,h:40,fill:'solid',color:'white',richText:toRichText('')},meta:{sfTldraw:{managed:true,schemaVersion:1,family:'data_model',key:'edge:account-contacts:'+role+'-bg',semanticId:'account-contacts',role:backgroundRole}}})
}
for(const role of ['scope','grounding','legend']){
 const id=createShapeId('sf-tldraw-live-legacy-header-'+role)
 if(!editor.getShape(id))editor.createShape({id,type:'text',x:120,y:1120,props:{richText:toRichText(role)},meta:{sfTldraw:{managed:true,schemaVersion:1,family:'data_model',key:'header:'+role,semanticId:'header',role}}})
}
const bounds=editor.getShapePageBounds(card.id)
return{x:bounds.x,y:bounds.y,annotationId}
`,
      );
      const spec = JSON.parse(
        readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
      );
      spec.objects[0].key_fields = ["Name", "OwnerId"];
      spec.objects[0].observations = {
        row_count: { value: 2_400_000, exact: false },
        owd: "Private",
      };
      const preserved = await renderSalesforceDiagram(
        {
          family: "data_model",
          spec,
          pageName: "SF tldraw Data Model Smoke",
          mode: "preserve",
          outputMode: "file_only",
        },
        { cwd: process.cwd(), client },
      );
      if (preserved.ok === false) throw new Error(preserved.message);
      expect(
        preserved.result.readiness.markerChecks.find((check) => check.id === "case-comments"),
      ).toEqual(
        expect.objectContaining({
          fromDelta: 0,
          toDelta: 0,
          fromOrientation: expect.any(Number),
          toOrientation: expect.any(Number),
        }),
      );
      expect(
        preserved.result.readiness.markerChecks
          .filter((check) => check.id === "case-comments")
          .every((check) => check.fromOrientation > 0 && check.toOrientation > 0),
      ).toBe(true);
      const verified = await client.execute<{
        x: number;
        y: number;
        annotationExists: boolean;
        addedChildrenGrouped: boolean;
        legacyRelationshipTextCount: number;
        legacyHeaderCount: number;
      }>(
        document.id,
        `
const page=editor.getPages().find(page=>page.name==='SF tldraw Data Model Smoke')
editor.setCurrentPage(page.id)
const shapes=editor.getCurrentPageShapes()
const group=shapes.find(shape=>shape.meta?.sfTldraw?.role==='group'&&shape.meta?.sfTldraw?.semanticId==='account')
const card=shapes.find(shape=>shape.meta?.sfTldraw?.role==='card'&&shape.meta?.sfTldraw?.semanticId==='account')
const added=shapes.filter(shape=>shape.meta?.sfTldraw?.semanticId==='account'&&(shape.meta?.sfTldraw?.role==='keys'||shape.meta?.sfTldraw?.role==='observation'))
const bounds=editor.getShapePageBounds(card.id)
return{x:bounds.x,y:bounds.y,annotationExists:!!editor.getShape('${moved.annotationId}'),addedChildrenGrouped:added.length===3&&added.every(shape=>shape.parentId===group.id),legacyRelationshipTextCount:shapes.filter(shape=>['from-label','to-label','field-label','from-label-background','to-label-background','field-label-background'].includes(shape.meta?.sfTldraw?.role)).length,legacyHeaderCount:shapes.filter(shape=>['scope','grounding','legend'].includes(shape.meta?.sfTldraw?.role)).length}
`,
      );
      expect(verified).toMatchObject({
        x: moved.x,
        y: moved.y,
        annotationExists: true,
        addedChildrenGrouped: true,
        legacyRelationshipTextCount: 0,
        legacyHeaderCount: 0,
      });

      delete spec.objects[0].key_fields;
      delete spec.objects[0].observations;
      spec.relationships.find(
        (relationship: { id: string }) => relationship.id === "account-contacts",
      ).to = "case";
      const reconciled = await renderSalesforceDiagram(
        {
          family: "data_model",
          spec,
          pageName: "SF tldraw Data Model Smoke",
          mode: "preserve",
          outputMode: "file_only",
        },
        { cwd: process.cwd(), client },
      );
      if (reconciled.ok === false) throw new Error(reconciled.message);
      const finalState = await client.execute<{
        staleOptionalCount: number;
        bindingTargets: string[];
        annotationExists: boolean;
      }>(
        document.id,
        `
const page=editor.getPages().find(page=>page.name==='SF tldraw Data Model Smoke')
editor.setCurrentPage(page.id)
const shapes=editor.getCurrentPageShapes()
const arrow=shapes.find(shape=>shape.meta?.sfRelationId==='account-contacts')
const bindings=editor.getBindingsFromShape(arrow.id,'arrow').sort((a,b)=>a.props.terminal.localeCompare(b.props.terminal))
return{
 staleOptionalCount:shapes.filter(shape=>shape.meta?.sfTldraw?.semanticId==='account'&&(shape.meta?.sfTldraw?.role==='keys'||shape.meta?.sfTldraw?.role==='observation')).length,
 bindingTargets:bindings.map(binding=>editor.getShape(binding.toId)?.meta?.sfTldraw?.semanticId),
 annotationExists:!!editor.getShape('${moved.annotationId}')
}
`,
      );
      expect(finalState).toMatchObject({
        staleOptionalCount: 0,
        bindingTargets: ["case", "account"],
        annotationExists: true,
      });
    },
    60_000,
  );
});
