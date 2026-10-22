import { Readable } from "node:stream";
import { parseStream } from "music-metadata";

const isExpectedContainer: Record<string, (container: string) => boolean> = {
  mp3: (container) => container === "MPEG",
  wav: (container) => container === "WAVE",
  m4a: (container) => /^(M4A|isom|iso2|mp41|mp42|M4V)/.test(container),
  mp4: (container) => /^(M4A|isom|iso2|mp41|mp42|M4V|avc1|qt)/.test(container),
  webm: (container) => container.startsWith("EBML/"),
};

export class InvalidMediaError extends Error {
  constructor() {
    super("The uploaded file is not a supported audio or video file.");
    this.name = "InvalidMediaError";
  }
}

export async function inspectUploadedMedia(
  signedUrl: string,
  extension: string,
): Promise<{ durationSeconds: number }> {
  const isExpected = isExpectedContainer[extension];
  if (!isExpected) {
    throw new InvalidMediaError();
  }

  let response: Response;
  try {
    response = await fetch(signedUrl, { signal: AbortSignal.timeout(45000) });
  } catch {
    throw new Error("The uploaded media could not be inspected.");
  }
  if (!response.ok || !response.body) {
    throw new Error("The uploaded media could not be inspected.");
  }

  let metadata;
  try {
    metadata = await parseStream(
      Readable.from(readStreamBody(response.body), { objectMode: false }),
      { size: Number(response.headers.get("content-length")) || undefined },
      { skipCovers: true },
    );
  } catch {
    throw new InvalidMediaError();
  }

  const durationSeconds = metadata.format.duration;
  if (
    !isExpected(metadata.format.container ?? "") ||
    !metadata.format.numberOfChannels ||
    typeof durationSeconds !== "number" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new InvalidMediaError();
  }

  return { durationSeconds };
}

async function* readStreamBody(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
