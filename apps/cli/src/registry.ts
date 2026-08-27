import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface Enrollment {
  root: string;
  project_id: string;
  service_url: string;
  linked_at: string;
}
interface RegistryFile { version: 1; enrollments: Enrollment[] }

export function defaultRegistryPath(platform = process.platform): string {
  const data = process.env.ESPALIER_DATA_DIR ?? (platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Espalier")
    : join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "espalier"));
  return join(data, "registry.json");
}

export class EnrollmentRegistry {
  constructor(readonly filename = defaultRegistryPath()) {}

  list(): Enrollment[] { return this.read().enrollments; }

  link(input: Omit<Enrollment, "linked_at">): Enrollment {
    const root = realpathSync(resolve(input.root));
    const registry = this.read();
    const enrollment: Enrollment = { ...input, root, linked_at: new Date().toISOString() };
    registry.enrollments = registry.enrollments.filter((item) => item.root !== root);
    registry.enrollments.push(enrollment);
    registry.enrollments.sort((a, b) => a.root.localeCompare(b.root));
    this.write(registry);
    return enrollment;
  }

  discover(cwd: string): Enrollment | undefined {
    const target = realpathSync(resolve(cwd));
    return this.read().enrollments
      .filter((item) => {
        const path = relative(item.root, target);
        return path === "" || (!path.startsWith("..") && !isAbsolute(path));
      })
      .sort((a, b) => b.root.length - a.root.length)[0];
  }

  private read(): RegistryFile {
    if (!existsSync(this.filename)) return { version: 1, enrollments: [] };
    const value = JSON.parse(readFileSync(this.filename, "utf8")) as RegistryFile;
    if (value.version !== 1 || !Array.isArray(value.enrollments)) throw new Error(`Unsupported registry at ${this.filename}`);
    return value;
  }

  private write(value: RegistryFile): void {
    mkdirSync(dirname(this.filename), { recursive: true });
    const temporary = `${this.filename}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.filename);
  }
}
