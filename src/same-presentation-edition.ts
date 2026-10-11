import { z } from "zod";

// Compare navigation editions only. UUID hexadecimal case does not change its
// identity (RFC 9562 section 4). Both inputs must retain the admitted UUID grammar;
// stored publication/head/source/review joins keep their existing exact checks.
export function samePresentationEdition(left: unknown, right: unknown): boolean {
  const first = z.uuid().safeParse(left), second = z.uuid().safeParse(right);
  return first.success && second.success && first.data.toLowerCase() === second.data.toLowerCase();
}
