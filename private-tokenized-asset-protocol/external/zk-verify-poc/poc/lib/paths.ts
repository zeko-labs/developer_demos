export function outputDir(): string {
  return process.env.OUTPUT_DIR ?? "output/latest";
}
