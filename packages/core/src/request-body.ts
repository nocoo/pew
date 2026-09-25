export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
  }
}

export async function readBoundedBody(request: Pick<Request, "headers" | "body">, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new BodyTooLargeError();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  let buffer = new Uint8Array(0);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return buffer.subarray(0, size);
      if (value.byteLength > maxBytes - size) {
        await reader.cancel().catch(() => undefined);
        throw new BodyTooLargeError();
      }
      const nextSize = size + value.byteLength;
      if (nextSize > buffer.byteLength) {
        const grown = new Uint8Array(Math.min(maxBytes, Math.max(nextSize, buffer.byteLength * 2, 4096)));
        grown.set(buffer.subarray(0, size));
        buffer = grown;
      }
      buffer.set(value, size);
      size = nextSize;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedJson(request: Pick<Request, "headers" | "body">, maxBytes: number): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readBoundedBody(request, maxBytes)));
}
