/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { publishMarkdown, versionsTableMarkdown } from "../lib/render/lifecycle.ts";

describe("publishMarkdown", () => {
  it("renders successful inactive publish with bundle deployment evidence", () => {
    const md = publishMarkdown({
      ok: true,
      agent_api_name: "Pi_E2E_Final_Test",
      bot_id: "0XxRO0000004rTM",
      bot_version_id: "0XwRO0000004T0V",
      version_developer_name: "v3",
      was_new_agent: false,
      activated: false,
      authoring_bundle: {
        full_name: "Pi_E2E_Final_Test",
        target: "example-agent-target",
        created: false,
      },
      studio_url: "https://example.salesforce.com/agent-script/Pi_E2E_Final_Test",
    });
    expect(md).toMatch(/Published/);
    expect(md).toMatch(/Pi_E2E_Final_Test/);
    expect(md).toMatch(/new version/);
    expect(md).toMatch(/Local \+ server compile clean/);
    expect(md).toMatch(/AiAuthoringBundle/);
    expect(md).toMatch(/updated/);
    expect(md).toMatch(/Published .* inactive/);
    expect(md).toMatch(/v3/);
    expect(md).toMatch(/Open in Studio/);
    expect(md).toMatch(/agent-script\/Pi_E2E_Final_Test/);
    expect(md).toMatch(/bot_version_id=0XwRO/);
  });

  it("flags new-agent vs new-version", () => {
    const md = publishMarkdown({
      ok: true,
      agent_api_name: "Brand_New_Agent",
      bot_version_id: "x",
      was_new_agent: true,
    });
    expect(md).toMatch(/new agent/);
  });

  it("surfaces AiAuthoringBundle deploy errors with hint", () => {
    const md = publishMarkdown({
      ok: true,
      agent_api_name: "x",
      bot_version_id: "y",
      was_new_agent: false,
      authoring_bundle: {
        error: "Permission denied: AiAuthoringBundle is not visible to this user",
      },
    });
    expect(md).toMatch(/AiAuthoringBundle deploy failed/);
    expect(md).toMatch(/legacy builder/);
    expect(md).toMatch(/Permission denied/);
  });

  it("renders the required inactive release sequence after publish", () => {
    const md = publishMarkdown({
      ok: true,
      agent_api_name: "x",
      bot_version_id: "y",
      was_new_agent: false,
      activated: false,
    });
    expect(md).toMatch(/Published .* inactive/);
    expect(md).toMatch(/release eval contract/);
    expect(md).not.toMatch(/activate=true/);
  });

  it("recommends resolving remaining quality findings before activation", () => {
    const md = publishMarkdown({
      ok: true,
      agent_api_name: "x",
      bot_version_id: "y",
      was_new_agent: false,
      activated: false,
      quality_advisory: {
        count: 2,
        rule_ids: ["instruction-template-syntax", "unused-action"],
      },
    });

    expect(md).toContain("2 quality recommendation(s) remain");
    expect(md).toContain("instruction-template-syntax, unused-action");
    expect(md).toContain("resolve them before activation");
  });
});

describe("versionsTableMarkdown", () => {
  it("renders versions table with Active highlighted", () => {
    const md = versionsTableMarkdown({
      ok: true,
      agent_api_name: "Pi_E2E_Final_Test",
      bot_id: "0XxRO0000004rTM",
      versions: [
        {
          bot_version_id: "v3id",
          version_number: 3,
          status: "Active",
          created_date: "2026-05-10T19:14:00Z",
          developer_name: "v3",
        },
        {
          bot_version_id: "v2id",
          version_number: 2,
          status: "Inactive",
          created_date: "2026-05-10T18:02:00Z",
          developer_name: "v2",
        },
        {
          bot_version_id: "v1id",
          version_number: 1,
          status: "Inactive",
          created_date: "2026-05-10T17:30:00Z",
          developer_name: "v1",
        },
      ],
    });
    expect(md).toMatch(/Pi_E2E_Final_Test/);
    expect(md).toMatch(/bot_id 0XxRO/);
    expect(md).toMatch(/Active/);
    expect(md).toMatch(/Inactive/);
    expect(md).toMatch(/v3/);
    expect(md).toMatch(/v2/);
    expect(md).toMatch(/v1/);
    expect(md).toMatch(/2026-05-10/);
    expect(md).toMatch(/DeveloperName/);
  });

  it("sorts versions newest-first", () => {
    const md = versionsTableMarkdown({
      ok: true,
      agent_api_name: "x",
      bot_id: "id",
      versions: [
        { bot_version_id: "1", version_number: 1, status: "Inactive" },
        { bot_version_id: "3", version_number: 3, status: "Active" },
        { bot_version_id: "2", version_number: 2, status: "Inactive" },
      ],
    });
    const i3 = md.indexOf("v3");
    const i2 = md.indexOf("v2");
    const i1 = md.indexOf("v1");
    expect(i3).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i3);
    expect(i1).toBeGreaterThan(i2);
  });
});
