import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidMediaError, inspectUploadedMedia } from "@/lib/media/inspect-upload";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inspectUploadedMedia", () => {
  it("reads duration and container from the uploaded media stream", async () => {
    const wav = createWavFile(1);
    vi.stubGlobal("fetch", vi.fn(async () => wavResponse(wav)));

    await expect(inspectUploadedMedia("https://storage.test/signed", "wav"))
      .resolves.toEqual({ durationSeconds: 1 });
  });

  it("rejects content that does not match the extension", async () => {
    const wav = createWavFile(1);
    vi.stubGlobal("fetch", vi.fn(async () => wavResponse(wav)));

    await expect(inspectUploadedMedia("https://storage.test/signed", "mp3"))
      .rejects.toBeInstanceOf(InvalidMediaError);
  });

  it("rejects unsupported extensions without fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(inspectUploadedMedia("https://storage.test/signed", "txt"))
      .rejects.toBeInstanceOf(InvalidMediaError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

function wavResponse(bytes: Uint8Array): Response {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new Response(new DataView(arrayBuffer), {
    headers: { "content-length": String(bytes.length) },
  });
}

function createWavFile(durationSeconds: number): Uint8Array {
  const sampleRate = 8000;
  const channels = 1;
  const bytesPerSample = 2;
  const dataSize = sampleRate * durationSeconds * channels * bytesPerSample;
  const file = new Uint8Array(44 + dataSize);
  const view = new DataView(file.buffer);
  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      file[offset + index] = value.charCodeAt(index);
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeText(36, "data");
  view.setUint32(40, dataSize, true);

  return file;
}
