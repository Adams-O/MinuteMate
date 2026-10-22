export async function readBoundedBodyText(
  input: Pick<Request, "headers" | "body"> | Pick<Response, "headers" | "body">,
  maxBytes: number,
): Promise<string | null> {
  const contentLength = Number(input.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return null;
  }
  if (!input.body) {
    return null;
  }

  const reader = input.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch {
    return null;
  }
}
