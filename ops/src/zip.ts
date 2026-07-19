import archiver from "archiver";
import { PassThrough } from "node:stream";

/** Builds an in-memory zip containing a single text file, for Lambda CreateFunction's Code.ZipFile. */
export async function buildSingleFileZip(
  entryName: string,
  content: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const output = new PassThrough();
    const chunks: Buffer[] = [];

    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    archive.pipe(output);
    archive.append(content, { name: entryName });
    void archive.finalize();
  });
}
