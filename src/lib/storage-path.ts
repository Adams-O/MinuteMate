const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEDIA_EXTENSIONS = new Set(["mp3", "wav", "m4a", "mp4", "webm"]);

export function isMeetingStoragePath(ownerId: string, meetingId: string, path: string): boolean {
  if (!UUID_PATTERN.test(ownerId) || !UUID_PATTERN.test(meetingId)) return false;
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== ownerId || parts[1] !== meetingId) return false;
  const fileName = parts[2];
  const fileParts = fileName.split(".");
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(fileName) &&
    fileParts.length >= 2 &&
    MEDIA_EXTENSIONS.has(fileParts[fileParts.length - 1].toLowerCase());
}
