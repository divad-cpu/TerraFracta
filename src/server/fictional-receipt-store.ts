import { constants, type Stats } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseFictionalUpdateResult, type FictionalUpdateResult } from "../fictional-update-result.ts";
import { compareFictionalExecutionNewestFirst } from "../fictional-execution-order.ts";

export const FICTIONAL_RECEIPT_CAPACITY = 100;
const bytesLimit = 64 * 1024;
const receiptName = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;
const pendingName = /^\.pending-[0-9a-f-]{36}\.json$/;
export class FictionalArchiveCapacityError extends Error {}
const sameReceiptStat = (left: Stats, right: Stats) => ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeMs", "ctimeMs"].every(key =>
  left[key as keyof Stats] === right[key as keyof Stats]);

// This is an append-only local demonstration archive, not a trusted run ledger.
// No source bytes, database connection or configurable browser path is accepted.
export class FictionalReceiptStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }

  private async checkedDirectory(create: boolean): Promise<boolean> {
    if (create) {
      try { await mkdir(this.directory, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    let stat;
    try { stat = await lstat(this.directory); }
    catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid())) {
      throw new Error("Fictional archive directory is not private and local");
    }
    return true;
  }

  async append(input: unknown): Promise<void> {
    const result = parseFictionalUpdateResult(input);
    const finalName = `${result.execution.id}.json`;
    if (!receiptName.test(finalName)) throw new Error("Fictional archive requires a generated execution UUID");
    const bytes = Buffer.from(JSON.stringify(result) + "\n", "utf8");
    if (bytes.byteLength > bytesLimit) throw new Error("Fictional receipt exceeds its size bound");
    await this.checkedDirectory(true);
    const names = await readdir(this.directory);
    if (names.filter((name) => receiptName.test(name) || pendingName.test(name)).length >= FICTIONAL_RECEIPT_CAPACITY) {
      throw new FictionalArchiveCapacityError("Fictional archive capacity reached; existing receipts are preserved");
    }
    const temporary = join(this.directory, `.pending-${randomUUID()}.json`);
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    // Hard-link publication is atomic and refuses an existing execution ID.
    // Only this successful call's own staging name is removed; saved receipts
    // and failed staging artifacts are never pruned or overwritten.
    await link(temporary, join(this.directory, finalName));
    await unlink(temporary);
    const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
  }

  async inspectAll(): Promise<{ entries: FictionalUpdateResult[]; totalReceipts: number; unreadableReceipts: number; pendingReceipts: number; stableSnapshot: boolean }> {
    if (!await this.checkedDirectory(false)) return { entries: [], totalReceipts: 0, unreadableReceipts: 0, pendingReceipts: 0, stableSnapshot: true };
    const beforeDirectory = await lstat(this.directory);
    if (!beforeDirectory.isDirectory() || beforeDirectory.isSymbolicLink() || (beforeDirectory.mode & 0o077) !== 0 ||
        (process.getuid && beforeDirectory.uid !== process.getuid())) throw new Error("Fictional archive changed before inspection");
    const allNames = await readdir(this.directory);
    if (allNames.length > 200) throw new Error("Fictional archive directory exceeds its inspection bound");
    const names = allNames.filter((name) => receiptName.test(name));
    const pendingReceipts = allNames.filter((name) => pendingName.test(name)).length;
    if (names.length + pendingReceipts > FICTIONAL_RECEIPT_CAPACITY) throw new Error("Fictional archive exceeds its reviewed capacity");
    const entries: FictionalUpdateResult[] = [];
    const witnessed: { name: string; stat: Stats; result: FictionalUpdateResult }[] = [];
    let unreadableReceipts = 0;
    for (const name of names) {
      let file;
      try {
        file = await open(join(this.directory, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > bytesLimit || (stat.mode & 0o077) !== 0 ||
            (process.getuid && stat.uid !== process.getuid())) throw new Error("Receipt file boundary failed");
        const bytes = Buffer.alloc(bytesLimit + 1);
        let size = 0;
        while (size < bytes.length) {
          const read = await file.read(bytes, size, bytes.length - size, size);
          if (read.bytesRead === 0) break;
          size += read.bytesRead;
        }
        if (size > bytesLimit) throw new Error("Receipt grew beyond its byte bound");
        const result = parseFictionalUpdateResult(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
        if (`${result.execution.id}.json` !== name) throw new Error("Receipt identity differs from its file");
        if (size !== stat.size || !sameReceiptStat(stat, await file.stat()) || !sameReceiptStat(stat, await lstat(join(this.directory, name)))) {
          throw new Error("Fictional receipt changed during inspection");
        }
        witnessed.push({ name, stat, result });
      } catch { unreadableReceipts += 1; }
      finally { await file?.close(); }
    }
    const afterDirectory = await lstat(this.directory);
    let stableSnapshot = afterDirectory.isDirectory() && !afterDirectory.isSymbolicLink()
      && afterDirectory.dev === beforeDirectory.dev && afterDirectory.ino === beforeDirectory.ino
      && afterDirectory.mode === beforeDirectory.mode && afterDirectory.uid === beforeDirectory.uid && afterDirectory.gid === beforeDirectory.gid
      && afterDirectory.mtimeMs === beforeDirectory.mtimeMs && afterDirectory.ctimeMs === beforeDirectory.ctimeMs
      && JSON.stringify((await readdir(this.directory)).sort()) === JSON.stringify([...allNames].sort())
      && allNames.length === names.length + pendingReceipts;
    // Directory/namespace checks await collaborators too. Recheck each
    // witnessed file after those awaits: content replacement need not alter
    // the directory's identity or names. This remains a bounded cooperative
    // inspection, not an atomic filesystem lock or current-rights authority.
    for (const item of witnessed) {
      try {
        if (!sameReceiptStat(item.stat, await lstat(join(this.directory, item.name)))) throw new Error("Earlier receipt changed");
        entries.push(item.result);
      } catch { unreadableReceipts += 1; stableSnapshot = false; }
    }
    entries.sort(compareFictionalExecutionNewestFirst);
    return { entries, totalReceipts: names.length, unreadableReceipts, pendingReceipts, stableSnapshot };
  }

  async recent(): Promise<{ entries: FictionalUpdateResult[]; totalReceipts: number; unreadableReceipts: number; pendingReceipts: number }> {
    const { stableSnapshot: _complete, ...inventory } = await this.inspectAll();
    return { ...inventory, entries: inventory.entries.slice(0, 8) };
  }
}

const localStore = () => new FictionalReceiptStore(join(process.cwd(), ".local-fictional-runs"));
export const persistFictionalReceipt = (result: FictionalUpdateResult) => localStore().append(result);
export const readRecentFictionalReceipts = () => localStore().recent();
export const readAllFictionalReceipts = () => localStore().inspectAll();
