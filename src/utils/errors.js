export class GISLoadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GISLoadError';
  }
}