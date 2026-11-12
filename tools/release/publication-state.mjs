// npm package versions are immutable: an existing version is reusable only with matching bytes.
export function publicationState(status, metadata, name, version, integrity) {
  if (status === 404) return 'missing';
  if (status !== 200) throw new Error(`npm lookup for ${name}@${version} failed: HTTP ${status}`);
  if (metadata?.dist?.integrity !== integrity) throw new Error(`${name}@${version} already exists with different integrity; refusing to publish`);
  return 'matching';
}
