import { readFileSync } from "node:fs";
const raw = readFileSync(new URL("../../fixtures/fictional-feed-discovery.json", import.meta.url), "utf8");
export const feedReport = () => JSON.parse(raw);
