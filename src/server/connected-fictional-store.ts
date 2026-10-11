import { constants, type Stats } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { compareRecordedInstants } from "../recorded-instant-order.ts";
import {
  CONNECTED_READER_BYTES, CONNECTED_READER_CAPACITY,
  parseConnectedReaderInput, parseConnectedReaderSnapshot,
  type ConnectedReaderOutcome, type ConnectedReaderSnapshot,
} from "../connected-fictional-reader.ts";

const recordName = /^edition-([0-9]{3})\.json$/;
const stagingName = /^\.pending-[0-9a-f-]{36}\.json$/;
const lockName = ".writer-lock";
const sameIdentity = (a: Stats, b: Stats) => ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeMs", "ctimeMs"].every(key =>
  a[key as keyof Stats] === b[key as keyof Stats]);
const privateDirectory = (stat: Stats) => stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 &&
  (!process.getuid || stat.uid === process.getuid());

// Development-only append-only projection cache. It contains invented display
// data, never credentials, raw responses or private database rows. The website
// reads it; no web request can write it or start a collector. This is not an
// eligibility store or a substitute for current-rights reads in production.
export class ConnectedFictionalStore {
  private readonly directory: string;
  constructor(directory: string) { this.directory = directory; }

  private async directoryExists(create: boolean): Promise<boolean> {
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
        (process.getuid && stat.uid !== process.getuid())) throw new Error("Connected projection directory is not private");
    return true;
  }

  private async readRecord(name: string): Promise<{ snapshot: ConnectedReaderSnapshot; identity: Stats }> {
    const path = join(this.directory, name);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > CONNECTED_READER_BYTES || (stat.mode & 0o077) !== 0 ||
          (process.getuid && stat.uid !== process.getuid())) throw new Error("Invalid connected projection file");
      const bytes = Buffer.alloc(CONNECTED_READER_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const read = await file.read(bytes, size, bytes.length - size, size);
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
      }
      if (size > CONNECTED_READER_BYTES) throw new Error("Projection grew beyond the limit");
      const snapshot = parseConnectedReaderSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
      if (name !== `edition-${String(snapshot.generation).padStart(3, "0")}.json`) throw new Error("Projection identity differs from its file");
      if (size !== stat.size || !sameIdentity(stat, await file.stat()) || !sameIdentity(stat, await lstat(path)))
        throw new Error("Connected projection changed during inspection");
      return { snapshot, identity: stat };
    } finally { await file.close(); }
  }

  private async latestRecord(): Promise<ConnectedReaderSnapshot | null> {
    if (!await this.directoryExists(false)) return null;
    const before = await lstat(this.directory);
    if (!privateDirectory(before)) throw new Error("Connected archive changed before inspection");
    const names = await readdir(this.directory);
    if (names.some((name) => name !== lockName && !recordName.test(name) && !stagingName.test(name))) throw new Error("Unexpected connected archive entry");
    const records = names.filter((name) => recordName.test(name)).sort();
    if (records.length > CONNECTED_READER_CAPACITY ||
        records.some((name, index) => name !== `edition-${String(index + 1).padStart(3, "0")}.json`)) {
      throw new Error("Connected archive has a gap or exceeds capacity");
    }
    const latestName = records[records.length - 1];
    const record = latestName ? await this.readRecord(latestName) : null;
    const after = await lstat(this.directory);
    if (!privateDirectory(after) || !sameIdentity(before, after) ||
        JSON.stringify((await readdir(this.directory)).sort()) !== JSON.stringify([...names].sort()))
      throw new Error("Connected archive changed during inspection");
    // Closing the file and checking the directory both await collaborators.
    // Recheck the witnessed file after those operations as well: changing its
    // contents alone need not change the directory identity or names.
    if (record && !sameIdentity(record.identity, await lstat(join(this.directory, latestName))))
      throw new Error("Connected projection changed before inspection completed");
    return record?.snapshot ?? null;
  }

  async current(expectedGeneration: number | null = null): Promise<ConnectedReaderOutcome> {
    try {
      const snapshot = await this.latestRecord();
      if (!snapshot) return { kind: "empty" };
      if (expectedGeneration !== null && expectedGeneration !== snapshot.generation) {
        return { kind: "changed", currentGeneration: snapshot.generation };
      }
      return { kind: "snapshot", snapshot };
    } catch { return { kind: "unavailable" }; }
  }

  async append(input: unknown, expectedGeneration: number | null): Promise<ConnectedReaderSnapshot> {
    const parsed = parseConnectedReaderInput(input);
    await this.directoryExists(true);
    const lock = await open(join(this.directory, lockName), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await lock.close();
    let completed = false;
    try {
      const previous = await this.latestRecord();
      if ((previous?.generation ?? null) !== expectedGeneration) throw new Error("Connected publication head changed");
      for (const name of (await readdir(this.directory)).filter((name) => recordName.test(name))) {
        if ((await this.readRecord(name)).snapshot.executionId === parsed.executionId) {
          throw new Error("Connected execution replay cannot replace its history");
        }
      }
      if (previous && compareRecordedInstants(parsed.observedAt, previous.observedAt) < 0) throw new Error("Connected observation predates its head");
      const generation = (previous?.generation ?? 0) + 1;
      const snapshot = parseConnectedReaderSnapshot({ ...parsed, generation });
      const bytes = Buffer.from(JSON.stringify(snapshot) + "\n", "utf8");
      if (bytes.length > CONNECTED_READER_BYTES) throw new Error("Connected projection exceeds its byte limit");
      const temporary = join(this.directory, `.pending-${randomUUID()}.json`);
      const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      // An atomic hard-link publishes a whole immutable edition. Existing
      // editions and failed pending evidence are never overwritten or pruned.
      await link(temporary, join(this.directory, `edition-${String(generation).padStart(3, "0")}.json`));
      await unlink(temporary);
      const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
      completed = true;
      return snapshot;
    } finally {
      // A failed operation retains its lock as an explicit recovery boundary.
      // Only this successful operation's own transient lock is removed.
      if (completed) await unlink(join(this.directory, lockName));
    }
  }
}

export const connectedFictionalStore = () => new ConnectedFictionalStore(join(process.cwd(), ".local-connected-reader"));
