import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJsonFile<T>(path: string): Promise<T> {
  const data = await readFile(path, "utf8");
  return JSON.parse(data) as T;
}

export async function writeJsonFile(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
