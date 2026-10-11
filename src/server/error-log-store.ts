import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, readdir, rmdir } from "node:fs/promises";
import { isAbsolute, join, resolve, parse } from "node:path";
import { diagnosticEventSchema, DIAGNOSTIC_CAPACITY, DIAGNOSTIC_FILE_BYTES, type DiagnosticEvent } from "../error-diagnostics.ts";

const namePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;
const same = (a: Stats, b: Stats) => ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeMs", "ctimeMs"]
  .every(key => a[key as keyof Stats] === b[key as keyof Stats]);
const privateDirectory = (s: Stats) => s.isDirectory() && (s.mode & 0o077) === 0 && s.uid === process.getuid?.();
export type DiagnosticWrite = "saved" | "invalid" | "busy" | "full" | "unavailable";

// Linux NAS/server store. No cleanup, overwrite, background timer or public reader.
// Both writers share a transient lock. A crash-held lock fails closed until an
// operator investigates; diagnostic loss must never fail the user's operation.
export class ErrorLogStore {
  readonly directory: string;
  constructor(directory: string) {
    if (!isAbsolute(directory) || directory !== resolve(directory) || directory === parse(directory).root)
      throw new Error("Invalid diagnostic directory");
    this.directory = directory;
  }

  private async directoryHandle(create: boolean) {
    if (process.platform !== "linux") throw new Error("Diagnostic filesystem not accepted");
    // Refuse existing ancestor links. Installation must supply a trusted parent;
    // the final opened directory, not the path, anchors every file operation.
    let current = parse(this.directory).root;
    const parts = this.directory.slice(current.length).split("/");
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      if (!(await lstat(current)).isDirectory()) throw new Error("Diagnostic parent unavailable");
    }
    if (create) {
      try { await mkdir(this.directory, { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const handle = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { if (!privateDirectory(await handle.stat())) throw new Error("Diagnostic directory not private"); }
    catch (error) { await handle.close(); throw error; }
    return handle;
  }

  async append(input: unknown): Promise<DiagnosticWrite> {
    const parsed = diagnosticEventSchema.safeParse(input);
    if (!parsed.success) return "invalid";
    const bytes = Buffer.from(JSON.stringify(parsed.data) + "\n");
    if (bytes.length > DIAGNOSTIC_FILE_BYTES) return "invalid";
    let directory, lockStat;
    try {
      directory = await this.directoryHandle(true);
      const anchored = `/proc/self/fd/${directory.fd}`;
      try { await mkdir(join(anchored, ".write-lock"), { mode: 0o700 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return "busy"; throw error; }
      lockStat = await lstat(join(anchored, ".write-lock"));
      const names = await readdir(anchored);
      if (names.length - 1 >= DIAGNOSTIC_CAPACITY) return "full";
      // Exclusive create also refuses duplicates and existing symbolic links.
      const name = join(anchored, `${parsed.data.eventId}.json`);
      const file = await open(name, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      let written;
      try {
        await file.writeFile(bytes); await file.sync(); written = await file.stat();
        const observed = Buffer.alloc(DIAGNOSTIC_FILE_BYTES + 1);
        const read = await file.read(observed, 0, observed.length, 0);
        if (!written.isFile() || written.nlink !== 1 || written.uid !== process.getuid?.() || (written.mode & 0o077) !== 0
          || written.size !== bytes.length || read.bytesRead !== bytes.length || !observed.subarray(0, read.bytesRead).equals(bytes)
          || !same(written, await file.stat()) || !same(written, await lstat(name))) return "unavailable";
      } finally { await file.close(); }
      await directory.sync();
      const after = await lstat(this.directory), held = await directory.stat();
      if (after.dev !== held.dev || after.ino !== held.ino || !privateDirectory(after) || !same(written, await lstat(name))) return "unavailable";
      return "saved";
    } catch { return "unavailable"; }
    finally {
      if (directory) {
        if (lockStat) {
          const lock = `/proc/self/fd/${directory.fd}/.write-lock`;
          try { const now = await lstat(lock); if (now.dev === lockStat.dev && now.ino === lockStat.ino) await rmdir(lock); } catch { /* Retain uncertain lock. */ }
        }
        await directory.close().catch(() => {});
      }
    }
  }

  async inspect(): Promise<{ events: DiagnosticEvent[]; unreadable: number; stable: boolean; locked: boolean; filesObserved: number }> {
    const directory = await this.directoryHandle(false);
    try {
      const anchored = `/proc/self/fd/${directory.fd}`, before = await directory.stat();
      const names = (await readdir(anchored)).sort();
      if (names.length > DIAGNOSTIC_CAPACITY + 1) throw new Error("Diagnostic inspection bound exceeded");
      let unreadable = 0;
      const witnessed: { name: string; stat: Stats; event: DiagnosticEvent }[] = [];
      for (const name of names) {
        if (name === ".write-lock") continue;
        if (!namePattern.test(name)) { unreadable++; continue; }
        let file;
        try {
          file = await open(join(anchored, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const stat = await file.stat();
          if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0 || stat.size > DIAGNOSTIC_FILE_BYTES)
            throw new Error("Invalid diagnostic file");
          const bytes = Buffer.alloc(DIAGNOSTIC_FILE_BYTES + 1);
          const size = (await file.read(bytes, 0, bytes.length, 0)).bytesRead;
          if (size !== stat.size || size > DIAGNOSTIC_FILE_BYTES || !same(stat, await file.stat()) || !same(stat, await lstat(join(anchored, name))))
            throw new Error("Diagnostic file changed");
          const event = diagnosticEventSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size))));
          if (`${event.eventId}.json` !== name) throw new Error("Diagnostic identity changed");
          witnessed.push({ name, stat, event });
        } catch { unreadable++; }
        finally { await file?.close().catch(() => {}); }
      }
      const after = await directory.stat(), path = await lstat(this.directory);
      let stable = same(before, after) && path.dev === after.dev && path.ino === after.ino && privateDirectory(path)
        && JSON.stringify(names) === JSON.stringify((await readdir(anchored)).sort());
      // Finish directory/namespace awaits before the last witnessed-file fence.
      // A changed file need not change those directory facts. This cooperative
      // inspection still grants no atomic snapshot or complete fault coverage.
      const events: DiagnosticEvent[] = [];
      for (const row of witnessed) {
        try { if (!same(row.stat, await lstat(join(anchored, row.name)))) throw new Error("Diagnostic changed"); events.push(row.event); }
        catch { unreadable++; stable = false; }
      }
      return { events: events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId)),
        unreadable, stable, locked: names.includes(".write-lock"), filesObserved: names.filter(name => name !== ".write-lock").length };
    } finally { await directory.close(); }
  }
}
