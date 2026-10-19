import { inventedPrivateReadRows } from "../../src/synthetic-private-read-rows.ts";

// Preserve the existing invented private-row fixture through the shared factory.
export const sample = () => inventedPrivateReadRows();
