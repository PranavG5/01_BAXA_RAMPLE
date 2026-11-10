import "server-only";
import type { Asset, BusinessProfile } from "../../types";
import { asData } from "./claude";

export function profileBlock(p: BusinessProfile): string {
  const services = (p.services ?? []).map((s) => `- ${s.name}: ${s.price}${s.notes ? ` (${s.notes})` : ""}`).join("\n");
  return `<business_profile>
name: ${asData(p.name || "(not set)")}
type: ${p.business_type}
address: ${asData(p.address || "(not set)")}
booking_link: ${asData(p.booking_link || "(not set)")}
tone: ${asData(p.tone || "(not set)")}
usual_audience: ${asData(p.audience || "(not set)")}
services_and_prices:
${asData(services || "(none listed)")}
other_confirmed_facts: ${asData(p.extra_facts || "(none)")}
</business_profile>`;
}

/** Photo library as compact lines. Only tagged, usable photos are offered for scenes. */
export function libraryBlock(assets: Asset[]): string {
  const rows = assets
    .filter((a) => a.tag_status === "tagged")
    .map((a) =>
      [
        `id=${a.id}`,
        `area=${a.area}`,
        `angle=${a.angle}`,
        `subject="${asData(a.subject ?? "")}"`,
        `description="${asData(a.description ?? "")}"`,
        `motion_tags=[${a.tags.join(",")}]`,
        `faces_visible=${a.faces_visible}`,
        `text_visible=${a.text_visible}`,
        `usable=${a.usable}${a.quality_flags.length ? ` (${a.quality_flags.join(",")})` : ""}`,
      ].join(" "),
    );
  return `<photo_library>\n${rows.join("\n")}\n</photo_library>`;
}
