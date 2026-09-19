export function stagingKeyPrefix(uploadId: string): string {
  return `uploads/staging/${uploadId}/`;
}

export function permanentKeyPrefix(uploadId: string): string {
  return `uploads/permanent/${uploadId}/`;
}
